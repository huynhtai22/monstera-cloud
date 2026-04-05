import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import GoogleProvider from "next-auth/providers/google"
import { PrismaAdapter } from "@next-auth/prisma-adapter"
import { encode as jwtEncode, decode as jwtDecode } from "next-auth/jwt"
import prisma from "@/lib/prisma"

/** Long session when “Keep me signed in” is enabled (or OAuth). */
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
/** Short session when user opts out of “keep signed in”. */
const SESSION_SHORT_AGE_SECONDS = 24 * 60 * 60

export const authOptions: NextAuthOptions = {
    adapter: PrismaAdapter(prisma),
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
                // Case-insensitive match (Postgres) — avoids login failures when casing differs from DB
                const dbUser = (await prisma.user.findFirst({
                    where: { email: { equals: email, mode: "insensitive" } },
                })) as any;

                if (!dbUser || !dbUser.hashedPassword || !dbUser.emailVerified) {
                    return null;
                }

                const bcrypt = await import("bcryptjs");
                const isPasswordValid = await bcrypt.compare(credentials.password, dbUser.hashedPassword);

                if (!isPasswordValid) {
                    return null;
                }

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
