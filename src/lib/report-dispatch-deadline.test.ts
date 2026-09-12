import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import http from "node:http";
import type { Socket } from "node:net";
import {
  DISPATCH_LEASE_TTL_MS,
  DISPATCH_OVERALL_DEADLINE_MS,
  DISPATCH_PER_REQUEST_TIMEOUT_MS,
  sendSlackWebhook,
  sendTelegramBrief,
} from "./report-dispatch";
import { sendClientBriefEmail } from "./mail";

// The dispatch deadline must be enforced with GENUINE transport cancellation:
// AbortSignals reach the underlying fetch and tear the connection down, so no
// delivery can outlive the budget and be redelivered by a reclaiming sweep.
describe("report dispatch delivery deadline", () => {
  const originalFetch = globalThis.fetch;
  const originalResendKey = process.env.RESEND_API_KEY;
  const originalTelegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalResendKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalResendKey;
    if (originalTelegramToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = originalTelegramToken;
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  /** Loopback server that accepts connections and never responds. */
  const startStallServer = async (): Promise<{
    url: string;
    connectionsOpened: () => number;
    socketsClosed: () => number;
    close: () => Promise<void>;
  }> => {
    const sockets = new Set<Socket>();
    let closed = 0;
    let opened = 0;
    const server = http.createServer(() => {
      /* never respond */
    });
    server.on("connection", (socket) => {
      opened++;
      sockets.add(socket);
      socket.on("close", () => {
        closed++;
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    cleanups.push(() => {
      for (const socket of sockets) socket.destroy();
      server.close();
    });
    return {
      url: `http://127.0.0.1:${address.port}/hook`,
      connectionsOpened: () => opened,
      socketsClosed: () => closed,
      close: async () => {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      },
    };
  };

  it("keeps the production budget strictly inside the lease TTL", () => {
    assert.ok(
      DISPATCH_PER_REQUEST_TIMEOUT_MS < DISPATCH_OVERALL_DEADLINE_MS,
      "per-request timeout must be below the overall deadline",
    );
    assert.ok(
      DISPATCH_OVERALL_DEADLINE_MS < DISPATCH_LEASE_TTL_MS,
      "overall deadline must be below the dispatch lease TTL",
    );
    assert.ok(
      DISPATCH_LEASE_TTL_MS - DISPATCH_OVERALL_DEADLINE_MS >= 60_000,
      "at least one minute of safety margin before the lease expires",
    );
  });

  it("genuinely aborts a Slack request against an endpoint that never responds", { timeout: 20000 }, async () => {
    const stall = await startStallServer();
    const startedAt = Date.now();
    const delivered = await sendSlackWebhook(stall.url, "deadline probe", {
      perRequestTimeoutMs: 250,
    });
    const elapsed = Date.now() - startedAt;

    assert.equal(delivered, false, "stalled delivery is classified as failed");
    assert.ok(elapsed < 5_000, `request was cancelled promptly (took ${elapsed}ms, undici's default would be ~300s)`);
    assert.ok(stall.connectionsOpened() >= 1, "the connection was really attempted");
    // The server observes the client-side teardown one tick later; wait for
    // the close event with a bounded poll (event, not timing, based).
    let tornDown = stall.socketsClosed() >= 1;
    for (let waited = 0; !tornDown && waited < 2_000; waited += 25) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      tornDown = stall.socketsClosed() >= 1;
    }
    assert.ok(tornDown, "the aborted request tore the connection down instead of leaving it running");
    await stall.close();
  });

  it("prevents provider contact entirely when the overall signal is already aborted", { timeout: 20000 }, async () => {
    const stall = await startStallServer();
    const controller = new AbortController();
    controller.abort(new Error("deadline already exceeded"));

    const delivered = await sendSlackWebhook(stall.url, "probe", {
      signal: controller.signal,
      perRequestTimeoutMs: 5_000,
    });

    assert.equal(delivered, false);
    assert.equal(stall.connectionsOpened(), 0, "an already-aborted overall signal must not open a connection");
    await stall.close();
  });

  it("propagates the deadline signal through the Telegram transport", { timeout: 20000 }, async () => {
    process.env.TELEGRAM_BOT_TOKEN = "review-test-token";
    // Undici implements the same contract this stub does: reject with the
    // abort reason once the composed signal fires. The stub records that the
    // signal was really observed by the transport.
    let transportObservedAbort = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      await new Promise<void>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          transportObservedAbort = true;
          reject(init.signal!.reason);
        });
      });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const keepAlive = setInterval(() => {}, 250);
    let delivered = false;
    const startedAt = Date.now();
    try {
      delivered = await sendTelegramBrief("review-test-token", "123456789", "probe", {
        perRequestTimeoutMs: 250,
      });
    } finally {
      clearInterval(keepAlive);
    }
    const elapsed = Date.now() - startedAt;

    assert.equal(delivered, false, "stalled Telegram delivery is classified as failed");
    assert.ok(elapsed < 5_000, `request was cancelled promptly (took ${elapsed}ms)`);
    assert.ok(transportObservedAbort, "the composed deadline signal reached the transport");
  });

  it("bounds the email transport via its composed signal", { timeout: 20000 }, async () => {
    process.env.RESEND_API_KEY = "re_review-test-key";
    const controller = new AbortController();
    controller.abort(new Error("deadline already exceeded"));

    const startedAt = Date.now();
    const result = await sendClientBriefEmail(
      "recipient@example.test",
      "Review Client",
      "Review Workspace",
      "# brief",
      { signal: controller.signal },
    );
    const elapsed = Date.now() - startedAt;

    assert.equal(result.success, false, "an aborted deadline fails the email send");
    assert.ok(elapsed < 2_000, "the pre-aborted signal fails immediately without contacting the provider");
  });
});
