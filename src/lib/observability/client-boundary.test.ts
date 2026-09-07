import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

interface ModuleImport {
  specifier: string;
  isTypeOnly: boolean;
  kind: "import" | "export" | "dynamic_import" | "require";
}

const NODE_BUILTINS = new Set([
  "async_hooks", "child_process", "cluster", "crypto", "dgram", "dns",
  "fs", "fs/promises", "http", "http2", "https", "net", "os", "path",
  "perf_hooks", "process", "punycode", "querystring", "readline", "repl",
  "stream", "stream/promises", "string_decoder", "timers", "timers/promises",
  "tls", "trace_events", "tty", "url", "util", "v8", "vm", "wasi",
  "worker_threads", "zlib"
]);

const FORBIDDEN_SERVER_MODULE_PREFIXES = [
  "server-only",
  "@prisma/client",
  "@/lib/observability/connector-telemetry",
  "@/lib/sync-connection",
  "@/lib/connection-data-through",
  "@/lib/google-ads",
  "@/lib/tiktok-business",
];

function isForbiddenSpecifier(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true;
  if (NODE_BUILTINS.has(specifier)) return true;
  if (FORBIDDEN_SERVER_MODULE_PREFIXES.some(prefix => specifier === prefix || specifier.startsWith(prefix + "/"))) {
    return true;
  }
  // meta-ads server module vs meta-ads-contract
  if (specifier === "@/lib/meta-ads" || specifier.endsWith("/meta-ads")) {
    return true;
  }
  return false;
}

/**
 * Extracts all import and export module specifiers using the TypeScript AST parser.
 */
