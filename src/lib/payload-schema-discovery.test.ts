import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describePayloadFields, hashPayloadSchema } from "./payload-schema-discovery";

describe("describePayloadFields", () => {
  it("records key names and types, never values", () => {
    const fields = describePayloadFields({
      campaign_id: "SECRET-ID",
      spend: 12.5,
      nested: { token: "nope" },
    });
    assert.deepEqual(
      fields.map((f) => f.name).sort(),
      ["campaign_id", "nested", "spend"],
    );
    assert.ok(fields.every((f) => !JSON.stringify(f).includes("SECRET") && !JSON.stringify(f).includes("nope")));
    assert.equal(fields.find((f) => f.name === "spend")?.type, "number");
  });

  it("hashes are stable for the same keys", () => {
    const a = describePayloadFields({ b: 1, a: "x" });
    const b = describePayloadFields({ a: "y", b: 2 });
    assert.equal(hashPayloadSchema(a), hashPayloadSchema(b));
  });
});
