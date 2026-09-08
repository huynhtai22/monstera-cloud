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

export const NODE_BUILTINS = new Set([
  "async_hooks", "child_process", "cluster", "crypto", "dgram", "dns",
  "fs", "fs/promises", "http", "http2", "https", "net", "os", "path",
  "perf_hooks", "process", "punycode", "querystring", "readline", "repl",
  "stream", "stream/promises", "string_decoder", "timers", "timers/promises",
  "tls", "trace_events", "tty", "url", "util", "v8", "vm", "wasi",
  "worker_threads", "zlib"
]);

export const FORBIDDEN_SERVER_MODULE_PREFIXES = [
  "server-only",
  "@prisma/client",
  "@/lib/prisma",
  "@/lib/observability/connector-telemetry",
  "@/lib/observability/connector-evidence-summary",
  "@/lib/sync-connection",
  "@/lib/connection-data-through",
  "@/lib/connection-sync-lease",
  "@/lib/meta-sync-lock",
  "@/lib/warehouse-import-job",
  "@/lib/encryption",
  "@/lib/oauth-framework/token-refresh",
  "@/lib/google-ads",
  "@/lib/tiktok-business",
  "@/lib/shopee",
  "@/lib/lazada",
  "@/lib/ingestion/ad-platform-warehouse",
];

export function isForbiddenSpecifier(specifier: string): boolean {
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

    // 3. Dynamic import or require: import('...') or require('...')
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
 * Validates that a source string does not contain direct forbidden server imports.
 */
export function findForbiddenImports(sourceText: string, fileName = "test.ts"): ModuleImport[] {
  const imports = extractAstImports(sourceText, fileName);
  return imports.filter(imp => !imp.isTypeOnly && isForbiddenSpecifier(imp.specifier));
}

/**
 * Resolves local module specifiers relative to current file or src/ alias.
 */
export function resolveModuleSpecifier(specifier: string, fromFile: string, repoRoot: string): string | null {
  let basePath: string;
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    basePath = path.resolve(path.dirname(fromFile), specifier);
  } else if (specifier.startsWith("@/")) {
    basePath = path.resolve(repoRoot, "src", specifier.slice(2));
  } else {
    return null; // External package or builtin
  }

  // Exact file match
  if (fs.existsSync(basePath) && fs.statSync(basePath).isFile()) {
    return basePath;
  }

  const extensions = [".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs", ".cjs", ".json"];
  for (const ext of extensions) {
    const candidate = `${basePath}${ext}`;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  if (fs.existsSync(basePath) && fs.statSync(basePath).isDirectory()) {
    for (const ext of extensions) {
      const candidate = path.join(basePath, `index${ext}`);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }
  }

  return null;
}

export interface BoundaryViolation {
  entryFile: string;
  chain: string[];
  forbiddenSpecifier: string;
}

function hasUseClientDirective(sourceText: string, fileName: string): boolean {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return sourceFile.statements.some((statement) =>
    ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression) && statement.expression.text === "use client"
  );
}

/** Finds actual client entry modules across src while excluding non-source trees. */
export function discoverClientRoots(sourceRoot: string): string[] {
  const roots: string[] = [];
  const excludedDirectories = new Set(["node_modules", "fixtures", "generated", ".next"]);
  function scan(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) scan(fullPath);
      } else if (
        entry.isFile() &&
        /\.tsx?$/.test(entry.name) &&
        !/\.(?:test|spec)\.tsx?$/.test(entry.name) &&
        !entry.name.endsWith(".d.ts") &&
        hasUseClientDirective(fs.readFileSync(fullPath, "utf8"), fullPath)
      ) {
        roots.push(fullPath);
      }
    }
  }
  scan(sourceRoot);
  return roots;
}

/**
 * Performs a transitive local dependency-graph traversal starting from an entry module.
 * Recursively resolves imports, exports, dynamic imports, and require calls.
 * Uses a visited Set to prevent infinite recursion on cyclic dependency graphs.
 */
