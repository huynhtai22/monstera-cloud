import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { GET } from "./route";

const priorSecret = process.env.CRON_SECRET;

describe("GET /api/cron/seat-sharing-retention", () => {
  afterEach(() => {
    if (priorSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = priorSecret;
  });

  it("rejects requests without the cron secret", async () => {
    process.env.CRON_SECRET = "seat-sharing-retention-test-secret-32";
    const response = await GET(new Request("https://example.test/api/cron/seat-sharing-retention"));
    assert.equal(response.status, 401);
  });
});
