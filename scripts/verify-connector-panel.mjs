import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.CONSOLE_VERIFY_URL ?? 'http://localhost:3015';
const browser = await chromium.launch();
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    const forbidden = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.includes('/auth/connect') || path.includes('import-batch')) forbidden.push(path);
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto(`${base}/demo/ui/connect-source`);
    for (const theme of ['dark', 'light']) {
      if (theme === 'light') await page.getByRole('button', { name: 'Light mode', exact: true }).click();
      for (const provider of ['Meta Ads', 'Google Ads', 'Shopee', 'Shopify']) {
        await page.getByRole('button', { name: `Preview ${provider}`, exact: true }).click();
        const dialog = page.getByRole('dialog');
        await dialog.waitFor();
        console.log(width, theme, provider);
        await page.waitForTimeout(350);
        assert.match(await dialog.innerText(), /Access for reporting/);
        assert.match(await dialog.innerText(), /reporting dates/);
        assert.equal(await dialog.evaluate(el => getComputedStyle(el).colorScheme), theme);
        const box = await dialog.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width && box.height <= 810);
        const permissions = dialog.getByRole('region', { name: 'Access for reporting' });
        assert.ok(await permissions.isVisible());
        if (provider === 'Meta Ads') await dialog.screenshot({ path: `/tmp/connector-${theme}-${width}.png` });
        if (provider !== 'Shopify') {
          await dialog.getByRole('button', { name: `Continue to ${provider}`, exact: true }).click();
          await page.getByRole('heading', { name: `Opening ${provider}`, exact: true }).waitFor();
          assert.equal(await dialog.getByRole('button', { name: `Continue to ${provider}`, exact: true }).count(), 0);
          assert.equal(await dialog.getByText('Connected', { exact: true }).count(), 0);
        }
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        await page.waitForTimeout(320);
        assert.equal(await page.getByRole('button', { name: `Preview ${provider}`, exact: true }).evaluate(el => el === document.activeElement), true);
      }
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Preview Meta Ads', exact: true }).click();
    const motion = await page.getByRole('dialog').evaluate(el => Array.from(el.querySelectorAll('*')).filter(child => getComputedStyle(child).animationName !== 'none').length);
    assert.equal(motion, 0);
    assert.deepEqual(forbidden, []);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Connector panel: desktop/mobile, dark/light, 4 providers, handoff, Escape/focus restoration, reduced motion and preview isolation passed.');
} finally { await browser.close(); }
