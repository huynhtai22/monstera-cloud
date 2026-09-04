// Tests must never inherit production credentials or silently skip PostgreSQL.
import { spawnSync } from 'node:child_process';
const url = new URL(process.argv[2] ?? 'postgresql://invalid');
if (!['localhost', '127.0.0.1'].includes(url.hostname)
    || !['/monstera_security_test', '/monstera_ci'].includes(url.pathname)) {
  throw new Error('Use an isolated localhost monstera_security_test or monstera_ci database only.');
}
const env = {
  PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
  CI: 'true', NODE_ENV: 'test', DATABASE_URL: url.href, DIRECT_URL: url.href,
  NEXTAUTH_SECRET: 'isolated-test-nextauth-secret-32-characters',
  NEXTAUTH_URL: 'http://localhost:3000',
  ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  CRON_SECRET: 'isolated-test-cron-secret-32-characters',
  GOOGLE_ID_TOKEN_AUDIENCES: 'ci-google-client-id.apps.googleusercontent.com',
  PILOT_MODE: '1', ENABLE_GOVERNED_ANALYST: 'true',
};
const files = process.argv.includes('--all') ? ['src/**/*.test.ts'] : [
  'src/lib/security-boundaries.pg.integration.test.ts',
  'src/lib/vietqr-gateway.test.ts',
  'src/lib/payment-workspace.test.ts',
  'src/lib/payos.test.ts',
  'src/app/api/webhooks/payos/route.test.ts',
  'src/app/api/webhooks/sepay/payment-fulfillment-security.test.ts',
  'src/lib/tenant-*.test.ts',
  'src/lib/ai/**/*.test.ts',
  'src/lib/provider-account-health*.test.ts',
  'src/lib/*reconciliation*.test.ts',
];
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], {
  env, stdio: 'inherit',
});
process.exit(result.status ?? 1);
