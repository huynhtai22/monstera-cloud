import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  classifyPageAccess,
  PUBLIC_PAGE_PATHS,
  PUBLIC_PAGE_PREFIXES,
} from "./page-access-policy";

const REPO_ROOT = process.cwd();

/** Recursively collect page.tsx files under src/app/(app), excluding agency mirrors. */
function collectAppPageFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "agencies") continue; // mirrored re-exports of canonical pages
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collectAppPageFiles(full, out);
    else if (entry === "page.tsx") out.push(full);
  }
  return out;
}

/** Map an app page file path to its concrete sample URL path. */
function appPageFileToUrl(file: string): string {
  const relative = path.relative(path.join(REPO_ROOT, "src", "app", "(app)"), file);
  const withoutPage = relative.replace(/(^|[/\\])page\.tsx$/, "");
  const segments = withoutPage.split(/[/\\]/).filter(Boolean);
  const concrete = segments.map((segment) =>
    segment.startsWith("[") && segment.endsWith("]") ? "sample-segment" : segment,
  );
  return "/" + concrete.join("/");
}

describe("page access policy (deny-by-default)", () => {
  it("classifies required public routes as public", () => {
    const requiredPublic = [
      "/",
      // Auth flows
      "/login",
      "/register",
      "/forgot-password",
      "/reset-password",
      "/verify",
      // Legal
      "/legal/privacy-policy",
      "/legal/refund-policy",
      "/legal/terms-of-service",
      // Marketing
      "/pricing",
      "/about",
      "/changelog",
      "/docs",
      "/platform",
      "/showcase",
      "/support",
      "/templates",
      "/looker-studio",
      "/id",
      "/integrations/meta-ads",
      "/solutions",
      "/solutions/agencies",
      "/solutions/smes",
      // Utility / transactional
      "/success",
      "/pixel-test",
      "/demo/ui",
      "/auth/continue",
      // Invitation acceptance (token-gated by the page itself)
      "/invite/tok_123",
    ];
    for (const pathname of requiredPublic) {
      assert.equal(classifyPageAccess(pathname), "public", `${pathname} must be public`);
    }
  });

  it("classifies authenticated application routes as authenticated", () => {
    const protectedRoutes = [
      "/console",
      "/sources",
      "/sources/setup",
      "/sources/src_123",
      "/settings/team",
      "/reports",
      "/explorer",
      "/synced-data",
      "/clients",
      "/exports",
      "/transformations",
      "/internal-templates",
      "/overview",
      "/quickstart",
      "/ops",
      "/admin",
      "/admin/signal",
      "/meta-ads",
      "/shopee",
      "/google-ads",
      "/tiktok-ads",
      "/pilot-admin",
      // Agency-host rewrites are classified on their stripped canonical path.
      "/console/anything/deep",
    ];
    for (const pathname of protectedRoutes) {
      assert.equal(
        classifyPageAccess(pathname),
        "authenticated",
        `${pathname} must require authentication`,
      );
    }
  });

  it("treats API paths and malformed inputs as out-of-scope defaults", () => {
    assert.equal(classifyPageAccess("/api/workspaces"), "authenticated");
    assert.equal(classifyPageAccess("console"), "authenticated");
    assert.equal(classifyPageAccess(""), "authenticated");
  });

  it("REGRESSION: every application page is deny-by-default unless explicitly allowlisted", () => {
    const appPagesDir = path.join(REPO_ROOT, "src", "app", "(app)");
    const files = collectAppPageFiles(appPagesDir);
    assert.ok(files.length >= 20, `expected the full app page inventory, found ${files.length}`);

    // The single intentional exception: invitation acceptance is token-gated
    // by the page itself and must be reachable without a session.
    const allowedPublicUrls = new Set<string>(["/invite/sample-segment"]);

    for (const file of files) {
      const url = appPageFileToUrl(file);
      const classification = classifyPageAccess(url);
      if (allowedPublicUrls.has(url)) {
        assert.equal(classification, "public", `${url} should stay public by design`);
      } else {
        assert.equal(
          classification,
          "authenticated",
          `NEW REGRESSION: ${url} (${file}) classifies as "${classification}". ` +
            "Application pages must be deny-by-default. If this page is genuinely " +
            "public, add it explicitly to src/lib/page-access-policy.ts with a review.",
        );
      }
    }
  });

  it("allowlist integrity: exact public paths resolve to real page files", () => {
    const expectedFiles: Record<string, string> = {
      "/": "src/app/page.tsx",
      "/login": "src/app/(auth)/login/page.tsx",
      "/register": "src/app/(auth)/register/page.tsx",
      "/forgot-password": "src/app/(auth)/forgot-password/page.tsx",
      "/reset-password": "src/app/(auth)/reset-password/page.tsx",
      "/verify": "src/app/(auth)/verify/page.tsx",
      "/legal/privacy-policy": "src/app/legal/privacy-policy/page.tsx",
      "/legal/refund-policy": "src/app/legal/refund-policy/page.tsx",
      "/legal/terms-of-service": "src/app/legal/terms-of-service/page.tsx",
      "/success": "src/app/success/page.tsx",
      "/pixel-test": "src/app/pixel-test/page.tsx",
    };
    for (const [pathname, file] of Object.entries(expectedFiles)) {
      assert.ok(
        PUBLIC_PAGE_PATHS.has(pathname),
        `${pathname} must remain in PUBLIC_PAGE_PATHS`,
      );
      assert.ok(existsSync(path.join(REPO_ROOT, file)), `${pathname} -> ${file} must exist`);
    }
  });

  it("allowlist integrity: public prefixes resolve to real page trees", () => {
    const representativeFiles: Record<string, string> = {
      "/about": "src/app/(marketing)/about/page.tsx",
      "/changelog": "src/app/(marketing)/changelog/page.tsx",
      "/docs": "src/app/(marketing)/docs/page.tsx",
      "/pricing": "src/app/(marketing)/pricing/page.tsx",
      "/platform": "src/app/(marketing)/platform/page.tsx",
      "/showcase": "src/app/(marketing)/showcase/page.tsx",
      "/support": "src/app/(marketing)/support/page.tsx",
      "/templates": "src/app/(marketing)/templates/page.tsx",
      "/looker-studio": "src/app/(marketing)/looker-studio/page.tsx",
      "/id": "src/app/(marketing)/id/page.tsx",
      "/integrations": "src/app/(marketing)/integrations/[slug]/page.tsx",
      "/solutions": "src/app/(marketing)/solutions/page.tsx",
      "/auth/continue": "src/app/auth/continue/page.tsx",
      "/demo/ui": "src/app/demo/ui/page.tsx",
      "/invite/": "src/app/(app)/invite/[token]/page.tsx",
    };
    for (const [prefix, file] of Object.entries(representativeFiles)) {
      assert.ok(
        PUBLIC_PAGE_PREFIXES.includes(prefix),
        `${prefix} must remain in PUBLIC_PAGE_PREFIXES`,
      );
      assert.ok(existsSync(path.join(REPO_ROOT, file)), `${prefix} -> ${file} must exist`);
    }
  });
});
