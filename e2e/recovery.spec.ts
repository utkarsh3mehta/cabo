import { expect, test } from '@playwright/test';
import { completeInspection, mySlots, startSolo } from './helpers';

test('refreshing during an active turn restores the seat and the held card without restarting the game', async ({ page }) => {
  await startSolo(page, 'Rae', 2, 'full');
  await completeInspection(page);
  await expect(page.getByTestId('draw')).toBeVisible({ timeout: 20_000 });
  const roundLabel = await page.getByTestId('round-label').textContent();
  await page.getByTestId('draw').click();
  const held = page.getByTestId('held-card').locator('.card-face');
  await expect(held).toBeVisible();
  const value = await held.getAttribute('data-value');
  const drawPile = await page.getByTestId('draw-pile').getAttribute('aria-label');

  await page.reload();

  await expect(page.getByTestId('game-table')).toBeVisible();
  await expect(page.getByTestId('held-card').locator('.card-face')).toHaveAttribute('data-value', value!);
  expect(await page.getByTestId('round-label').textContent()).toBe(roundLabel);
  expect(await page.getByTestId('draw-pile').getAttribute('aria-label')).toBe(drawPile);
  // The draw was not repeated and the turn continues where it left off.
  await page.getByTestId('discard').click();
  // Bots move right after, so check the move log rather than the (quickly covered) discard pile.
  await expect(page.getByTestId('activity')).toContainText(`You discarded a ${value}.`);
});

test('refreshing during initial inspection keeps the two inspected cards; finishing hides them for good', async ({ page }) => {
  await startSolo(page, 'Lee', 1, 'quick');
  await mySlots(page).nth(1).click();
  await mySlots(page).nth(2).click();
  await page.getByTestId('confirm-inspect').click();
  await expect(page.locator('.my-area .card-face')).toHaveCount(2);
  const values = await page.locator('.my-area .card-face').evaluateAll((els) => els.map((e) => e.getAttribute('data-value')));

  await page.reload();
  await expect(page.locator('.my-area .card-face')).toHaveCount(2);
  expect(await page.locator('.my-area .card-face').evaluateAll((els) => els.map((e) => e.getAttribute('data-value')))).toEqual(values);

  await page.getByTestId('finish-inspect').click();
  await expect(page.locator('.my-area .card-face')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('game-table')).toBeVisible();
  await expect(page.locator('.my-area .card-face')).toHaveCount(0);
  // Nothing about the cards is kept in browser storage.
  const stored = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  expect(Object.keys(stored).sort()).toEqual(['cabo.name', 'cabo.sessions.v1']);
  const sessions = JSON.parse(stored['cabo.sessions.v1']!) as Record<string, object>;
  for (const s of Object.values(sessions)) expect(Object.keys(s).sort()).toEqual(['playerId', 'roomCode', 'savedAt', 'token']);
});

test('an unknown room link shows a clear message', async ({ page }) => {
  await page.goto('/r/ZZZZZZ');
  await expect(page.getByTestId('join-form').getByRole('alert')).toContainText('does not exist');
  await page.goto('/r/not-a-code');
  await expect(page.getByTestId('session-ended')).toContainText('valid room code');
});
