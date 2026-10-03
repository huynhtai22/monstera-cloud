import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("Shopee Campaigns Sheets export", () => {
  it("is warehouse-backed, includes the sandbox label, and does not call Shopee", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/app/api/addon/shopee-report/route.ts"), "utf8");
    assert.match(source, /"shopee_campaigns"/);
    assert.match(source, /shopeeCampaign\.findMany/);
    assert.match(source, /Shopee \$\{row\.environment === "sandbox" \? "Sandbox"/);
    assert.doesNotMatch(source, /\bfetch\s*\(/);
  });
});
