import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";

describe("Client/Server Dependency Boundary Enforcement", () => {
  const repoRoot = path.resolve(__dirname, "../../..");
  const metaContractPath = path.join(repoRoot, "src/lib/meta-ads-contract.ts");
  const metaPagePath = path.join(repoRoot, "src/app/(app)/meta-ads/page.tsx");

  it("1. meta-ads-contract.ts has zero imports of Node built-ins, Prisma, server telemetry or credentials", () => {
    const content = fs.readFileSync(metaContractPath, "utf8");

    // Prohibit Node built-in imports
    assert.ok(!/import\s+.*from\s+['"]node:async_hooks['"]/.test(content), "Must not import node:async_hooks");
    assert.ok(!/import\s+.*from\s+['"]node:crypto['"]/.test(content), "Must not import node:crypto");
    assert.ok(!/import\s+.*from\s+['"]node:fs['"]/.test(content), "Must not import node:fs");
    assert.ok(!/import\s+.*from\s+['"]async_hooks['"]/.test(content), "Must not import async_hooks");

    // Prohibit server-only and server telemetry modules
    assert.ok(!/import\s+.*from\s+['"].*connector-telemetry['"]/.test(content), "Must not import connector-telemetry");
    assert.ok(!/import\s+.*from\s+['"]server-only['"]/.test(content), "Must not import server-only");
    assert.ok(!/import\s+.*from\s+['"]@prisma\/client['"]/.test(content), "Must not import prisma");
    assert.ok(!/import\s+.*from\s+['"].*meta-ads['"]/.test(content), "Must not import server meta-ads");
  });

  it("2. meta-ads client page imports solely from meta-ads-contract and not server modules", () => {
    const content = fs.readFileSync(metaPagePath, "utf8");

    assert.ok(
      content.includes('@/lib/meta-ads-contract') || content.includes('../../../lib/meta-ads-contract'),
      "meta-ads page must import contract definitions"
    );
    assert.ok(!content.includes('@/lib/meta-ads"'), "meta-ads page must not import server meta-ads");
    assert.ok(!content.includes('@/lib/meta-ads;'), "meta-ads page must not import server meta-ads");
    assert.ok(!content.includes("connector-telemetry"), "meta-ads page must not import connector telemetry");
  });

  it("3. No client-side page imports server connector modules or telemetry directly", () => {
    const appDir = path.join(repoRoot, "src/app");
    
    function scanDir(dir: string, fileList: string[] = []): string[] {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath, fileList);
        } else if (entry.isFile() && (entry.name.endsWith(".tsx") || entry.name.endsWith(".jsx"))) {
          fileList.push(fullPath);
        }
      }
      return fileList;
    }

    const clientFiles = scanDir(appDir);
    const forbiddenImports = [
      '@/lib/meta-ads"',
      '@/lib/google-ads"',
      '@/lib/tiktok-business"',
      '@/lib/observability/connector-telemetry"',
      'node:async_hooks',
    ];

    for (const file of clientFiles) {
      const content = fs.readFileSync(file, "utf8");
      // Check if file is a client component ("use client")
      if (content.includes('"use client"') || content.includes("'use client'")) {
        for (const forbidden of forbiddenImports) {
          assert.ok(
            !content.includes(forbidden),
            `Client file ${path.relative(repoRoot, file)} contains forbidden server import: ${forbidden}`
          );
        }
      }
    }
  });
});
