import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import ts from "typescript";
import { createSentryBuildPluginManager } from "@sentry/bundler-plugin-core";

const REPO_ROOT = path.resolve(__dirname, "../../..");

describe("Sentry build configuration & telemetry governance", () => {
  it("next.config.mjs explicitly configures telemetry: false in withSentryConfig options", () => {
    const configPath = path.join(REPO_ROOT, "next.config.mjs");
    const content = fs.readFileSync(configPath, "utf8");
    const sourceFile = ts.createSourceFile(configPath, content, ts.ScriptTarget.Latest, true);

    let sentryCall: ts.CallExpression | null = null;
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        const text = node.expression.getText(sourceFile);
        if (text === "withSentryConfig") {
          sentryCall = node;
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);

    assert.ok(sentryCall, "Expected withSentryConfig call in next.config.mjs");
    assert.ok((sentryCall as ts.CallExpression).arguments.length >= 2, "Expected withSentryConfig to receive options argument");

    const optionsArg = (sentryCall as ts.CallExpression).arguments[1];
    assert.ok(ts.isObjectLiteralExpression(optionsArg), "Expected options argument to be an object literal");

    const properties = new Map<string, ts.Expression>();
    for (const prop of optionsArg.properties) {
      if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
        properties.set(prop.name.text, prop.initializer);
      }
    }

    // 1. Telemetry must be explicitly and unconditionally false
    const telemetryProp = properties.get("telemetry");
    assert.ok(telemetryProp, "Expected 'telemetry' property in withSentryConfig options");
    assert.equal(
      telemetryProp.kind,
      ts.SyntaxKind.FalseKeyword,
      "Expected 'telemetry' to be the boolean literal `false`, not conditional or variable-dependent"
    );

    // 2. Source map upload settings must be preserved
    const hideSourceMapsProp = properties.get("hideSourceMaps");
    assert.ok(hideSourceMapsProp, "Expected 'hideSourceMaps' property in withSentryConfig options");
    assert.equal(hideSourceMapsProp.kind, ts.SyntaxKind.TrueKeyword, "Expected 'hideSourceMaps: true'");

    const widenClientFileUploadProp = properties.get("widenClientFileUpload");
    assert.ok(widenClientFileUploadProp, "Expected 'widenClientFileUpload' property in withSentryConfig options");
    assert.equal(widenClientFileUploadProp.kind, ts.SyntaxKind.TrueKeyword, "Expected 'widenClientFileUpload: true'");

    assert.ok(properties.has("org"), "Expected 'org' property for credentialed source map upload");
    assert.ok(properties.has("project"), "Expected 'project' property for credentialed source map upload");
  });

  it("distinguishes genuinely disabled telemetry from merely suppressed logging", () => {
    // Contract A: telemetry: false deterministically disables build telemetry
    const managerDisabled = createSentryBuildPluginManager(
      { telemetry: false, silent: false },
      { loggerPrefix: "[test]", buildTool: "webpack" }
    );
    assert.equal(
      managerDisabled.normalizedOptions.telemetry,
      false,
      "normalizedOptions.telemetry must be false when telemetry: false is specified"
    );

    // Contract B: silent: true alone merely hides logging while leaving telemetry enabled
    const managerSilentOnly = createSentryBuildPluginManager(
      { silent: true },
      { loggerPrefix: "[test]", buildTool: "webpack" }
    );
    assert.equal(
      managerSilentOnly.normalizedOptions.telemetry,
      true,
      "silent: true alone does NOT disable telemetry; telemetry defaults to true"
    );

    // Contract C: default configuration without telemetry flag defaults to enabled
    const managerDefault = createSentryBuildPluginManager(
      {},
      { loggerPrefix: "[test]", buildTool: "webpack" }
    );
    assert.equal(
      managerDefault.normalizedOptions.telemetry,
      true,
      "unspecified telemetry defaults to true, demonstrating why explicit telemetry: false is mandatory"
    );
  });

  it("preserves production runtime Sentry monitoring and error capture", () => {
    // 1. Server runtime config
    const serverConfigPath = path.join(REPO_ROOT, "sentry.server.config.ts");
    const serverContent = fs.readFileSync(serverConfigPath, "utf8");
    assert.match(serverContent, /Sentry\.init\(/, "sentry.server.config.ts must call Sentry.init");
    assert.match(serverContent, /dsn:\s*process\.env\.SENTRY_DSN/, "Server DSN must bind process.env.SENTRY_DSN");
    assert.match(serverContent, /enabled:\s*process\.env\.NODE_ENV\s*!==\s*"development"/, "Server Sentry must remain enabled in production");

    // 2. Edge runtime config
    const edgeConfigPath = path.join(REPO_ROOT, "sentry.edge.config.ts");
    const edgeContent = fs.readFileSync(edgeConfigPath, "utf8");
    assert.match(edgeContent, /Sentry\.init\(/, "sentry.edge.config.ts must call Sentry.init");
    assert.match(edgeContent, /dsn:\s*process\.env\.SENTRY_DSN/, "Edge DSN must bind process.env.SENTRY_DSN");
    assert.match(edgeContent, /enabled:\s*process\.env\.NODE_ENV\s*!==\s*"development"/, "Edge Sentry must remain enabled in production");

    // 3. Client runtime config
    const clientConfigPath = path.join(REPO_ROOT, "src/instrumentation-client.ts");
    const clientContent = fs.readFileSync(clientConfigPath, "utf8");
    assert.match(clientContent, /Sentry\.init\(/, "src/instrumentation-client.ts must call Sentry.init");
    assert.match(clientContent, /dsn:\s*process\.env\.NEXT_PUBLIC_SENTRY_DSN/, "Client DSN must bind NEXT_PUBLIC_SENTRY_DSN");
    assert.match(clientContent, /enabled:\s*process\.env\.NODE_ENV\s*!==\s*"development"/, "Client Sentry must remain enabled in production");
    assert.match(clientContent, /export const onRouterTransitionStart\s*=\s*Sentry\.captureRouterTransitionStart/, "Client router transition hook must be exported");

    // 4. Instrumentation request error hook
    const instrumentationPath = path.join(REPO_ROOT, "src/instrumentation.ts");
    const instrumentationContent = fs.readFileSync(instrumentationPath, "utf8");
    assert.match(instrumentationContent, /export const onRequestError\s*=\s*Sentry\.captureRequestError/, "src/instrumentation.ts must export onRequestError hook");
  });
});
