const SESSION_KEY = "monstera_app_return";

/** Remember last in-app path so marketing “Console” can return the user there. */
export function rememberAppPath(pathname: string): void {
    if (typeof window === "undefined") return;
    if (!pathname || pathname === "/") return;
    try {
        sessionStorage.setItem(SESSION_KEY, pathname);
    } catch {
        /* private mode / quota */
    }
}

/** Safe in-app path for <Link href>; falls back to dashboard. */
export function readAppReturnPath(fallback = "/console"): string {
    if (typeof window === "undefined") return fallback;
    try {
        const p = sessionStorage.getItem(SESSION_KEY);
        if (p && p.startsWith("/") && !p.startsWith("//") && !p.includes(":")) {
            return p;
        }
    } catch {
        /* ignore */
    }
    return fallback;
}
