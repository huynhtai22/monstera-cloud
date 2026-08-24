import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveReleaseIdentity } from "./release-identity";

describe("release identity", () => {
  it("prefers the immutable build stamp over stale runtime metadata", () => {
    assert.deepEqual(
      resolveReleaseIdentity({
        buildCommitSha: "0a3b6813829725ebf0fd8ac0c5b827184b204c2b",
        vercelCommitSha: "70c1ac720763378947044cbcb0a4bbe2c5fe098b",
      }),
      {
        commitSha: "0a3b6813829725ebf0fd8ac0c5b827184b204c2b",
        commitSource: "build",
      },
    );
  });

  it("falls back to Vercel metadata when no valid build stamp exists", () => {
    assert.deepEqual(
      resolveReleaseIdentity({
        buildCommitSha: "development",
        vercelCommitSha: "70c1ac720763378947044cbcb0a4bbe2c5fe098b",
      }),
      {
        commitSha: "70c1ac720763378947044cbcb0a4bbe2c5fe098b",
        commitSource: "vercel",
      },
    );
  });

  it("does not expose malformed environment values as release identity", () => {
    assert.deepEqual(
      resolveReleaseIdentity({
        buildCommitSha: "not-a-sha",
        vercelCommitSha: "also-not-a-sha",
      }),
      { commitSha: "development", commitSource: "development" },
    );
  });
});
