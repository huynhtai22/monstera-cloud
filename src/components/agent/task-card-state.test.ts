import assert from "node:assert/strict";
import { it } from "node:test";
import type { AgentSnapshot } from "@/hooks/use-agent-run";
import { taskCardState, taskImportProgress } from "./task-card-state";

const task: AgentSnapshot["tasks"][number] = {
  id: "task",
  provider: "meta_ads",
  state: "waiting_authorization",
  scopeRevision: 0,
  version: 0,
  reasonCode: null,
  requestedScope: null,
  confirmedScope: null,
  importJobId: null,
  result: null,
};
it("never claims completion from connection or an empty import", () => {
  assert.equal(
    taskCardState({ ...task, state: "ready" }, false).status,
    "waiting",
  );
  assert.equal(
    taskCardState(
      {
        ...task,
        state: "ready",
        result: {
          verified: true,
          rowsCount: 0,
          totalItems: 1,
          completedItems: 1,
        },
      },
      false,
    ).status,
    "waiting",
  );
  const result = taskCardState(
    {
      ...task,
      state: "ready",
      result: {
        verified: true,
        rowsCount: 12,
        totalItems: 1,
        completedItems: 1,
      },
    },
    false,
  );
  assert.equal(result.status, "complete");
  assert.match(result.label, /output review remains separate/);
});
it("runs motion only during active work and stops it when paused", () => {
  assert.equal(
    taskCardState({ ...task, state: "importing" }, false).status,
    "running",
  );
  assert.equal(
    taskCardState({ ...task, state: "importing" }, true).status,
    "paused",
  );
  assert.equal(
    taskCardState({ ...task, state: "waiting_selection" }, false).status,
    "waiting",
  );
});
it("never renders missing retry progress as undefined counts", () => {
  assert.equal(
    taskImportProgress({ ...task, state: "queued" }),
    "Import queued",
  );
  assert.equal(taskImportProgress(task), "No import outcome recorded yet");
  assert.equal(
    taskImportProgress({
      ...task,
      result: {
        verified: false,
        rowsCount: 0,
        totalItems: 2,
        completedItems: 0,
      },
    }),
    "0 of 2 account imports checked",
  );
});
