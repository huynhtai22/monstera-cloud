/**
 * Network Denial Guard
 *
 * Strict fail-closed boundary that intercepts global fetch and blocks any
 * outbound network calls to external (non-loopback / non-simulated) hosts.
 * Proves that resilience experiments cannot touch live provider infrastructure.
 */

export class NetworkAccessViolationError extends Error {
  constructor(public url: string) {
    super(`[NETWORK_DENIAL_GUARD] Unauthorized network access attempt to: ${url}. Outbound network calls are strictly prohibited during simulation.`);
    this.name = "NetworkAccessViolationError";
  }
}

type FetchFn = typeof globalThis.fetch;

let originalFetch: FetchFn | null = null;
let customHandler: ((url: string, init?: RequestInit) => Promise<Response | null> | Response | null) | null = null;

const ALLOWED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
]);

export function installNetworkDenialGuard(
  handler?: (url: string, init?: RequestInit) => Promise<Response | null> | Response | null
): void {
  if (!originalFetch) {
    originalFetch = globalThis.fetch;
  }
  customHandler = handler ?? null;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    // Check if custom simulation handler intercepts the request
    if (customHandler) {
      const simulated = await customHandler(urlStr, init);
      if (simulated) {
        return simulated;
      }
    }

    // Otherwise check URL host
    try {
      const parsed = new URL(urlStr);
      if (ALLOWED_HOSTS.has(parsed.hostname)) {
        if (!originalFetch) {
          throw new NetworkAccessViolationError(urlStr);
        }
        return originalFetch(input, init);
      }
    } catch (e) {
      if (e instanceof NetworkAccessViolationError) throw e;
    }

    throw new NetworkAccessViolationError(urlStr);
  };
}

export function restoreNetworkGuard(): void {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = null;
  }
  customHandler = null;
}
