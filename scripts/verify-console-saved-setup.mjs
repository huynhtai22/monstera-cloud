import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const base = process.argv[2] || 'http://localhost:3014';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Use a local preview.');
const output = 'test-results/console-saved-setup';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const errors = [], apiRequests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
const setup = page.getByRole('region', { name: 'Keep my connected data healthy' });
const consent = setup.getByRole('checkbox', { name: /^I approve daily checks/ });
try {
  await page.goto(base + '/demo/ui/console-structure/console');
  await expect(page.getByText('Production console preview', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Preview state' }).selectOption('Monitoring draft');
  await expect(setup.getByText(/Saved draft · monitoring has not started/)).toBeVisible();
  await expect(setup.getByRole('checkbox', { name: /Sample provider account/ })).toBeChecked();
  await expect(consent).not.toBeChecked();
  await expect(setup.getByRole('button', { name: 'Approve and start daily checks' })).toBeDisabled();
  await page.reload();
  await page.getByRole('combobox', { name: 'Preview state' }).selectOption('Monitoring draft');
  await expect(setup.getByRole('checkbox', { name: /Sample provider account/ })).toBeChecked();
  await expect(consent).not.toBeChecked();
  await consent.check();
  await setup.getByRole('button', { name: 'Refresh account choices' }).click();
  await expect(consent).not.toBeChecked();
  console.log('PASS restored draft retains account choices and requires fresh approval');

  await page.getByRole('combobox', { name: 'Preview state' }).selectOption('Monitoring setup');
  await setup.getByRole('button', { name: 'Choose accounts', exact: true }).first().click();
  await setup.getByRole('checkbox', { name: /Sample provider account/ }).check();
  // Synthetic endpoint responses only: real persistence/isolation is exercised by the PostgreSQL suite.
  await page.evaluate(() => {
    window.__setupRequests = [];
    const previous = window.fetch;
    window.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith('/api/agent-console/responsibilities') && init?.method) {
        const body = JSON.parse(init.body);
        window.__setupRequests.push({ url, method: init.method, body });
        if (url.endsWith('/confirm')) return Response.json({ message: 'Synthetic worker unavailable' }, { status: 503 });
        return Response.json({ responsibility: { id: 'synthetic-created-draft', version: 1, timezone: 'UTC' }, scopes: body.scopeItems });
      }
      return previous(input, init);
    };
  });
  await setup.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(setup.getByText('Draft saved. No checks or retries have started.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__setupRequests.map(r => r.method))).toEqual(['POST']);
  await expect(consent).not.toBeChecked();
  console.log('PASS save draft does not call approval');
  await consent.check();
  await setup.getByRole('button', { name: 'Approve and start daily checks' }).click();
  await expect(setup.getByRole('alert')).toContainText('Synthetic worker unavailable');
  await setup.getByRole('button', { name: 'Approve and start daily checks' }).click();
  await expect(setup.getByRole('alert')).toContainText('Synthetic worker unavailable');
  const requests = await page.evaluate(() => window.__setupRequests);
  expect(requests.filter(r => r.method === 'POST' && !r.url.endsWith('/confirm'))).toHaveLength(1);
  expect(requests.filter(r => r.url.endsWith('/synthetic-created-draft/confirm'))).toHaveLength(2);
  console.log('PASS failed approval retries the same saved draft');

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: output + '/saved-draft-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await page.getByRole('combobox', { name: 'Preview state' }).selectOption('Monitoring draft');
  await setup.scrollIntoViewIfNeeded();
  await page.screenshot({ path: output + '/saved-draft.png' });
  expect(errors).toEqual([]);
  expect(apiRequests).toEqual([]);
  console.log('PASS mobile layout, reload, no rendering errors and no live API requests');
} finally { await browser.close(); }
