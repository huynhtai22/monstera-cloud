import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isVerifiedReconnectSuccess,
  resolveReconnectVerification,
} from "./reconnect-verification";

const baselineUpdatedAt = "2026-08-24T10:00:00.000Z";

describe("reconnect verification", () => {
  it("requires a newer, connected, error-free server state for success", () => {
    assert.equal(
      isVerifiedReconnectSuccess(
        {
          status: "connected",
          updatedAt: "2026-08-24T10:00:01.000Z",
          hasError: false,
        },
        baselineUpdatedAt,
      ),
      true,
    );
    assert.equal(
      isVerifiedReconnectSuccess(
        {
          status: "connected",
          updatedAt: "2026-08-24T10:00:01.000Z",
          hasError: true,
        },
        baselineUpdatedAt,
      ),
      false,
    );
    assert.equal(
      isVerifiedReconnectSuccess(
        {
          status: "connected",
          updatedAt: baselineUpdatedAt,
          hasError: false,
        },
        baselineUpdatedAt,
      ),
      false,
    );
  });

  it("distinguishes pending, cancellation, and timeout without false success", () => {
    assert.equal(
      resolveReconnectVerification({
        snapshot: null,
        baselineUpdatedAt,
        popupClosed: false,
        timedOut: false,
      }),
      "pending",
    );
    assert.equal(
      resolveReconnectVerification({
        snapshot: null,
        baselineUpdatedAt,
        popupClosed: true,
        timedOut: false,
      }),
      "cancelled",
    );
    assert.equal(
      resolveReconnectVerification({
        snapshot: null,
        baselineUpdatedAt,
        popupClosed: false,
        timedOut: true,
      }),
      "timeout",
    );
  });
});
