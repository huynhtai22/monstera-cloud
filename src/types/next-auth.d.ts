import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
    interface User {
        rememberMe?: boolean;
    }
}

declare module "next-auth/jwt" {
    interface JWT {
        rememberMe?: boolean;
        id?: string;
    }
}
