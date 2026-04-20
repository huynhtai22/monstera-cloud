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
            /** Subscription tier from DB — used for post-login routing */
            plan?: string;
            /** True when the account has a credentials password (step-up for reveal-key, etc.) */
            hasPassword?: boolean;
        };
    }
}

declare module "next-auth/jwt" {
    interface JWT {
        rememberMe?: boolean;
        id?: string;
    }
}
