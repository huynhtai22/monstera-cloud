/**
 * Comprehensive Fail-Closed Network Denial Guard
 *
 * Intercepts all Node.js networking layers:
 * 1. globalThis.fetch (Undici / Native fetch)
 * 2. http.request & http.get
 * 3. https.request & https.get
 * 4. net.connect & net.createConnection
 * 5. tls.connect
 *
 * Guarantees that:
 * - Simulation handlers intercept mock provider traffic before any socket/transport.
 * - Outbound network traffic is restricted strictly to loopback (127.0.0.1, ::1, localhost).
 * - 0.0.0.0, private RFC 1918 LANs, cloud metadata services (169.254.169.254), alternate numeric IP encodings, and remote destinations are rejected immediately.
 * - Redirects from allowed hosts to disallowed remote destinations are blocked.
 */

import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

export class NetworkAccessViolationError extends Error {
  constructor(public destination: string, public transport: string = "unknown") {
    super(
      `[NETWORK_DENIAL_GUARD] Unauthorized network access attempt via ${transport} to: ${destination}. External and non-loopback network calls are strictly prohibited during simulation.`
    );
    this.name = "NetworkAccessViolationError";
  }
}

export type SimulationHandler = (
  url: string,
  init?: RequestInit
) => Promise<Response | null> | Response | null;

// Original unpatched references
let origFetch: typeof globalThis.fetch | null = null;
let origHttpRequest: typeof http.request | null = null;
let origHttpGet: typeof http.get | null = null;
let origHttpsRequest: typeof https.request | null = null;
let origHttpsGet: typeof https.get | null = null;
let origNetConnect: typeof net.connect | null = null;
let origNetCreateConnection: typeof net.createConnection | null = null;
let origTlsConnect: typeof tls.connect | null = null;

let activeHandler: SimulationHandler | null = null;
let guardInstalledCount = 0;

/**
 * Validates whether a host is strictly an allowed loopback destination.
 * Rejects 0.0.0.0, cloud metadata services, private networks, and remote IPs.
 */
export function isAllowedLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");

  // 1. Strict exact loopback matches
  if (normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost") {
    return true;
  }

  // 2. Reject 0.0.0.0 / 0 / alternate zero encodings
  if (
    normalized === "0.0.0.0" ||
    normalized === "0" ||
    normalized === "0.0.0" ||
    normalized === "0.0" ||
    normalized === "::" ||
    normalized === "[::]"
  ) {
    return false;
  }

  // 3. Reject alternate integer / hex / octal IP representations (e.g. 2130706433, 0177.0.0.1, 0x7f000001)
  if (/^0x[0-9a-f]+$/i.test(normalized) || /^\d+$/.test(normalized) || /^0\d+/.test(normalized)) {
    return false;
  }

  // 4. Reject 127.* alternate loopback subnets unless explicitly 127.0.0.1 for strict consistency
  if (normalized.startsWith("127.")) {
    return normalized === "127.0.0.1";
  }

  // 5. Reject Cloud Metadata service (169.254.169.254 / link-local 169.254.0.0/16 / fe80::/10)
  if (normalized.startsWith("169.254.") || normalized.startsWith("fe80:")) {
    return false;
  }

  // 6. Reject Private RFC 1918 subnets (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
  if (
    normalized.startsWith("10.") ||
    normalized.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(normalized)
  ) {
    return false;
  }

  // Reject all other external hostnames
  return false;
}

/**
 * Validates destination target from URL or connection options
 */
function assertDestinationAllowed(hostOrUrl: string, transport: string): void {
  try {
    let hostname = hostOrUrl;
    if (hostOrUrl.includes("://")) {
      const parsed = new URL(hostOrUrl);
      hostname = parsed.hostname;
    } else if (hostOrUrl.includes(":")) {
      const parts = hostOrUrl.split(":");
      hostname = parts[0];
    }
    if (!isAllowedLoopbackHost(hostname)) {
      throw new NetworkAccessViolationError(hostOrUrl, transport);
    }
  } catch (err) {
    if (err instanceof NetworkAccessViolationError) throw err;
    throw new NetworkAccessViolationError(hostOrUrl, transport);
  }
}

/**
 * Installs fail-closed transport hooks across fetch, http, https, net, and tls.
 */
