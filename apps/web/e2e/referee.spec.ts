import { expect, test, type Page } from '@playwright/test';

async function join(page: Page, pin: string, name: string) {
  await page.goto('/score');
  await page.getByLabel('Event code').fill('SLAYIN');
  await page.getByLabel('PIN').fill(pin);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Join' }).click();
}

async function typeCode(page: Page, code: string) {
  await page.getByLabel('Or type the code').fill(code);
  await page.getByRole('button', { name: 'Continue' }).click();
}

test('a disputed score is corrected and settled by a referee', async ({ page }) => {
  // Scorer: score squad 3 at station 2, then call a referee for Gus.
  await join(page, '1234', 'Pat');
  await typeCode(page, 'station-2');
  await typeCode(page, 'squad-3');
  const hit = page.getByRole('button', { name: 'HIT', exact: true });
  const miss = page.getByRole('button', { name: 'MISS', exact: true });
  for (let i = 0; i < 8; i++) await hit.click(); // Emma: 8
  for (let i = 0; i < 2; i++) await hit.click();
  await miss.click(); // Gus target 3 lost
  for (let i = 0; i < 5; i++) await hit.click(); // Gus: 7
  await page.getByRole('button', { name: 'Show totals to the squad' }).click();
  await page.getByRole('button', { name: 'Dispute a score' }).click();
  await page.getByLabel('Gus Holloway').check();
  await page.getByLabel(/What's the disagreement/).fill('Target 3 broke');
  await page.getByRole('button', { name: 'Call referee' }).click();
  await expect(page.getByText('Referee called for Gus Holloway. Squad 3 can move on.')).toBeVisible();
  await expect(page.locator('.sync')).toHaveText('All sent', { timeout: 10_000 });

  // The station is now locked for scorers.
  await page.getByRole('button', { name: 'Sign out' }).click();

  // Referee signs in with the referee PIN.
  await join(page, '5678', 'Ref Jo');
  await page.getByRole('link', { name: 'Open the referee dispute queue' }).click();
  await expect(page.locator('.live')).toHaveText('1 open');
  const card = page.locator('.dispute');
  await expect(card).toContainText('Gus Holloway');
  await expect(card).toContainText('Target 3 broke');
  await card.getByRole('button', { name: 'Review scores' }).click();
  await expect(card.getByText('Station total: 7 / 8')).toBeVisible();

  // Settling needs a reason.
  await card.getByRole('button', { name: 'Target 3: miss' }).click();
  await expect(card.getByText('Station total: 8 / 8')).toBeVisible();
  await card.getByRole('button', { name: 'Save 1 change and settle' }).click();
  await expect(card.getByRole('alert')).toContainText('Give a short reason');
  await card.getByLabel('Reason (required)').fill('Visible piece on target 3');
  await card.getByRole('button', { name: 'Save 1 change and settle' }).click();

  await expect(page.getByRole('status')).toHaveText('Score changed for Gus Holloway at station 2. Dispute settled.');
  await expect(page.getByText('No open disputes.')).toBeVisible();
});

test('scorers cannot open the referee queue', async ({ page }) => {
  await join(page, '1234', 'Pat');
  await expect(page.getByRole('link', { name: 'Open the referee dispute queue' })).toHaveCount(0);
  await page.goto('/referee');
  await expect(page.getByRole('heading', { name: 'Referees only' })).toBeVisible();
});
