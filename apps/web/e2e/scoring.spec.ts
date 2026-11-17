import { expect, test, type Page } from '@playwright/test';

async function join(page: Page) {
  await page.goto('/score');
  await page.getByLabel('Event code').fill('slayin');
  await page.getByLabel('PIN').fill('1234');
  await page.getByLabel('Your name').fill('Pat');
  await page.getByRole('button', { name: 'Join' }).click();
}

async function typeCode(page: Page, code: string) {
  await page.getByLabel('Or type the code').fill(code);
  await page.getByRole('button', { name: 'Continue' }).click();
}

test('wrong PIN is refused with a clear message', async ({ page }) => {
  await page.goto('/score');
  await page.getByLabel('Event code').fill('SLAYIN');
  await page.getByLabel('PIN').fill('0000');
  await page.getByLabel('Your name').fill('Pat');
  await page.getByRole('button', { name: 'Join' }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid event code or PIN.');
});

test('a volunteer scores a squad at a station and the squad confirms', async ({ page }) => {
  await join(page);
  await expect(page.getByRole('heading', { name: 'Scan your station sign' })).toBeVisible();
  await typeCode(page, 'station-3');
  await expect(page.getByText('Scoring station 3 · Rabbit.')).toBeVisible();

  await typeCode(page, 'squad-3'); // Emma R. (minor) and Gus Holloway, 8 targets each
  await expect(page.locator('.shooter-name')).toHaveText('Emma R.');
  await expect(page.getByText('Report pair 1 · Target 1 of 2')).toBeVisible();

  const hit = page.getByRole('button', { name: 'HIT', exact: true });
  const miss = page.getByRole('button', { name: 'MISS', exact: true });
  // Emma: 7 of 8
  for (let i = 0; i < 7; i++) await hit.click();
  await miss.click();
  await expect(page.locator('.shooter-name')).toHaveText('Gus Holloway');

  // Gus: mis-tap a miss, undo, re-score as hit, then 6 more hits and 1 miss = 7 of 8
  await miss.click();
  await page.getByRole('button', { name: /Undo last tap/ }).click();
  await hit.click();
  for (let i = 0; i < 6; i++) await hit.click();
  await miss.click();

  await expect(page.getByText('All targets scored')).toBeVisible();
  await page.getByRole('button', { name: 'Show totals to the squad' }).click();
  const rows = page.locator('.totals .row');
  await expect(rows.nth(0)).toContainText('Emma R.');
  await expect(rows.nth(0)).toContainText('7');
  await expect(rows.nth(1)).toContainText('Gus Holloway');
  await expect(rows.nth(1)).toContainText('7');

  await page.getByRole('button', { name: 'Squad confirms' }).click();
  await expect(page.getByText('Squad 3 confirmed. Ready for the next squad.')).toBeVisible();
  await expect(page.locator('.sync')).toHaveText('All sent', { timeout: 10_000 });
});

test('scores tapped with no signal stay on the phone and send when it returns', async ({ page }) => {
  await join(page);
  await typeCode(page, 'station-1');
  await typeCode(page, 'squad-practice');
  await page.evaluate(() => ((window as unknown as { __demoOffline: boolean }).__demoOffline = true));
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'HIT', exact: true }).click();
  await expect(page.locator('.sync')).toContainText('to send');
  await page.evaluate(() => {
    (window as unknown as { __demoOffline: boolean }).__demoOffline = false;
    window.dispatchEvent(new Event('online'));
  });
  await expect(page.locator('.sync')).toHaveText('All sent', { timeout: 10_000 });
});

test('progress survives a page reload mid-station', async ({ page }) => {
  await join(page);
  await typeCode(page, 'station-2');
  await typeCode(page, 'squad-1');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'HIT', exact: true }).click();
  await page.reload();
  await typeCode(page, 'squad-1');
  await expect(page.getByText('Report pair 2 · Target 2 of 2')).toBeVisible();
  await expect(page.locator('.tally').first()).toHaveText('3');
});
