import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { TENANT_GUARDED_MODELS, TENANT_GUARD_EXEMPTIONS } from "./tenant-guard";

function directWorkspaceOwnedModels(schema: string): string[] {
  const models: string[] = [];
  const modelPattern = /^model\s+(\w+)\s+\{([\s\S]*?)^\}/gm;

  for (const match of schema.matchAll(modelPattern)) {
    const [, modelName, body] = match;
    if (/^\s*workspaceId\s+String(?:\s|$)/m.test(body)) models.push(modelName);
  }
  return models.sort();
}

describe("tenant guard schema coverage", () => {
  it("covers every direct workspace-owned Prisma model or requires an explicit exemption", () => {
    const schema = fs.readFileSync(path.resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
    const directOwners = directWorkspaceOwnedModels(schema);
    const guarded = [...TENANT_GUARDED_MODELS].sort();
    const exemptions = Object.keys(TENANT_GUARD_EXEMPTIONS).sort();

    const unclassified = directOwners.filter(
      (model) => !TENANT_GUARDED_MODELS.has(model) && !(model in TENANT_GUARD_EXEMPTIONS),
    );
    assert.deepEqual(
      unclassified,
      [],
      `Direct workspace-owned models must be guarded or explicitly exempted: ${unclassified.join(", ")}`,
    );

    const staleGuards = guarded.filter((model) => !directOwners.includes(model));
    assert.deepEqual(staleGuards, [], `Guarded models must have a required workspaceId: ${staleGuards.join(", ")}`);

    const staleExemptions = exemptions.filter((model) => !directOwners.includes(model));
    assert.deepEqual(staleExemptions, [], `Exemptions must refer to direct workspace owners: ${staleExemptions.join(", ")}`);

    const duplicatedClassification = guarded.filter((model) => model in TENANT_GUARD_EXEMPTIONS);
    assert.deepEqual(duplicatedClassification, [], "A model cannot be both guarded and exempted");

    for (const [model, rationale] of Object.entries(TENANT_GUARD_EXEMPTIONS)) {
      assert.ok(rationale.trim().length > 0, `${model} exemption requires a rationale`);
    }
  });
});
