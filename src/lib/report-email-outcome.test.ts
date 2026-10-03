import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyApprovedEmailException,
  classifyApprovedEmailResponse,
} from "./report-email-outcome";

describe("approved report email outcome classification", () => {
  it("records provider acceptance and its message id", () => {
    assert.deepEqual(classifyApprovedEmailResponse({ data: { id: "resend-123" }, error: null }), {
      status: "ACCEPTED",
      providerMessageId: "resend-123",
    });
  });

  it("records a provider rejection without exposing its message", () => {
    assert.deepEqual(classifyApprovedEmailResponse({ data: null, error: { message: "private provider detail" } }), {
      status: "DEFINITIVE_FAILED",
      failureCode: "provider_rejected",
    });
  });

  it("treats provable pre-connection failures as definitive and other transport errors as ambiguous", () => {
    assert.deepEqual(classifyApprovedEmailException({ cause: { code: "ENOTFOUND" } }), {
      status: "DEFINITIVE_FAILED",
      failureCode: "pre_connection_failure",
    });
    assert.deepEqual(classifyApprovedEmailException(new Error("request timed out")), {
      status: "AMBIGUOUS",
      failureCode: "transport_ambiguous",
    });
  });
});
