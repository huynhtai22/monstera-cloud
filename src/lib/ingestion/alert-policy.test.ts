import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyIngestionError, describeNextAction, nextActionForError } from "./error-taxonomy";
import { shouldNotifyIngestionFailure, shouldNotifyStale } from "./alert-policy";

describe("ingestion alert policy", () => {
  it("notifies auth immediately and tells the user to reconnect", () => {
    const classified = classifyIngestionError("invalid_grant: access token expired");
    const decision = shouldNotifyIngestionFailure({ classified, retryCount: 0, maxRetries: 3 });
    assert.equal(decision.notify, true);
    assert.equal(decision.reason, "auth");
    assert.equal(decision.action, "reconnect");
    assert.match(describeNextAction(decision.action), /reconnect/i);
  });

  it("does not notify a first network failure, but does notify exhausted retries", () => {
    const classified = classifyIngestionError("fetch failed: etimedout");
    assert.equal(nextActionForError(classified), "retry");
    assert.equal(
      shouldNotifyIngestionFailure({ classified, retryCount: 1, maxRetries: 3 }).notify,
      false,
    );
    const exhausted = shouldNotifyIngestionFailure({ classified, retryCount: 3, maxRetries: 3 });
    assert.equal(exhausted.notify, true);
    assert.equal(exhausted.reason, "exhausted_retries");
  });

  it("does not notify a successful 0-row sync and treats 26h as stale", () => {
    assert.equal(shouldNotifyIngestionFailure({ classified: null, rowsSynced: 0 }).notify, false);
    assert.equal(shouldNotifyStale(25), false);
    assert.equal(shouldNotifyStale(26), true);
  });
});
