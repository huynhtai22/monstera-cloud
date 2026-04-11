import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import GoogleProvider from "next-auth/providers/google"
import { PrismaAdapter } from "@next-auth/prisma-adapter"
import { encode as jwtEncode, decode as jwtDecode } from "next-auth/jwt"
import prisma from "@/lib/prisma"
import bcrypt from "bcryptjs"

/** Long session when “Keep me signed in” is enabled (or OAuth). */
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
/** Short session when user opts out of “keep signed in”. */
const SESSION_SHORT_AGE_SECONDS = 24 * 60 * 60

const isProduction = process.env.NODE_ENV === "production"

export const authOptions: NextAuthOptions = {
    adapter: PrismaAdapter(prisma),
    // Explicit cookie config: avoids __Secure-/__Host- prefix issues that break
    // OAuth state/PKCE verification in incognito mode and on Vercel preview URLs.
    cookies: {
        sessionToken: {
            name: "next-auth.session-token",
            options: { httpOnly: true, sameSite: "lax", path: "/", secure: isProduction },
        },
        callbackUrl: {
            name: "next-auth.callback-url",
            options: { sameSite: "lax", path: "/", secure: isProduction },
        },
        csrfToken: {
            name: "next-auth.csrf-token",
            options: { httpOnly: true, sameSite: "lax", path: "/", secure: isProduction },
        },
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
                    scope: "openid email profile https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file",
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

                const email = credentials.email.trim();
                console.log("[LOGIN_ATTEMPT] Email:", email);

                // Case-insensitive match (Postgres) — avoids login failures when casing differs from DB
                const dbUser = (await prisma.user.findFirst({
                    where: { email: { equals: email, mode: "insensitive" } },
                })) as any;

                if (!dbUser) {
                    console.log("[LOGIN_FAILED] User not found for email:", email);
                    return null;
                }

                if (!dbUser.hashedPassword) {
                    console.log("[LOGIN_FAILED] No hashed password for user:", email);
                    return null;
                }

                if (!dbUser.emailVerified) {
                    console.log("[LOGIN_FAILED] Email not verified for user:", email);
                    return null;
                }

                try {
                    const isPasswordValid = await bcrypt.compare(credentials.password, dbUser.hashedPassword);

                    if (!isPasswordValid) {
                        console.log("[LOGIN_FAILED] Password compare failed for user:", email);
                        return null;
                    }
                } catch (err: any) {
                    console.error("[LOGIN_CRASH] bcrypt failed:", err);
                    return null;
                }

                console.log("[LOGIN_SUCCESS] User logged in:", email);

                const rememberMe = credentials.rememberMe !== "false";

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
        encode: async ({ token, secret, maxAge, salt }) => {
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
        async jwt({ token, user, account }: any) {
            if (user) {
                token.id = user.id
                if (typeof user.rememberMe === "boolean") {
                    token.rememberMe = user.rememberMe
                } else {
                    token.rememberMe = true
                }
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
            if (session.user) {
                session.user.id = token.id
                // We're just passing this for the frontend if needed, 
                // but workers will pull actual offline token from DB's Account table.
            }
            return session
        }
    }
}
