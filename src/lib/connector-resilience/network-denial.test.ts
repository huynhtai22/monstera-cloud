/**
 * Network Denial Guard Comprehensive Verification & Negative Control Test Suite
 *
 * Verifies that the fail-closed network denial guard blocks:
 * 1. globalThis.fetch
 * 2. http.get & http.request
 * 3. https.get & https.request
 * 4. net.connect & net.createConnection
 * 5. tls.connect
 * 6. Cloud metadata endpoints (169.254.169.254)
 * 7. Private RFC 1918 subnets (10.x, 172.16-31.x, 192.168.x)
 * 8. 0.0.0.0 / alternate zero encodings
 * 9. Alternate numeric IP encodings (hex, octal, dword)
 * 10. Redirects to non-loopback destinations
 *
 * And confirms that only strictly validated loopback destinations are permitted.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import {
  installNetworkDenialGuard,
  forceRestoreNetworkGuard,
  NetworkAccessViolationError,
  isAllowedLoopbackHost,
} from "./network-denial-guard";

describe("Network Denial Guard: Multi-Transport Boundary Controls", () => {
  beforeEach(() => {
    installNetworkDenialGuard();
  });

  afterEach(() => {
    forceRestoreNetworkGuard();
  });

  it("Strict Host Validation: permits only 127.0.0.1, ::1, and localhost", () => {
    // Allowed
    assert.equal(isAllowedLoopbackHost("127.0.0.1"), true);
    assert.equal(isAllowedLoopbackHost("::1"), true);
    assert.equal(isAllowedLoopbackHost("[::1]"), true);
    assert.equal(isAllowedLoopbackHost("localhost"), true);
    assert.equal(isAllowedLoopbackHost("LOCALHOST"), true);

    // Disallowed: 0.0.0.0 & zero representations
    assert.equal(isAllowedLoopbackHost("0.0.0.0"), false);
    assert.equal(isAllowedLoopbackHost("0"), false);
    assert.equal(isAllowedLoopbackHost("0.0.0"), false);
    assert.equal(isAllowedLoopbackHost("::"), false);

    // Disallowed: Cloud metadata & Link-local
    assert.equal(isAllowedLoopbackHost("169.254.169.254"), false);
    assert.equal(isAllowedLoopbackHost("169.254.1.1"), false);
    assert.equal(isAllowedLoopbackHost("fe80::1"), false);

    // Disallowed: Private LANs (RFC 1918)
    assert.equal(isAllowedLoopbackHost("10.0.0.1"), false);
    assert.equal(isAllowedLoopbackHost("192.168.1.1"), false);
    assert.equal(isAllowedLoopbackHost("172.16.0.1"), false);
    assert.equal(isAllowedLoopbackHost("172.31.255.255"), false);

    // Disallowed: Alternate numeric IP encodings
    assert.equal(isAllowedLoopbackHost("0x7f000001"), false);
    assert.equal(isAllowedLoopbackHost("2130706433"), false);
    assert.equal(isAllowedLoopbackHost("0177.0.0.1"), false);

    // Disallowed: Public internet hosts
    assert.equal(isAllowedLoopbackHost("graph.facebook.com"), false);
    assert.equal(isAllowedLoopbackHost("googleads.googleapis.com"), false);
    assert.equal(isAllowedLoopbackHost("business-api.tiktok.com"), false);
    assert.equal(isAllowedLoopbackHost("example.com"), false);
  });

  it("Transport 1 (fetch): Blocks external endpoints and cloud metadata", async () => {
    // 1. Meta Graph API
    await assert.rejects(
      async () => fetch("https://graph.facebook.com/v23.0/me"),
      (err: unknown) => {
        assert.ok(err instanceof NetworkAccessViolationError);
        assert.match((err as NetworkAccessViolationError).destination, /graph\.facebook\.com/);
        return true;
      }
    );

    // 2. Google Ads API
    await assert.rejects(
      async () => fetch("https://googleads.googleapis.com/v23/customers/123"),
      (err: unknown) => {
        assert.ok(err instanceof NetworkAccessViolationError);
        assert.match((err as NetworkAccessViolationError).destination, /googleads\.googleapis\.com/);
        return true;
      }
    );

    // 3. Cloud Metadata service
    await assert.rejects(
      async () => fetch("http://169.254.169.254/latest/meta-data/"),
      (err: unknown) => {
        assert.ok(err instanceof NetworkAccessViolationError);
        assert.match((err as NetworkAccessViolationError).destination, /169\.254\.169\.254/);
        return true;
      }
    );

    // 4. 0.0.0.0 destination
    await assert.rejects(
      async () => fetch("http://0.0.0.0:8080/api"),
      (err: unknown) => {
        assert.ok(err instanceof NetworkAccessViolationError);
        return true;
      }
    );
  });

  it("Transport 2 (http.get & http.request): Blocks non-loopback HTTP destinations", () => {
    assert.throws(
      () => {
        http.get("http://api.example.com/data");
      },
      (err: unknown) => {
        assert.ok(err instanceof NetworkAccessViolationError);
        assert.equal((err as NetworkAccessViolationError).transport, "http.get");
        return true;
      }
    );

    assert.throws(
      () => {
        http.request({ hostname: "10.0.0.5", port: 80, path: "/test" });
      },
      (err: unknown) => {
        assert.ok(err instanceof NetworkAccessViolationError);
        assert.equal((err as NetworkAccessViolationError).transport, "http.request");
        return true;
      }
    );
  });

  it("Transport 3 (https.get & https.request): Blocks non-loopback HTTPS destinations", () => {
    assert.throws(
      () => {
        https.get("https://graph.facebook.com/v23.0/me");
      },
      (err: unknown) => {
        assert.ok(err instanceof NetworkAccessViolationError);
        assert.equal((err as NetworkAccessViolationError).transport, "https.get");
        return true;
      }
    );

    assert.throws(
      () => {
        https.request({ hostname: "business-api.tiktok.com", port: 443, path: "/open_api/v1.3/" });
      },
      (err: unknown) => {
        assert.ok(err instanceof NetworkAccessViolationError);
        assert.equal((err as NetworkAccessViolationError).transport, "https.request");
        return true;
      }
    );
  });

  it("Transport 4 (net.connect & net.createConnection): Blocks raw TCP socket creation to remote hosts", () => {
    assert.throws(
      () => {
        net.connect({ host: "8.8.8.8", port: 53 });
      },
      (err: unknown) => {
        assert.ok(err instanceof NetworkAccessViolationError);
        assert.equal((err as NetworkAccessViolationError).transport, "net.connect");
        return true;
      }
    );

    assert.throws(
      () => {
        net.createConnection(5432, "remote-db.production.aws.com");
      },
      (err: unknown) => {
        assert.ok(err instanceof NetworkAccessViolationError);
        assert.equal((err as NetworkAccessViolationError).transport, "net.connect");
        return true;
      }
    );
  });

  it("Transport 5 (tls.connect): Blocks TLS connection establishment to remote hosts", () => {
    assert.throws(
      () => {
        tls.connect({ host: "remote-secure-host.com", port: 443 });
      },
      (err: unknown) => {
        assert.ok(err instanceof NetworkAccessViolationError);
        assert.equal((err as NetworkAccessViolationError).transport, "tls.connect");
        return true;
      }
    );
  });

  it("Redirect Security: Blocks redirect responses attempting to pivot to remote destinations", async () => {
    forceRestoreNetworkGuard();

    // Install simulation handler that attempts to return a 302 redirect to an external remote host
    installNetworkDenialGuard(async (url: string) => {
      if (url.includes("mock-redirect")) {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://attacker-controlled-server.com/exfiltrate" },
        });
      }
      return null;
    });

    await assert.rejects(
      async () => {
        await fetch("http://localhost:3000/mock-redirect");
      },
      (err: unknown) => {
        assert.ok(err instanceof NetworkAccessViolationError);
        assert.equal((err as NetworkAccessViolationError).transport, "fetch:redirect");
        assert.match((err as NetworkAccessViolationError).destination, /attacker-controlled-server\.com/);
        return true;
      }
    );
  });
});
