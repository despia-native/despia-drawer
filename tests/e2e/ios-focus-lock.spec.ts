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

test('second drawer stacks above the first drawer', async ({ page }) => {
  await page.goto('/examples/vanilla/');

  await page.locator('[data-open="large"]').first().click();
  await page.locator('[data-open-secondary]').click();

  await expect(page.locator('#drawer')).toHaveClass(/stacked-behind/);
  await expect(page.locator('#secondaryDrawer')).not.toHaveClass(/stacked-behind/);
});
