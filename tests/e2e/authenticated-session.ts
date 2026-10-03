import type { Browser, BrowserContext, Page, StorageState } from "@playwright/test";

export type AuthenticatedSession = { context: BrowserContext; page: Page };
export type AuthenticatedSessionCache = {
  context?: BrowserContext;
  page?: Page;
  storageState?: StorageState;
  loginCount: number;
};

export function createAuthenticatedSessionCache(): AuthenticatedSessionCache {
  return { loginCount: 0 };
}

/**
 * Retains a real, authenticated browser session for specs whose ordered cases
 * intentionally share page state.
 */
export async function sharedAuthenticatedSession(
  browser: Browser,
  cache: AuthenticatedSessionCache,
  authenticate: (page: Page) => Promise<void>,
): Promise<AuthenticatedSession> {
  if (!cache.context || !cache.page) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await authenticate(page);
    cache.loginCount += 1;
    cache.context = context;
    cache.page = page;
  }

  return { context: cache.context, page: cache.page };
}

/**
 * Logs in once, then creates an isolated context from that in-memory storage
 * state for each journey. No storage-state file is written to the worktree.
 */
export async function freshAuthenticatedSession(
  browser: Browser,
  cache: AuthenticatedSessionCache,
  authenticate: (page: Page) => Promise<void>,
): Promise<AuthenticatedSession> {
  if (!cache.storageState) {
    const bootstrap = await browser.newContext();
    try {
      const page = await bootstrap.newPage();
      await authenticate(page);
      cache.loginCount += 1;
      cache.storageState = await bootstrap.storageState();
    } finally {
      await bootstrap.close();
    }
  }

  const context = await browser.newContext({ storageState: cache.storageState });
  return { context, page: await context.newPage() };
}
