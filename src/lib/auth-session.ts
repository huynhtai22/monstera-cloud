import { getServerSession as nextAuthGetServerSession, type Session } from "next-auth";
import { authOptions } from "@/lib/auth";

type SessionOverride = (() => Promise<Session | null>) | null;
let sessionOverride: SessionOverride = null;

/**
 * Retrieves the current NextAuth session with test override capability.
 */
export async function getAuthSession(options = authOptions): Promise<Session | null> {
  if (sessionOverride) {
    return await sessionOverride();
  }
  return await nextAuthGetServerSession(options);
}

/**
 * Test helper to mock the authentication session cleanly in tests.
 */
export function setAuthSessionOverride(override: SessionOverride): void {
  sessionOverride = override;
}
