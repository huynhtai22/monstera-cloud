import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

process.env.DATABASE_URL ||= "postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder";

const INVALID_TOKEN_BODY = {
  error: "invalid_token",
  message: "Google token is invalid or expired. Please reopen the add-on.",
};

async function postRaw(body: string): Promise<Response> {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost:3000/api/v1/sheets/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  }));
}

async function postJson(body: unknown): Promise<Response> {
  return postRaw(JSON.stringify(body));
}

async function assertInvalidToken(body: unknown): Promise<void> {
  const response = await postJson(body);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), INVALID_TOKEN_BODY);
}

describe("Sheets authentication request validation", () => {
  afterEach(() => mock.restoreAll());

  it("returns 401 for an absent Google token", async () => {
    await assertInvalidToken({});
  });

  it("returns 401 for an empty Google token", async () => {
    await assertInvalidToken({ googleToken: "" });
  });

  it("returns 401 for a whitespace-only Google token", async () => {
    await assertInvalidToken({ googleToken: " \t\n " });
  });

  it("returns 401 for a malformed or invalid supplied Google token", async () => {
    mock.method(globalThis, "fetch", async () => new Response("{}", { status: 400 }));
    await assertInvalidToken({ googleToken: "supplied-but-invalid" });
  });

  it("preserves 400 for an unrelated invalid request shape", async () => {
    const response = await postJson([]);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "invalid_request",
      message: "Request body must be a JSON object.",
    });
  });

  it("returns 400 for malformed JSON", async () => {
    const response = await postRaw("{");
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "invalid_request",
      message: "Request body must be valid JSON.",
    });
  });
});
