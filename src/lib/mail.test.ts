import assert from "node:assert/strict";
import test from "node:test";
import { sendOtpEmail } from "./mail";

const originalEnv = { ...process.env };

test("sendOtpEmail: simulates delivery when E2E isolation conditions pass", async () => {
  process.env.MONSTERA_E2E_ISOLATED = "1";
  process.env.CLIENT_ASSIGNMENT_TEST_DB = "1";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/monstera_e2e";
  process.env.NEXTAUTH_URL = "http://127.0.0.1:3000";
  delete process.env.VERCEL_ENV;
  delete process.env.VERCEL;

  try {
    const result = await sendOtpEmail("alice@example.com", "123456");
    assert.equal(result.success, true);
    assert.deepEqual(result.data, { simulated: true });
  } finally {
    process.env = { ...originalEnv };
  }
});

test("sendOtpEmail: fails closed before provider initialization when isolation configuration is invalid", async () => {
  // MONSTERA_E2E_ISOLATED is set, but required CLIENT_ASSIGNMENT_TEST_DB is missing
  process.env.MONSTERA_E2E_ISOLATED = "1";
  delete process.env.CLIENT_ASSIGNMENT_TEST_DB;
  process.env.DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/monstera_e2e";
  process.env.NEXTAUTH_URL = "http://127.0.0.1:3000";

  try {
    await assert.rejects(
      async () => {
        await sendOtpEmail("alice@example.com", "123456");
      },
      /Mail simulation requires CLIENT_ASSIGNMENT_TEST_DB=1/
    );
  } finally {
    process.env = { ...originalEnv };
  }
});

test("sendOtpEmail: fails closed when database points to remote host", async () => {
  process.env.MONSTERA_E2E_ISOLATED = "1";
  process.env.CLIENT_ASSIGNMENT_TEST_DB = "1";
  process.env.DATABASE_URL = "postgresql://user:pass@ep-cool.neon.tech/monstera_e2e";
  process.env.NEXTAUTH_URL = "http://127.0.0.1:3000";

  try {
    await assert.rejects(
      async () => {
        await sendOtpEmail("alice@example.com", "123456");
      },
      /requires loopback database host/
    );
  } finally {
    process.env = { ...originalEnv };
  }
});

test("sendOtpEmail: preserves normal non-E2E behavior when MONSTERA_E2E_ISOLATED is absent", async () => {
  delete process.env.MONSTERA_E2E_ISOLATED;
  process.env.RESEND_API_KEY = "re_dummy_invalid_key";

  try {
    // With MONSTERA_E2E_ISOLATED absent, sendOtpEmail does not simulate delivery;
    // it invokes Resend (which fails due to the dummy key, returning { success: false, error }).
    const result = await sendOtpEmail("alice@example.com", "123456");
    assert.equal(result.success, false);
    assert.notEqual((result as any).data?.simulated, true);
  } finally {
    process.env = { ...originalEnv };
  }
});

test("sendOtpEmail: values such as '0' or 'false' never activate simulation and never suppress real email", async () => {
  process.env.RESEND_API_KEY = "re_dummy_invalid_key";

  for (const disabledValue of ["0", "false", "no", "off"]) {
    process.env.MONSTERA_E2E_ISOLATED = disabledValue;
    try {
      const result = await sendOtpEmail("alice@example.com", "123456");
      // Simulation is NOT activated, so simulated is never true
      assert.notEqual((result as any).data?.simulated, true);
      // Real Resend delivery was invoked and failed with dummy key
      assert.equal(result.success, false);
    } finally {
      process.env = { ...originalEnv };
    }
  }
});
