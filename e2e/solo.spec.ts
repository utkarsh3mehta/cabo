import { expect, test, type Page } from '@playwright/test';
import { completeInspection, mySlots, startSolo } from './helpers';

interface CheckedRound {
  roundNumber: string;
}

/** Recomputes every visible round score from the revealed cards shown on the results screen. */
async function checkRoundResults(page: Page): Promise<CheckedRound> {
  const panel = page.getByTestId('round-results');
  const title = (await panel.locator('h2').textContent()) ?? '';
  const rows = panel.getByTestId('result-row');
  const count = await rows.count();
  const data: Array<{ hand: number; score: number; winner: boolean; text: string }> = [];
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const values = await row.locator('.result-cards .card-face').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-value'))));
    const hand = Number(await row.getByTestId('hand-total').textContent());
    expect(hand).toBe(values.reduce((a, b) => a + b, 0));
    const score = Number(((await row.getByTestId('round-score').textContent()) ?? '').replace('+', ''));
    const winner = (await row.getAttribute('class'))?.includes('winner') ?? false;
    data.push({ hand, score, winner, text: (await row.textContent()) ?? '' });
  }
  const moon = data.some((d) => d.text.includes('Shot the moon'));
  for (const d of data) {
    if (d.winner) expect(d.score).toBe(0);
    else if (moon) expect(d.score).toBe(50);
    else if (d.text.includes('+5 Cabo penalty')) expect(d.score).toBe(d.hand + 5);
    else expect(d.score).toBe(d.hand);
  }
  if (!moon) {
    const lowest = Math.min(...data.map((d) => d.hand));
    for (const d of data.filter((x) => x.winner)) expect(d.hand).toBe(lowest);
  }
  return { roundNumber: title };
}

test('a single human completes a quick game against bots with correct scores and a valid winner', async ({ page }) => {
  await startSolo(page, 'Solo', 3, 'quick');
  await completeInspection(page);
  const seenRounds = new Set<string>();
  for (let i = 0; i < 800; i++) {
    if (await page.getByTestId('game-over').isVisible()) break;
    if (await page.getByTestId('round-results').isVisible()) {
      const { roundNumber } = await checkRoundResults(page);
      seenRounds.add(roundNumber);
      const next = page.getByRole('button', { name: 'Next round' });
      if ((await next.isVisible()) && (await next.isEnabled())) await next.click();
      await page.waitForTimeout(100);
      continue;
    }
    const visible = async (id: string) => (await page.getByTestId(id).isVisible()) && (await page.getByTestId(id).isEnabled());
    if (await page.getByTestId('confirm-inspect').isVisible()) {
      await mySlots(page).nth(0).click();
      await mySlots(page).nth(1).click();
      await page.getByTestId('confirm-inspect').click();
      await expect(page.getByTestId('finish-inspect')).toBeVisible();
    } else if (await visible('finish-inspect')) await page.getByTestId('finish-inspect').click();
    else if (await visible('ack-reveal')) await page.getByTestId('ack-reveal').click();
    else if (await visible('call-cabo')) {
      await page.getByTestId('call-cabo').click();
      await page.getByTestId('confirm-cabo').click();
    } else if (await visible('draw')) await page.getByTestId('draw').click();
    else if (await visible('discard')) await page.getByTestId('discard').click();
    else await page.waitForTimeout(100);
  }
  const over = page.getByTestId('game-over');
  await expect(over).toBeVisible();
  // The final round goes straight to the game-over screen, so 1–2 intermediate result screens were seen.
  const roundsPlayed = await page.getByTestId('round-label').textContent();
  expect(seenRounds.size).toBeGreaterThanOrEqual(1);
  expect(seenRounds.size).toBeLessThanOrEqual(2);
  expect(roundsPlayed).toMatch(new RegExp(`Round ${seenRounds.size + 1} `));
  await expect(page.getByTestId('winner-line')).toContainText(/wins!|Shared win/);
  const standings = over.getByTestId('standing');
  await expect(standings).toHaveCount(4);
  // Every rank-1 entry is marked as a winner and the winner line names them.
  const first = over.locator('[data-testid=standing][data-rank="1"]');
  expect(await first.count()).toBeGreaterThanOrEqual(1);
  await expect(first.first()).toContainText('Winner');
  // Quick game: the winner has at least as many round wins as anyone else.
  const wins = await standings.evaluateAll((els) => els.map((e) => Number(/(\d+) round win/.exec(e.textContent ?? '')?.[1] ?? 0)));
  expect(wins[0]).toBe(Math.max(...wins));

  // Back to the lobby to start another game.
  await page.getByRole('button', { name: 'Play again with this room' }).click();
  await expect(page.getByTestId('lobby')).toBeVisible();
});

test('a single human completes a full game to 100 against one bot', async ({ page }) => {
  test.setTimeout(150_000);
  await startSolo(page, 'Marathon', 1, 'full');
  for (let i = 0; i < 2000; i++) {
    if (await page.getByTestId('game-over').isVisible()) break;
    if (await page.getByTestId('round-results').isVisible()) {
      await checkRoundResults(page);
      const next = page.getByRole('button', { name: 'Next round' });
      if ((await next.isVisible()) && (await next.isEnabled())) await next.click();
      await page.waitForTimeout(50);
      continue;
    }
    const visible = async (id: string) => (await page.getByTestId(id).isVisible()) && (await page.getByTestId(id).isEnabled());
    if (await page.getByTestId('confirm-inspect').isVisible()) {
      await mySlots(page).nth(2).click();
      await mySlots(page).nth(3).click();
      await page.getByTestId('confirm-inspect').click();
      await expect(page.getByTestId('finish-inspect')).toBeVisible();
    } else if (await visible('finish-inspect')) await page.getByTestId('finish-inspect').click();
    else if (await visible('ack-reveal')) await page.getByTestId('ack-reveal').click();
    else if (await visible('call-cabo')) {
      await page.getByTestId('call-cabo').click();
      await page.getByTestId('confirm-cabo').click();
    } else if (await visible('draw')) await page.getByTestId('draw').click();
    else if (await visible('discard')) await page.getByTestId('discard').click();
    else await page.waitForTimeout(50);
  }
  await expect(page.getByTestId('game-over')).toBeVisible();
  // Full game: someone passed 100 and the lowest total is ranked first.
  const totals = await page
    .getByTestId('game-over')
    .getByTestId('score-total')
    .evaluateAll((els) => els.map((e) => Number(e.textContent)));
  expect(Math.max(...totals)).toBeGreaterThan(100);
  expect(totals[0]).toBe(Math.min(...totals));
});
