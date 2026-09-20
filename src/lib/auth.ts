import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import GoogleProvider from "next-auth/providers/google"
import { PrismaAdapter } from "@next-auth/prisma-adapter"
import { encode as jwtEncode, decode as jwtDecode } from "next-auth/jwt"
import prisma, { prismaBase } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { logger } from "@/lib/logger";
import { isPilotMode } from "@/lib/pilot-mode";
import { allowAuthAttempt } from "@/lib/auth-rate-limit";
import { recordLoginEvent, telemetryHashesFromRequest } from "@/lib/login-telemetry";
import { recordSecurityControlEvent, securityActorHash } from "@/lib/security-control-events";
import {
  isSessionRevoked,
  maybeNotifyNewDevice,
  newSessionId,
  registerSession,
  touchSession,
} from "@/lib/session-limits";
import { sendNewDeviceEmail } from "@/lib/mail";
import { isPlatformAdminEmail } from "@/lib/admin-auth";
import { isWhitelistedProEmail } from "@/lib/plan-config";
import { freePilotEndsAt } from "@/lib/free-pilot";

/** Long session when “Keep me signed in” is enabled (or OAuth). */
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
/** Short session when user opts out of “keep signed in”. */
const SESSION_SHORT_AGE_SECONDS = 24 * 60 * 60

const isProduction = process.env.NODE_ENV === "production"

/**
 * Provisions a default Personal Workspace for a user if they don't already have one.
 * Idempotent — safe to call multiple times; workspace is only created once.
 * Must be called OUTSIDE of an auth transaction to avoid deadlocks.
 */
async function ensureWorkspace(userId: string, email?: string | null): Promise<void> {
    const isPro = isWhitelistedProEmail(email);
    const existing = await prisma.workspaceMember.findFirst({
        where: { userId },
        select: { id: true, workspaceId: true, workspace: { select: { plan: true } } },
    });
    if (existing) {
        if (isPro && existing.workspace.plan !== "professional" && existing.workspace.plan !== "enterprise") {
            await prisma.workspace.update({
                where: { id: existing.workspaceId },
                data: { plan: "professional", status: "ACTIVE" },
            });
        }
        return;
    }

    try {
        await prisma.$transaction(async (tx) => {
            const workspace = await tx.workspace.create({
                data: {
                    name: "Agency Workspace",
                    slug: `agency-${userId.slice(0, 8)}`,
                    ownerId: userId,
                    plan: "professional",
                    status: isPro ? "ACTIVE" : "PILOT",
                    subscriptionEndsAt: isPro ? undefined : freePilotEndsAt(),
                    providerAccess: {
                        create: [
                            { provider: "meta_ads", enabled: true },
                            { provider: "google_ads", enabled: true },
                            { provider: "tiktok_business", enabled: true },
                            { provider: "shopee", enabled: true },
                        ],
                    },
                },
            });
            await tx.workspaceMember.create({
                data: { workspaceId: workspace.id, userId, role: "owner" },
            });
        });
    } catch (err: any) {
        // P2002 = unique constraint — workspace already created by a concurrent request; safe to ignore
        if (err?.code !== "P2002") {
            logger.error("[AUTH] ensureWorkspace failed:", err);
            throw err;
        }
    }
}

