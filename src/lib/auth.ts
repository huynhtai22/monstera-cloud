import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import GoogleProvider from "next-auth/providers/google"
import { PrismaAdapter } from "@next-auth/prisma-adapter"
import prisma from "@/lib/prisma"

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
                password: { label: "Password", type: "password" }
            },
            async authorize(credentials, req) {
                if (!credentials?.email || !credentials?.password) {
                    return null;
                }

                // Look up the user from the database
                const dbUser = await prisma.user.findUnique({
                    where: { email: credentials.email }
                }) as any;

                if (!dbUser || !dbUser.hashedPassword) {
                    return null;
                }

                const bcrypt = await import("bcryptjs");
                const isPasswordValid = await bcrypt.compare(credentials.password, dbUser.hashedPassword);

                if (!isPasswordValid) {
                    return null;
                }

                return {
                    id: dbUser.id,
                    name: dbUser.name,
                    email: dbUser.email,
                    image: dbUser.image
                };
            }
        })
    ],
    session: {
        strategy: "jwt",
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
