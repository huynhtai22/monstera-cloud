import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import path from "node:path";
import { resolveLatestMigrationVersion } from "./release-schema";

const originalEnv = process.env.RELEASE_SCHEMA_VERSION;

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.RELEASE_SCHEMA_VERSION;
  } else {
    process.env.RELEASE_SCHEMA_VERSION = originalEnv;
  }
});

describe("release schema version discovery", () => {
  it("dynamically resolves the newest migration from prisma/migrations", () => {
    delete process.env.RELEASE_SCHEMA_VERSION;
    const version = resolveLatestMigrationVersion();
    assert.match(version, /^\d{14}_/);
    assert.ok(version.length > 15);
  });

  it("honors RELEASE_SCHEMA_VERSION environment override", () => {
    process.env.RELEASE_SCHEMA_VERSION = "20261231235959_future_migration";
    const version = resolveLatestMigrationVersion();
    assert.equal(version, "20261231235959_future_migration");
  });

  it("falls back gracefully when directory does not exist and env is unset", () => {
    delete process.env.RELEASE_SCHEMA_VERSION;
    const version = resolveLatestMigrationVersion(path.join(process.cwd(), "non_existent_dir"));
    assert.equal(version, "unknown");
  });
});
