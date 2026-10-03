import test from "node:test";
import assert from "node:assert/strict";
import { consoleTransitionKey } from "./console-motion";

test("canonical source view does not replay entrance", () => {
  assert.equal(consoleTransitionKey("/sources", "clientId=north"), consoleTransitionKey("/sources", "tab=connected&clientId=north"));
});
test("query order changes do not replay entrance", () => {
  assert.equal(consoleTransitionKey("/reports", "view=readiness&clientId=north"), consoleTransitionKey("/reports", "clientId=north&view=readiness"));
});
test("different scope and subsection retain distinct transitions", () => {
  assert.notEqual(consoleTransitionKey("/sources", "tab=accounts"), consoleTransitionKey("/sources", "tab=available"));
  assert.notEqual(consoleTransitionKey("/reports", "clientId=north"), consoleTransitionKey("/reports", "clientId=forma"));
});
