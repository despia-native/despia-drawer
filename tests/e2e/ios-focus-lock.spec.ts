import { expect, test } from '@playwright/test';

test('drawer input focus keeps host page scroll anchored', async ({ page }) => {
  await page.goto('/examples/vanilla/');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  const before = await page.evaluate(() => window.scrollY);

  await page.locator('[data-open="large"]').first().click();
  await page.locator('#drawer input[type="text"]').first().focus();
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => window.scrollY);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
});

test('first middle and last form inputs focus without moving the host page', async ({ page }) => {
  await page.goto('/examples/vanilla/');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  const before = await page.evaluate(() => window.scrollY);

  for (const target of ['first', 'middle', 'last']) {
    await page.locator(`[data-focus-field="${target}"]`).click();
    await page.waitForTimeout(250);
    const activeTag = await page.evaluate(() => document.activeElement?.tagName.toLowerCase());
    expect(['input', 'textarea']).toContain(activeTag);
    const after = await page.evaluate(() => window.scrollY);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
  }
});

test('second drawer stacks above the first drawer', async ({ page }) => {
  await page.goto('/examples/vanilla/');

  await page.locator('[data-open="large"]').first().click();
  await page.locator('[data-open-secondary]').click();

  await expect(page.locator('#drawer')).toHaveClass(/stacked-behind/);
  await expect(page.locator('#secondaryDrawer')).not.toHaveClass(/stacked-behind/);
});

test('stacked drawer keeps the lower drawer locked during touch', async ({ page }) => {
  await page.goto('/examples/vanilla/');

  await page.locator('[data-open="large"]').first().click();
  await page.locator('[data-open-secondary]').click();
  const before = await page.locator('#drawer').evaluate((drawer) => drawer.getAttribute('detent'));

  await page.touchscreen.tap(200, 500);
  await page.waitForTimeout(120);

  await expect(page.locator('#drawer')).toHaveClass(/stacked-behind/);
  await expect(page.locator('#secondaryDrawer')).not.toHaveClass(/stacked-behind/);
  const after = await page.locator('#drawer').evaluate((drawer) => drawer.getAttribute('detent'));
  expect(after).toBe(before);
});
