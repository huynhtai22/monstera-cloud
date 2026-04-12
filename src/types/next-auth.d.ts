import type { DefaultSession } from "next-auth";
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
    interface User {
        rememberMe?: boolean;
        /** Present after OAuth/credentials sign-in — server-side source of truth for authorization */
        id?: string;
    }
    interface Session {
        user: DefaultSession["user"] & {
            id: string;
        };
    }
}

declare module "next-auth/jwt" {
    interface JWT {
        rememberMe?: boolean;
        id?: string;
    }
}