export function traverseTransitiveClientBoundary(
  entryFile: string,
  repoRoot: string,
  customResolver?: (specifier: string, fromFile: string) => string | null,
  customFileReader?: (filePath: string) => string,
): BoundaryViolation[] {
  const visited = new Set<string>();
  const violations: BoundaryViolation[] = [];

  function walk(currentFile: string, stack: string[]) {
    if (visited.has(currentFile)) return;
    visited.add(currentFile);

    let content = "";
    try {
      content = customFileReader ? customFileReader(currentFile) : fs.readFileSync(currentFile, "utf8");
    } catch {
      return;
    }

    const imports = extractAstImports(content, currentFile);
    for (const imp of imports) {
      if (imp.isTypeOnly) continue;

      if (isForbiddenSpecifier(imp.specifier)) {
        violations.push({
          entryFile,
          chain: [...stack, imp.specifier],
          forbiddenSpecifier: imp.specifier,
        });
        continue;
      }

      const resolved = customResolver
        ? customResolver(imp.specifier, currentFile)
        : resolveModuleSpecifier(imp.specifier, currentFile, repoRoot);

      if (resolved) {
        if (resolved.includes("node_modules")) continue;
        walk(resolved, [...stack, resolved]);
      }
    }
  }

  walk(entryFile, [entryFile]);
  return violations;
}

