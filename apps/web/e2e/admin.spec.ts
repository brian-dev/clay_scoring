import { expect, test } from '@playwright/test';

const CSV = `First Name,Last Name,Age,Gender,Team,Squad,Order,Email
Marcus,Okafor,52,M,Brush Country,4,1,marcus@example.com
Avery,Pruitt,15,F,Brush Country,4,2,
Owen,Price,11,M,,4,,
Dale,Hale,38,M,,5,,`;

test.use({ viewport: { width: 1100, height: 900 }, isMobile: false, hasTouch: false });

test('organizer imports registrations, then prints squad cards with QR codes', async ({ page }) => {
  await page.goto('/admin');
  await page.getByRole('button', { name: /Slayin' Clays Demo/ }).click();
  await expect(page.getByText('Ready for the shoot?')).toBeVisible();

  await page.getByRole('link', { name: 'Registration' }).click();
  await page.getByLabel('Paste CSV').fill(CSV);
  await expect(page.getByText('4 shooters · 0 errors')).toBeVisible();
  // Preview shows the public board name: minors as "First L."
  await expect(page.getByRole('cell', { name: 'Avery P.' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Intermediate Female' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Junior Male' })).toBeVisible();
  await page.getByRole('button', { name: 'Import 4 shooters' }).click();
  await expect(page.getByRole('status')).toHaveText('Imported 4 shooters. Created 2 squads and 1 teams.');

  await page.getByRole('link', { name: 'Squads & printing' }).click();
  await expect(page.getByText('Squad 4', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Assign start stations/ }).click();
  await expect(page.getByRole('status')).toHaveText('Start stations assigned.');

  await page.getByRole('link', { name: /Print squad cards/ }).click();
  await expect(page.locator('.pcard')).toHaveCount(6); // 5 squads + practice
  await expect(page.locator('.pcard .qr svg')).toHaveCount(6);
  await expect(page.locator('.pcard').filter({ hasText: 'PRACTICE' })).toHaveCount(1);
  const squad4 = page.locator('.pcard').filter({ hasText: 'Marcus Okafor' });
  await expect(squad4).toContainText('Avery P.');
  await expect(squad4).toContainText('squad-4');
});

test('an import with problems is blocked until they are fixed', async ({ page }) => {
  await page.goto('/admin/demo-event/registration');
  await page.getByLabel('Paste CSV').fill('First,Division,Squad\n,Adult Male,1\nAl,Senior Male,two');
  await expect(page.getByText('Missing first name.')).toBeVisible();
  await expect(page.getByText('Division "Senior Male" doesn\'t match any division for this event.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Import/ })).toBeDisabled();
});

test('organizer adds a station and prints station signs', async ({ page }) => {
  await page.goto('/admin/demo-event/stations');
  const newRow = page.locator('tbody tr').last();
  await newRow.getByLabel('Station name').fill('Long crosser');
  await newRow.getByLabel('Targets').fill('12');
  await newRow.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('status')).toHaveText('Station 6 added.');
  await expect(page.getByText('6 stations · 52 targets per shooter')).toBeVisible();

  await page.goto('/admin/demo-event/print/stations');
  await expect(page.locator('.psign')).toHaveCount(6);
  await expect(page.locator('.psign').last()).toContainText('Long crosser');
  await expect(page.locator('.psign .qr svg')).toHaveCount(6);
});
