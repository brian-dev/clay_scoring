import { expect, test } from '@playwright/test';

test('public leaderboard shows standings, divisions and teams', async ({ page }) => {
  await page.goto('/board');
  await expect(page.locator('.lrow').first()).toBeVisible();
  // Minors are always "First L." on public views.
  await expect(page.getByText('Whitfield')).toHaveCount(0);
  await page.getByRole('button', { name: 'divisions' }).click();
  await expect(page.getByRole('button', { name: 'Junior Female' })).toBeVisible();
  await page.getByRole('button', { name: 'teams' }).click();
  await expect(page.getByText('Sponsor Team A')).toBeVisible();
});

test('squad card QR opens a personal scorecard', async ({ page }) => {
  await page.goto('/me/squad-4');
  await expect(page.locator('.ticket')).toBeVisible();
  await expect(page.locator('.strow')).toHaveCount(10);
});

test('clubhouse TV view renders all panels', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/tv');
  await expect(page.locator('.tvr')).toHaveCount(10);
  await expect(page.locator('.dc')).toHaveCount(6);
  await expect(page.locator('.tv-spons')).toContainText('Thank you to our sponsors');
});
