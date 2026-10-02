import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { encode } from 'next-auth/jwt';

const base = process.env.CONSOLE_VERIFY_URL ?? 'http://127.0.0.1:3015';
const secret = process.env.NEXTAUTH_SECRET ?? 'e2e-nextauth-secret-at-least-32-characters';
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const token = await encode({ secret, token: { sub: 'parity-fixture', id: 'parity-fixture', email: 'parity@example.test' } });
    await context.addCookies([{ name: 'next-auth.session-token', value: token, url: base }]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('monstera_sources_view_mode_v2', 'detailed'));
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      let data = {};
      if (url.pathname === '/api/auth/session') data = { user: { id: 'parity-fixture', email: 'parity@example.test', name: 'Parity fixture' }, expires: '2099-01-01T00:00:00Z' };
      else if (url.pathname === '/api/workspaces') data = [{ id: 'parity-workspace', name: 'Studio North', plan: 'professional', role: 'OWNER', status: 'ACTIVE', connections: [] }];
      else if (url.pathname.endsWith('/connections')) data = [{ id: 'parity-meta', provider: 'meta_ads', name: 'Meta Ads', status: 'connected', healthState: 'healthy', lastSync: '2026-10-01T12:00:00Z', credentials: { businessId: 'synthetic-bm', adAccounts: [{ id: 'synthetic-account', name: 'Sample account' }] } }];
      else if (url.pathname === '/api/clients' || url.pathname === '/api/pipelines') data = [];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto(`${base}/sources`, { waitUntil: 'networkidle' });
    assert.ok(!page.url().includes('/demo/') && !page.url().includes('/login'), 'must exercise authenticated production route');
    await page.getByRole('button', { name: 'Overview', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Detailed', exact: true }).count(), 0);
    const green = await page.getByRole('button', { name: 'Overview', exact: true }).evaluate(el => ({ color: getComputedStyle(el).backgroundColor, token: getComputedStyle(el).getPropertyValue('--console-brand-green').trim() }));
    assert.equal(green.color, 'rgb(134, 201, 155)');
    assert.equal(green.token, '#86c99b');
    await page.screenshot({ path: `/tmp/console-production-overview-${width}.png`, fullPage: true });
    if (width < 1024) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    await page.getByRole('button', { name: 'Collapse Sources subsection', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Expand Reports subsection', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Collapse Sources subsection', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Collapse Reports subsection', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Collapse Sources subsection', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Collapse Reports subsection', exact: true }).count(), 1);
    await page.reload({ waitUntil: 'networkidle' });
    if (width < 1024) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    await page.getByRole('button', { name: 'Expand Sources subsection', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Expand Sources subsection', exact: true }).click();
    await page.getByRole('navigation', { name: 'Sources directory', exact: true }).getByRole('link', { name: 'Integration library', exact: true }).click();
    await page.waitForURL('**/sources?tab=available');
    assert.equal(await page.getByRole('tab', { name: /Integration library|Available|Catalog/ }).getAttribute('aria-selected'), 'true');
    await page.getByRole('button', { name: 'Page guide', exact: true }).click();
    await page.locator('#console-page-guide').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal overflow');
    assert.deepEqual(errors, []);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `/tmp/console-production-parity-${width}.png`, fullPage: true });
    await context.close();
    console.log(`PASS production /sources at ${width}px: independent persisted subsections, real tab navigation, brand token, no Detailed view, guide, no page errors`);
  }
} finally { await browser.close(); }