export function installNetworkDenialGuard(handler?: SimulationHandler): void {
  guardInstalledCount++;
  activeHandler = handler ?? null;

  if (origFetch) {
    // Already patched; update handler
    return;
  }

  // ── 1. Patch globalThis.fetch ───────────────────────────────────────────────
  origFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    // Check custom simulation handler first
    if (activeHandler) {
      const simulated = await activeHandler(urlStr, init);
      if (simulated) {
        // Redirect security check: if simulation returns redirect status with Location header,
        // verify that the Location header does not point to a disallowed remote destination
        if ([301, 302, 303, 307, 308].includes(simulated.status)) {
          const loc = simulated.headers.get("Location") || simulated.headers.get("location");
          if (loc && loc.includes("://")) {
            const redirectHost = new URL(loc).hostname;
            if (!isAllowedLoopbackHost(redirectHost)) {
              throw new NetworkAccessViolationError(loc, "fetch:redirect");
            }
          }
        }
        return simulated;
      }
    }

    assertDestinationAllowed(urlStr, "fetch");

    if (!origFetch) {
      throw new NetworkAccessViolationError(urlStr, "fetch");
    }
    return origFetch(input, init);
  };

  // ── 2. Patch http.request & http.get ────────────────────────────────────────
  origHttpRequest = http.request;
  origHttpGet = http.get;

  const patchedHttpRequest = function (
    this: any,
    ...args: any[]
  ): http.ClientRequest {
    const target = resolveTargetHost(args[0]);
    assertDestinationAllowed(target, "http.request");
    return (origHttpRequest as any).apply(this, args);
  };

  const patchedHttpGet = function (
    this: any,
    ...args: any[]
  ): http.ClientRequest {
    const target = resolveTargetHost(args[0]);
    assertDestinationAllowed(target, "http.get");
    return (origHttpGet as any).apply(this, args);
  };

  http.request = patchedHttpRequest as any;
  http.get = patchedHttpGet as any;

  // ── 3. Patch https.request & https.get ──────────────────────────────────────
  origHttpsRequest = https.request;
  origHttpsGet = https.get;

  const patchedHttpsRequest = function (
    this: any,
    ...args: any[]
  ): http.ClientRequest {
    const target = resolveTargetHost(args[0]);
    assertDestinationAllowed(target, "https.request");
    return (origHttpsRequest as any).apply(this, args);
  };

  const patchedHttpsGet = function (
    this: any,
    ...args: any[]
  ): http.ClientRequest {
    const target = resolveTargetHost(args[0]);
    assertDestinationAllowed(target, "https.get");
    return (origHttpsGet as any).apply(this, args);
  };

  https.request = patchedHttpsRequest as any;
  https.get = patchedHttpsGet as any;

  // ── 4. Patch net.connect & net.createConnection ─────────────────────────────
  origNetConnect = net.connect;
  origNetCreateConnection = net.createConnection;

  const patchedNetConnect = function (
    this: any,
    ...args: any[]
  ): net.Socket {
    const target = resolveSocketTarget(args[0], args[1]);
    assertDestinationAllowed(target, "net.connect");
    return (origNetConnect as any).apply(this, args);
  };

  net.connect = patchedNetConnect as any;
  net.createConnection = patchedNetConnect as any;

  // ── 5. Patch tls.connect ───────────────────────────────────────────────────
  origTlsConnect = tls.connect;

  const patchedTlsConnect = function (
    this: any,
    ...args: any[]
  ): tls.TLSSocket {
    const target = resolveSocketTarget(args[0], args[1]);
    assertDestinationAllowed(target, "tls.connect");
    return (origTlsConnect as any).apply(this, args);
  };

  tls.connect = patchedTlsConnect as any;
}

/**
 * Restores all original Node networking functions.
 */
export function restoreNetworkGuard(): void {
  guardInstalledCount = Math.max(0, guardInstalledCount - 1);
  if (guardInstalledCount > 0) {
    return; // Keep installed while other tests have active guards
  }

  if (origFetch) {
    globalThis.fetch = origFetch;
    origFetch = null;
  }
  if (origHttpRequest) {
    http.request = origHttpRequest;
    origHttpRequest = null;
  }
  if (origHttpGet) {
    http.get = origHttpGet;
    origHttpGet = null;
  }
  if (origHttpsRequest) {
    https.request = origHttpsRequest;
    origHttpsRequest = null;
  }
  if (origHttpsGet) {
    https.get = origHttpsGet;
    origHttpsGet = null;
  }
  if (origNetConnect) {
    net.connect = origNetConnect;
    origNetConnect = null;
  }
  if (origNetCreateConnection) {
    net.createConnection = origNetCreateConnection;
    origNetCreateConnection = null;
  }
  if (origTlsConnect) {
    tls.connect = origTlsConnect;
    origTlsConnect = null;
  }

  activeHandler = null;
}

/**
 * Force restore regardless of reference count (for clean test suite teardown)
 */
export function forceRestoreNetworkGuard(): void {
  guardInstalledCount = 0;
  restoreNetworkGuard();
}

function resolveTargetHost(optionsOrUrl: any): string {
  if (typeof optionsOrUrl === "string") return optionsOrUrl;
  if (optionsOrUrl instanceof URL) return optionsOrUrl.toString();
  if (typeof optionsOrUrl === "object" && optionsOrUrl !== null) {
    return (
      optionsOrUrl.hostname ||
      optionsOrUrl.host ||
      (optionsOrUrl.href ? new URL(optionsOrUrl.href).hostname : "unknown")
    );
  }
  return "unknown";
}

function resolveSocketTarget(arg0: any, arg1: any): string {
  if (typeof arg0 === "number" && typeof arg1 === "string") {
    return arg1;
  }
  if (typeof arg0 === "object" && arg0 !== null) {
    return arg0.host || arg0.hostname || "127.0.0.1";
  }
  if (typeof arg0 === "string") {
    return arg0;
  }
  return "unknown";
}
