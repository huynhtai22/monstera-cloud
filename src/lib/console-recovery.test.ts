import assert from "node:assert/strict";
import test from "node:test";
import type { SourceState } from "./source-list-display";
import {
  reportRecoveryHref,
  sourceRecoveryHref,
  sourceTrustFacts,
  validRecoveryWindow,
} from "./console-recovery";

const connected: SourceState = {
  kind: "connected",
  label: "Connected",
  subtext: "Active & verified",
  detail: "Authorized and has at least one successful sync.",
  needsReconnect: false,
  canSync: true,
};

test("recovery links retain the client and reporting window", () => {
  const window = { start: "2026-08-01", end: "2026-08-31" };
  const source = new URL(
    sourceRecoveryHref("connection/with space", "client-1", window),
    "https://console.example",
  );
  assert.equal(source.pathname, "/sources/connection%2Fwith%20space");
  assert.equal(source.searchParams.get("clientId"), "client-1");
  assert.equal(source.searchParams.get("startDate"), window.start);
  assert.equal(source.searchParams.get("endDate"), window.end);
  assert.equal(source.hash, "#source-recovery");

  const report = new URL(reportRecoveryHref("client-1", window), "https://console.example");
  assert.equal(report.pathname, "/reports");
  assert.equal(report.searchParams.get("clientId"), "client-1");
  assert.equal(report.searchParams.get("view"), "performance");
  assert.equal(report.hash, "#report-readiness");
});

test("all-clients recovery links preserve the UI scope token", () => {
  const href = sourceRecoveryHref("connection-1", "all");
  assert.equal(new URL(href, "https://console.example").searchParams.get("clientId"), "all");
});

test("recovery windows reject impossible and reversed dates", () => {
  assert.deepEqual(validRecoveryWindow("2026-08-01", "2026-08-31"), {
    start: "2026-08-01",
    end: "2026-08-31",
  });
  assert.equal(validRecoveryWindow("2026-02-30", "2026-03-01"), undefined);
  assert.equal(validRecoveryWindow("2026-09-01", "2026-08-31"), undefined);
});

test("source trust distinguishes authorization from evidence of a successful import", () => {
  assert.deepEqual(
    sourceTrustFacts(connected, "2026-09-27T13:42:00.000Z", "2026-09-26T00:00:00.000Z"),
    {
      authorization: "Connected",
      latestSuccessfulImport: "2026-09-27T13:42:00.000Z",
      dataThrough: "2026-09-26",
    },
  );
  assert.equal(
    sourceTrustFacts({ ...connected, needsReconnect: true }, null, null).authorization,
    "Action required",
  );
  assert.equal(sourceTrustFacts(connected, "Never", null).latestSuccessfulImport, null);
});
