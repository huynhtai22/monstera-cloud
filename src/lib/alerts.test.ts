import assert from "node:assert/strict";
import { it } from "node:test";
import { shouldFailHealthTickForAlertDelivery } from "./alerts";

it("stops treating an old dead-letter count as a permanent health-tick failure", () => {
  assert.equal(shouldFailHealthTickForAlertDelivery({ pending: 0, deadLettered: 0 }), false);
  assert.equal(shouldFailHealthTickForAlertDelivery({ pending: 0, deadLettered: 1 }), true);
  assert.equal(shouldFailHealthTickForAlertDelivery({ pending: 1, deadLettered: 0 }), true);
  // A historical dead letter remains visible in telemetry but does not keep
  // all later health checks red once no delivery attempt failed this tick.
  assert.equal(shouldFailHealthTickForAlertDelivery({ pending: 0, deadLettered: 0 }), false);
});