export const authOptions: NextAuthOptions = {
    adapter: PrismaAdapter(prismaBase),
    // Only pin the short-lived OAuth handshake cookies (state + PKCE verifier).
    // These are the ones that break in incognito / on Vercel preview URLs because
    // NextAuth auto-applies the __Secure- prefix which Chrome drops on cross-site
    // redirects in incognito mode.
    //
    // The session token cookie is intentionally left at its NextAuth default so
    // existing logged-in users keep their sessions across deploys.
    cookies: {
        pkceCodeVerifier: {
            name: "next-auth.pkce.code_verifier",
            options: { httpOnly: true, sameSite: "lax", path: "/", secure: isProduction, maxAge: 60 * 15 },
        },
        state: {
            name: "next-auth.state",
            options: { httpOnly: true, sameSite: "lax", path: "/", secure: isProduction, maxAge: 60 * 15 },
        },
    },
    providers: [
        GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID || "",
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
            authorization: {
                params: {
                    // GCP OAuth consent (project A): non-sensitive only — openid, userinfo.email, userinfo.profile.
                    // Shorthand "email" + "profile" maps to those userinfo scopes. Do not add Sheets/Drive here.
                    scope: "openid email profile",
                    prompt: "consent select_account", // Force account selection
                    access_type: "offline",
                    response_type: "code"
                }
            }
        }),
        CredentialsProvider({
            name: 'Credentials',
            credentials: {
                email: { label: "Email", type: "email", placeholder: "you@example.com" },
                password: { label: "Password", type: "password" },
                /** "true" | "false" from login form — controls cookie lifetime */
                rememberMe: { label: "Remember", type: "text" },
            },
            async authorize(credentials, req) {
                if (!credentials?.email || !credentials?.password) {
                    return null;
                }

                const email = credentials.email.trim().toLowerCase();
                if (!(await allowAuthAttempt({
                    request: req as unknown as Request,
                    action: "login",
                    identity: email,
                    limit: 10,
                    windowSeconds: 15 * 60,
                }))) {
                    await recordSecurityControlEvent({
                        eventType: "auth_failure",
                        outcome: "rejected",
                        scope: "credentials",
                        actorHash: securityActorHash(email),
                        metadata: { reason: "rate_limited" },
                    });
                    return null;
                }

                // Case-insensitive match (Postgres) — avoids login failures when casing differs from DB
                const dbUser = (await prisma.user.findFirst({
                    where: { email: { equals: email, mode: "insensitive" } },
                })) as any;

                if (!dbUser) {
                    await recordSecurityControlEvent({
                        eventType: "auth_failure", outcome: "failure", scope: "credentials",
                        actorHash: securityActorHash(email), metadata: { reason: "unknown_user" },
                    });
                    return null;
                }

                if (!dbUser.hashedPassword) {
                    await recordSecurityControlEvent({
                        eventType: "auth_failure", outcome: "failure", scope: "credentials",
                        actorHash: securityActorHash(email), metadata: { reason: "password_unavailable" },
                    });
                    return null;
                }

                if (!dbUser.emailVerified) {
                    await recordSecurityControlEvent({
                        eventType: "auth_failure", outcome: "failure", scope: "credentials",
                        actorHash: securityActorHash(email), metadata: { reason: "email_unverified" },
                    });
                    return null;
                }

                try {
                    const isPasswordValid = await bcrypt.compare(credentials.password, dbUser.hashedPassword);

                    if (!isPasswordValid) {
                        await recordSecurityControlEvent({
                            eventType: "auth_failure", outcome: "failure", scope: "credentials",
                            actorHash: securityActorHash(email), metadata: { reason: "invalid_password" },
                        });
                        return null;
                    }
                } catch (err: any) {
                    logger.error("[LOGIN_CRASH] bcrypt failed:", err);
                    await recordSecurityControlEvent({
                        eventType: "auth_failure", outcome: "failure", scope: "credentials",
                        actorHash: securityActorHash(email), metadata: { reason: "password_check_error" },
                    });
                    return null;
                }

                const rememberMe = credentials.rememberMe !== "false";

                // P0 telemetry (fail-open): login visibility without enforcement.
                const loginEventId = await recordLoginEvent({
                  userId: dbUser.id,
                    method: "credentials",
                    request: req as unknown as Request,
                });

                // P3: new-device nudge (fail-open, fire-and-forget).
                {
                    const { ipHash } = telemetryHashesFromRequest(req as unknown as Request);
                    void maybeNotifyNewDevice({
                        userId: dbUser.id,
                        email: dbUser.email,
                        ipHash,
                        currentLoginEventId: loginEventId,
                        method: "email + password",
                        notify: (email, method) => sendNewDeviceEmail(email, { method }),
                    });
                }

                return {
                    id: dbUser.id,
                    name: dbUser.name,
                    email: dbUser.email,
                    image: dbUser.image,
                    rememberMe,
                };
            }
        })
    ],
    session: {
        strategy: "jwt",
        maxAge: SESSION_MAX_AGE_SECONDS,
    },
    jwt: {
        maxAge: SESSION_MAX_AGE_SECONDS,
        encode: async ({ token, secret, salt }) => {
            const rememberMe = token?.rememberMe as boolean | undefined
            const effectiveMaxAge =
                rememberMe === false ? SESSION_SHORT_AGE_SECONDS : SESSION_MAX_AGE_SECONDS
            return jwtEncode({ token, secret, maxAge: effectiveMaxAge, salt })
        },
        decode: async (params) => jwtDecode(params),
    },
    secret: process.env.NEXTAUTH_SECRET,
    pages: {
        signIn: '/login',
        newUser: '/register', // New users will be directed here on first sign in
        error: '/login', // Error code passed in query string as ?error=
    },
    callbacks: {
        /**
         * Google OAuth account linking:
         * If a user signs in with Google but an account already exists for that email
         * (created via credentials), we link the OAuth Account record to the existing
         * user instead of letting PrismaAdapter create a duplicate User row (which
         * would throw a P2002 unique constraint error on User.email).
         */
        async signIn({ user, account, profile }: any) {
            if (account?.provider !== "google") return true;

            const rawEmail = profile?.email ?? user?.email;
            if (!rawEmail) return true;

            const email = rawEmail.trim().toLowerCase();

            // Check if an existing user row exists for this email
            const existingUser = await prisma.user.findFirst({
                where: { email: { equals: email, mode: "insensitive" } },
                select: { id: true },
            });

            if (!existingUser) {
                // Truly new user — PrismaAdapter will create the row normally.
                // P0 skips the first-signup event here (no stable userId yet);
                // subsequent Google logins are recorded below.
                return true;
            }

            // Email already belongs to a credentials (or other provider) account.
            // Check whether this Google account is already linked.
            const existingAccount = await prisma.account.findUnique({
                where: {
                    provider_providerAccountId: {
                        provider: account.provider,
                        providerAccountId: account.providerAccountId,
                    },
                },
                select: { id: true },
            });

            if (existingAccount) {
                // Already linked — nothing to do; allow sign-in
                // P0 telemetry (fail-open, no request IP in this callback).
                if (existingUser?.id) {
                    await recordLoginEvent({ userId: existingUser.id, method: "google" });
                }
                return true;
            }

            // Link this Google account to the existing user — preserves all data
            await prisma.account.create({
                data: {
                    userId: existingUser.id,
                    type: account.type,
                    provider: account.provider,
                    providerAccountId: account.providerAccountId,
                    access_token: account.access_token,
                    refresh_token: account.refresh_token,
                    expires_at: account.expires_at,
                    token_type: account.token_type,
                    scope: account.scope,
                    id_token: account.id_token,
                    session_state: account.session_state,
                },
            });

            // Mutate user.id so the JWT callback gets the existing user's ID
            user.id = existingUser.id;
            logger.info(`[AUTH] Linked Google account to existing user: ${email}`);
            // P0 telemetry (fail-open, no request IP in this callback).
            await recordLoginEvent({ userId: existingUser.id, method: "google" });
            return true;
        },

        async jwt({ token, user, account }: any) {
            if (user) {
                token.id = user.id
                if (typeof user.rememberMe === "boolean") {
                    token.rememberMe = user.rememberMe
                } else {
                    token.rememberMe = true
                }
                // P1: stable browser-session id, registered server-side for
                // revocation + concurrent-session caps. No request IP is
                // available here; the heartbeat enriches hashes later.
                // Do not use the reserved JWT `jti` claim here. NextAuth's
                // encoder owns and replaces it after this callback, which
                // would make the registered row impossible to match later.
                if (!token.sessionJti) token.sessionJti = newSessionId();
                await registerSession({ userId: user.id, jti: token.sessionJti as string });
            }
            if (account?.provider === "google") {
                token.rememberMe = true
            }
            if (account) {
                token.accessToken = account.access_token
            }
            return token
        },
        async session({ session, token }: any) {
            if (!session.user) return session

            session.user.isAdmin = isPlatformAdminEmail(session.user.email);

            // P1: revoked browser sessions lose their identity, so every
            // `!session?.user?.id` guard below returns 401. Legacy pre-P1
            // JWTs carry no sessionJti and are grandfathered until re-login.
            const jti = token.sessionJti as string | undefined;
            if (jti) {
                session.user.sessionId = jti;
                if (await isSessionRevoked(jti)) {
                    session.user.id = "";
                    return session;
                }
                void touchSession(jti);
            }

            let userId = token.id as string | undefined
            if (!userId && session.user.email) {
                const byEmail = await prisma.user.findFirst({
                    where: { email: { equals: session.user.email, mode: "insensitive" } },
                    select: { id: true, hashedPassword: true, workspaces: { select: { workspace: { select: { plan: true } } } } },
                })
                if (byEmail) {
                    userId = byEmail.id
                    session.user.id = byEmail.id
                    session.user.plan = byEmail.workspaces[0]?.workspace.plan ?? "free"
                    session.user.hasPassword = Boolean(byEmail.hashedPassword)
                    return session
                }
            }

            if (userId) {
                session.user.id = userId
                const row = await prisma.user.findUnique({
                    where: { id: userId },
                    select: { hashedPassword: true, workspaces: { select: { workspace: { select: { id: true, plan: true } } } } },
                })
                const currentPlan = row?.workspaces[0]?.workspace.plan ?? "free";
                const isPro = isWhitelistedProEmail(session.user.email);
                if (isPro && currentPlan !== "professional" && currentPlan !== "enterprise" && row?.workspaces[0]?.workspace.id) {
                    await prisma.workspace.update({
                        where: { id: row.workspaces[0].workspace.id },
                        data: { plan: "professional", status: "ACTIVE" },
                    }).catch(() => {});
                    session.user.plan = "professional";
                } else {
                    session.user.plan = isPro ? "professional" : currentPlan;
                }
                session.user.hasPassword = Boolean(row?.hashedPassword)
            }
            return session
        }
    },

    /**
     * Idempotent workspace provisioning for any new user — credentials or OAuth.
     * Credentials users already get a workspace via the register transaction.
     * This covers Google OAuth (and any future provider) first-sign-in.
     */
    events: {
        async createUser({ user }) {
            if (!user?.id) return;
            try {
                await ensureWorkspace(user.id, user.email);
            } catch (err) {
                logger.error("[AUTH] createUser workspace provisioning failed:", err);
            }
        },
    },
}
