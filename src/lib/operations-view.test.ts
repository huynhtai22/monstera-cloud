import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeOperationsReason,
  formatEvidenceDay,
  formatEvidenceTimestamp,
  operationsStateLabel,
  operationsStateTone,
  operationsTruncationNotice,
} from "./operations-view";

describe("operations view helpers", () => {
  it("maps every section state onto a presentation tone", () => {
    assert.equal(operationsStateTone("ready"), "ok");
    assert.equal(operationsStateTone("attention"), "warn");
    assert.equal(operationsStateTone("unavailable"), "danger");
    assert.equal(operationsStateTone("unsupported"), "info");
    assert.equal(operationsStateTone("empty"), "neutral");
  });

  it("labels every section state with non-empty copy", () => {
    const states = ["ready", "attention", "empty", "unsupported", "unavailable"] as const;
    for (const state of states) {
      const label = operationsStateLabel(state);
      assert.equal(typeof label, "string");
      assert.ok(label.length > 0, `${state} must have a label`);
    }
    assert.equal(operationsStateLabel("attention"), "Needs attention");
    assert.equal(operationsStateLabel("unsupported"), "Not applicable");
  });

  it("explains the client-scoped ingestion gap in user terms without leaking the reason code", () => {
    const copy = describeOperationsReason("import_jobs_not_client_attributable");
    assert.match(copy, /All clients/);
    assert.equal(copy.includes("import_jobs_not_client_attributable"), false);
  });

  it("falls back to a generic explanation for a missing or unknown reason", () => {
    assert.equal(describeOperationsReason(null), describeOperationsReason("operations_section_unavailable"));
    assert.equal(describeOperationsReason(undefined), describeOperationsReason("operations_section_unavailable"));
    assert.match(describeOperationsReason("some_future_reason"), /no evidence/i);
  });

  it("formats evidence timestamps and days deterministically in UTC", () => {
    assert.equal(formatEvidenceTimestamp("2026-09-04T12:34:56.000Z"), "2026-09-04 12:34 UTC");
    assert.equal(formatEvidenceTimestamp(null), "—");
    assert.equal(formatEvidenceTimestamp(undefined), "—");
    assert.equal(formatEvidenceTimestamp("not-a-date"), "not-a-date");
    assert.equal(formatEvidenceDay("2026-09-04T00:00:00.000Z"), "2026-09-04");
    assert.equal(formatEvidenceDay(null), "—");
    assert.equal(formatEvidenceDay("nonsense"), "nonsense");
  });

  it("phrases the truncation notice with the bound and the unit", () => {
    assert.equal(
      operationsTruncationNotice(25, "rows"),
      "Showing the first 25 rows. More exist in this scope.",
    );
    assert.equal(
      operationsTruncationNotice(10, "clients"),
      "Showing the first 10 clients. More exist in this scope.",
    );
  });
});