export function extractAstImports(sourceText: string, fileName = "test.ts"): ModuleImport[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  const results: ModuleImport[] = [];

  function visit(node: ts.Node) {
    // 1. Static import declaration: import ... from '...'
    if (ts.isImportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const isTypeOnly = Boolean(node.importClause?.isTypeOnly);
        results.push({
          specifier: node.moduleSpecifier.text,
          isTypeOnly,
          kind: "import",
        });
      }
    }

    // 2. Export declaration: export ... from '...'
    if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const isTypeOnly = Boolean(node.isTypeOnly);
        results.push({
          specifier: node.moduleSpecifier.text,
          isTypeOnly,
          kind: "export",
        });
      }
    }

    // 3. Dynamic import: import('...') or require('...')
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
          results.push({
            specifier: arg.text,
            isTypeOnly: false,
            kind: "dynamic_import",
          });
        }
      } else if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
          results.push({
            specifier: arg.text,
            isTypeOnly: false,
            kind: "require",
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
}

/**
 * Validates that a source string does not contain forbidden server imports.
 */
export function findForbiddenImports(sourceText: string, fileName = "test.ts"): ModuleImport[] {
  const imports = extractAstImports(sourceText, fileName);
  return imports.filter(imp => !imp.isTypeOnly && isForbiddenSpecifier(imp.specifier));
}

describe("Client/Server Dependency Boundary Enforcement (AST-Verified)", () => {
  const repoRoot = path.resolve(__dirname, "../../..");
  const metaContractPath = path.join(repoRoot, "src/lib/meta-ads-contract.ts");
  const metaPagePath = path.join(repoRoot, "src/app/(app)/meta-ads/page.tsx");

  it("1. meta-ads-contract.ts has zero AST imports of Node built-ins, Prisma, server telemetry or credentials", () => {
    const content = fs.readFileSync(metaContractPath, "utf8");
    const forbidden = findForbiddenImports(content, metaContractPath);
    assert.strictEqual(
      forbidden.length,
      0,
      `meta-ads-contract.ts must have zero forbidden imports, found: ${JSON.stringify(forbidden)}`
    );

    // Also assert it has zero imports altogether (it is a pure contract)
    const allImports = extractAstImports(content, metaContractPath);
    assert.strictEqual(
      allImports.length,
      0,
      `meta-ads-contract.ts should be a pure contract module with no dependencies, found: ${JSON.stringify(allImports)}`
    );
  });

  it("2. meta-ads client page imports solely from meta-ads-contract and not server modules", () => {
    const content = fs.readFileSync(metaPagePath, "utf8");
    const forbidden = findForbiddenImports(content, metaPagePath);
    assert.strictEqual(
      forbidden.length,
      0,
      `meta-ads/page.tsx must not contain forbidden server imports, found: ${JSON.stringify(forbidden)}`
    );

    const allImports = extractAstImports(content, metaPagePath);
    const contractImport = allImports.find(imp =>
      imp.specifier === "@/lib/meta-ads-contract" || imp.specifier.endsWith("meta-ads-contract")
    );
    assert.ok(contractImport, "meta-ads page must import contract definitions from @/lib/meta-ads-contract");
  });

  it("3. No client-side component ('use client') imports server connector modules or telemetry directly", () => {
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
    const violations: { file: string; forbidden: ModuleImport[] }[] = [];

    for (const file of clientFiles) {
      const content = fs.readFileSync(file, "utf8");
      if (content.includes('"use client"') || content.includes("'use client'")) {
        const forbidden = findForbiddenImports(content, file);
        if (forbidden.length > 0) {
          violations.push({
            file: path.relative(repoRoot, file),
            forbidden,
          });
        }
      }
    }

    assert.strictEqual(
      violations.length,
      0,
      `Discovered forbidden server imports in client components:\n${JSON.stringify(violations, null, 2)}`
    );
  });

  describe("4. Negative Fixture Tests: AST verification catches intentional violations", () => {
    it("flags forbidden static value import of server connector", () => {
      const fixture = `
        "use client";
        import { runWithConnectorContext } from "@/lib/observability/connector-telemetry";
        export default function Component() { return null; }
      `;
      const forbidden = findForbiddenImports(fixture, "bad-client.tsx");
      assert.strictEqual(forbidden.length, 1);
      assert.strictEqual(forbidden[0].specifier, "@/lib/observability/connector-telemetry");
      assert.strictEqual(forbidden[0].isTypeOnly, false);
      assert.strictEqual(forbidden[0].kind, "import");
    });

    it("flags forbidden static value import of node:async_hooks and node:crypto", () => {
      const fixture = `
        import { AsyncLocalStorage } from "node:async_hooks";
        import crypto from "node:crypto";
      `;
      const forbidden = findForbiddenImports(fixture, "node-leak.ts");
      assert.strictEqual(forbidden.length, 2);
      assert.strictEqual(forbidden[0].specifier, "node:async_hooks");
      assert.strictEqual(forbidden[1].specifier, "node:crypto");
    });

    it("flags dynamic import of server module", () => {
      const fixture = `
        async function load() {
          const mod = await import("@/lib/meta-ads");
          return mod;
        }
      `;
      const forbidden = findForbiddenImports(fixture, "dynamic-leak.ts");
      assert.strictEqual(forbidden.length, 1);
      assert.strictEqual(forbidden[0].specifier, "@/lib/meta-ads");
      assert.strictEqual(forbidden[0].kind, "dynamic_import");
    });

    it("flags re-export of server module", () => {
      const fixture = `
        export * from "@/lib/google-ads";
      `;
      const forbidden = findForbiddenImports(fixture, "reexport-leak.ts");
      assert.strictEqual(forbidden.length, 1);
      assert.strictEqual(forbidden[0].specifier, "@/lib/google-ads");
      assert.strictEqual(forbidden[0].kind, "export");
    });

    it("allows type-only import of server or contract types without flagging violation", () => {
      const fixture = `
        import type { MetaInsightsRow } from "@/lib/meta-ads-contract";
        export type LocalType = MetaInsightsRow;
      `;
      const forbidden = findForbiddenImports(fixture, "safe-types.ts");
      assert.strictEqual(forbidden.length, 0, "Type-only imports must not trigger forbidden violations");

      const all = extractAstImports(fixture, "safe-types.ts");
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0].isTypeOnly, true);
    });
  });
});