describe("Client/Server Dependency Boundary Enforcement (AST-Verified Transitive)", () => {
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
      `meta-ads/page.tsx must not contain direct forbidden server imports, found: ${JSON.stringify(forbidden)}`
    );

    const allImports = extractAstImports(content, metaPagePath);
    const contractImport = allImports.find(imp =>
      imp.specifier === "@/lib/meta-ads-contract" || imp.specifier.endsWith("meta-ads-contract")
    );
    assert.ok(contractImport, "meta-ads page must import contract definitions from @/lib/meta-ads-contract");
  });

  it("3. Transitive traversal of Meta Ads client page has zero forbidden dependencies across its full graph", () => {
    const violations = traverseTransitiveClientBoundary(metaPagePath, repoRoot);
    assert.strictEqual(
      violations.length,
      0,
      `Transitive boundary violation in meta-ads/page.tsx:\n${violations.map(v => v.chain.join(" -> ")).join("\n")}`
    );
  });

  it("4. Transitive traversal of all discovered 'use client' roots in src has zero forbidden dependencies", () => {
    const clientRoots = discoverClientRoots(path.join(repoRoot, "src"));
    const allViolations: BoundaryViolation[] = [];

    for (const file of clientRoots) {
      allViolations.push(...traverseTransitiveClientBoundary(file, repoRoot));
    }

    assert.strictEqual(
      allViolations.length,
      0,
      `Transitive client boundary violations detected in src:\n${allViolations.map(v => `${path.relative(repoRoot, v.entryFile)}: ${v.chain.map(p => path.relative(repoRoot, p)).join(" -> ")}`).join("\n")}`
    );
  });

  it("4b. Discovery includes client roots in components and hooks, including the resolved-workspace hook", () => {
    const roots = discoverClientRoots(path.join(repoRoot, "src")).map((file) => path.relative(repoRoot, file));
    assert.ok(roots.some((file) => file.startsWith("src/components/")), "Expected a src/components client root");
    assert.ok(roots.some((file) => file.startsWith("src/hooks/")), "Expected a src/hooks client root");
    assert.ok(roots.includes("src/hooks/use-resolved-workspace-id.ts"), "Expected use-resolved-workspace-id.ts to be checked");
  });

  describe("5. Required Transitive Graph Fixture Tests", () => {
    it("Fixture A: Direct forbidden import is detected with exact path", () => {
      const virtualFiles: Record<string, string> = {
        "/app/bad-client.tsx": `
          "use client";
          import { runWithConnectorContext } from "@/lib/observability/connector-telemetry";
          export default function Bad() { return null; }
        `,
      };

      const violations = traverseTransitiveClientBoundary(
        "/app/bad-client.tsx",
        repoRoot,
        (spec) => virtualFiles[spec] ? spec : null,
        (p) => virtualFiles[p] || ""
      );

      assert.strictEqual(violations.length, 1);
      assert.strictEqual(violations[0].forbiddenSpecifier, "@/lib/observability/connector-telemetry");
      assert.deepStrictEqual(violations[0].chain, [
        "/app/bad-client.tsx",
        "@/lib/observability/connector-telemetry",
      ]);
    });

    it("Fixture B: Forbidden dependency through intermediate module is detected", () => {
      const virtualFiles: Record<string, string> = {
        "/app/client.tsx": `
          "use client";
          import { helper } from "./intermediate";
          export default function Page() { return helper(); }
        `,
        "/app/intermediate.ts": `
          import { syncConnection } from "@/lib/sync-connection";
          export function helper() { return syncConnection; }
        `,
      };

      const violations = traverseTransitiveClientBoundary(
        "/app/client.tsx",
        repoRoot,
        (spec) => {
          if (spec === "./intermediate") return "/app/intermediate.ts";
          return null;
        },
        (p) => virtualFiles[p] || ""
      );

      assert.strictEqual(violations.length, 1);
      assert.strictEqual(violations[0].forbiddenSpecifier, "@/lib/sync-connection");
      assert.deepStrictEqual(violations[0].chain, [
        "/app/client.tsx",
        "/app/intermediate.ts",
        "@/lib/sync-connection",
      ]);
    });

    it("Fixture C: Alias traversal (@/...) is resolved transitively and flagged on violation", () => {
      const virtualFiles: Record<string, string> = {
        "/src/app/page.tsx": `
          "use client";
          import { widget } from "@/components/my-widget";
        `,
        "/src/components/my-widget.ts": `
          import { encrypt } from "@/lib/encryption";
          export const widget = encrypt;
        `,
      };

      const violations = traverseTransitiveClientBoundary(
        "/src/app/page.tsx",
        "/",
        (spec) => {
          if (spec === "@/components/my-widget") return "/src/components/my-widget.ts";
          return null;
        },
        (p) => virtualFiles[p] || ""
      );

      assert.strictEqual(violations.length, 1);
      assert.strictEqual(violations[0].forbiddenSpecifier, "@/lib/encryption");
      assert.deepStrictEqual(violations[0].chain, [
        "/src/app/page.tsx",
        "/src/components/my-widget.ts",
        "@/lib/encryption",
      ]);
    });

    it("Fixture D: Barrel / re-export traversal is resolved transitively", () => {
      const virtualFiles: Record<string, string> = {
        "/app/client.tsx": `
          "use client";
          export * from "./barrel";
        `,
        "/app/barrel.ts": `
          export * from "./leaf";
        `,
        "/app/leaf.ts": `
          import "server-only";
          export const val = 42;
        `,
      };

      const violations = traverseTransitiveClientBoundary(
        "/app/client.tsx",
        repoRoot,
        (spec) => {
          if (spec === "./barrel") return "/app/barrel.ts";
          if (spec === "./leaf") return "/app/leaf.ts";
          return null;
        },
        (p) => virtualFiles[p] || ""
      );

      assert.strictEqual(violations.length, 1);
      assert.strictEqual(violations[0].forbiddenSpecifier, "server-only");
      assert.deepStrictEqual(violations[0].chain, [
        "/app/client.tsx",
        "/app/barrel.ts",
        "/app/leaf.ts",
        "server-only",
      ]);
    });

    it("Fixture E: Literal dynamic import is detected in transitive graph", () => {
      const virtualFiles: Record<string, string> = {
        "/app/client.tsx": `
          "use client";
          import { lazyLoad } from "./loader";
        `,
        "/app/loader.ts": `
          export async function lazyLoad() {
            return await import("@/lib/google-ads");
          }
        `,
      };

      const violations = traverseTransitiveClientBoundary(
        "/app/client.tsx",
        repoRoot,
        (spec) => spec === "./loader" ? "/app/loader.ts" : null,
        (p) => virtualFiles[p] || ""
      );

      assert.strictEqual(violations.length, 1);
      assert.strictEqual(violations[0].forbiddenSpecifier, "@/lib/google-ads");
      assert.deepStrictEqual(violations[0].chain, [
        "/app/client.tsx",
        "/app/loader.ts",
        "@/lib/google-ads",
      ]);
    });

    it("Fixture F: Cyclic dependency graph terminates cleanly and detects nested violation", () => {
      // Safe cycle: A -> B -> A with no violations
      const safeCycle: Record<string, string> = {
        "/app/A.ts": `import { b } from "./B"; export const a = 1;`,
        "/app/B.ts": `import { a } from "./A"; export const b = 2;`,
      };
      const safeViolations = traverseTransitiveClientBoundary(
        "/app/A.ts",
        repoRoot,
        (spec) => spec === "./B" ? "/app/B.ts" : spec === "./A" ? "/app/A.ts" : null,
        (p) => safeCycle[p] || ""
      );
      assert.strictEqual(safeViolations.length, 0, "Safe cycle must terminate with 0 violations");

      // Poisoned cycle: A -> B -> A, but B also imports node:crypto
      const poisonedCycle: Record<string, string> = {
        "/app/A.ts": `import { b } from "./B"; export const a = 1;`,
        "/app/B.ts": `import { a } from "./A"; import crypto from "node:crypto"; export const b = 2;`,
      };
      const poisonedViolations = traverseTransitiveClientBoundary(
        "/app/A.ts",
        repoRoot,
        (spec) => spec === "./B" ? "/app/B.ts" : spec === "./A" ? "/app/A.ts" : null,
        (p) => poisonedCycle[p] || ""
      );
      assert.strictEqual(poisonedViolations.length, 1);
      assert.strictEqual(poisonedViolations[0].forbiddenSpecifier, "node:crypto");
      assert.deepStrictEqual(poisonedViolations[0].chain, [
        "/app/A.ts",
        "/app/B.ts",
        "node:crypto",
      ]);
    });

    it("Fixture G: Valid client-safe dependency graph passes with zero violations", () => {
      const validGraph: Record<string, string> = {
        "/app/client.tsx": `
          "use client";
          import { formatText } from "./formatter";
          import { UIWidget } from "./widget";
          export default function App() { return UIWidget(formatText("hello")); }
        `,
        "/app/formatter.ts": `
          export function formatText(s: string) { return s.trim(); }
        `,
        "/app/widget.ts": `
          import type { ServerType } from "@/lib/meta-ads-contract";
          export function UIWidget(text: string) { return { text }; }
        `,
      };

      const violations = traverseTransitiveClientBoundary(
        "/app/client.tsx",
        repoRoot,
        (spec) => {
          if (spec === "./formatter") return "/app/formatter.ts";
          if (spec === "./widget") return "/app/widget.ts";
          return null;
        },
        (p) => validGraph[p] || ""
      );

      assert.strictEqual(violations.length, 0, "Valid graph must pass with 0 violations");
    });

    it("Fixture H: Indirect token-refresh dependency is detected with its complete path", () => {
      const virtualFiles: Record<string, string> = {
        "/app/client.tsx": `"use client"; import { helper } from "./helper"; export const Client = helper;`,
        "/app/helper.ts": `import { getValidOAuthToken } from "@/lib/oauth-framework/token-refresh"; export const helper = getValidOAuthToken;`,
      };
      const violations = traverseTransitiveClientBoundary(
        "/app/client.tsx", repoRoot,
        (specifier) => specifier === "./helper" ? "/app/helper.ts" : null,
        (file) => virtualFiles[file] || ""
      );
      assert.strictEqual(violations.length, 1);
      assert.strictEqual(violations[0].forbiddenSpecifier, "@/lib/oauth-framework/token-refresh");
      assert.deepStrictEqual(violations[0].chain, [
        "/app/client.tsx", "/app/helper.ts", "@/lib/oauth-framework/token-refresh",
      ]);
    });
  });
});
