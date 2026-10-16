import { expect, type Browser, type Page } from '@playwright/test';

export async function newPlayer(browser: Browser, viewport?: { width: number; height: number }): Promise<Page> {
  const context = await browser.newContext(viewport ? { viewport } : {});
  const page = await context.newPage();
  page.on('pageerror', (err) => {
    throw err;
  });
  return page;
}

export async function setName(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.getByTestId('name-input').fill(name);
}

export async function startSolo(page: Page, name: string, bots: number, mode: 'quick' | 'full'): Promise<void> {
  await setName(page, name);
  await page.getByTestId(`bots-${bots}`).click();
  await page.getByTestId(`solo-mode-${mode}`).click();
  await page.getByTestId('start-solo').click();
  await expect(page.getByTestId('game-table')).toBeVisible();
}

export function mySlots(page: Page) {
  return page.locator('.my-area button.slot');
}

/** Looks at the two given own cards, checks they are face up, then finishes. */
export async function completeInspection(page: Page, slots: [number, number] = [0, 3]): Promise<void> {
  await expect(page.getByTestId('confirm-inspect')).toBeVisible();
  await mySlots(page).nth(slots[0]).click();
  await mySlots(page).nth(slots[1]).click();
  await page.getByTestId('confirm-inspect').click();
  await expect(page.getByTestId('finish-inspect')).toBeVisible();
  for (const s of slots) await expect(mySlots(page).nth(s).locator('.card-face')).toBeVisible();
  await page.getByTestId('finish-inspect').click();
  await expect(mySlots(page).locator('.card-face')).toHaveCount(0);
}

async function clickable(page: Page, testId: string): Promise<boolean> {
  const el = page.getByTestId(testId);
  return (await el.isVisible()) && (await el.isEnabled());
}

/**
 * Plays a human seat through the UI until the game is over: looks at two
 * cards, draws and discards, and calls Cabo once it has had `caboAfter` turns
 * in the round.
 */
export async function playUntilGameOver(page: Page, caboAfter = 0, maxSteps = 600): Promise<void> {
  let turnsInRound = 0;
  let lastRound = '';
  for (let i = 0; i < maxSteps; i++) {
    if (await page.getByTestId('game-over').isVisible()) return;
    const roundLabel = (await page.getByTestId('round-label').textContent().catch(() => '')) ?? '';
    if (roundLabel !== lastRound) {
      lastRound = roundLabel;
      turnsInRound = 0;
    }
    if (await page.getByTestId('round-results').isVisible()) {
      const next = page.getByRole('button', { name: 'Next round' });
      if ((await next.isVisible()) && (await next.isEnabled())) await next.click();
      else await page.waitForTimeout(100);
      continue;
    }
    if (await page.getByTestId('confirm-inspect').isVisible()) {
      await mySlots(page).nth(1).click();
      await mySlots(page).nth(2).click();
      await page.getByTestId('confirm-inspect').click();
      await expect(page.getByTestId('finish-inspect')).toBeVisible();
      continue;
    }
    if (await clickable(page, 'finish-inspect')) {
      await page.getByTestId('finish-inspect').click();
      continue;
    }
    if (await clickable(page, 'ack-reveal')) {
      await page.getByTestId('ack-reveal').click();
      continue;
    }
    if (await clickable(page, 'draw')) {
      if (turnsInRound >= caboAfter && (await clickable(page, 'call-cabo'))) {
        await page.getByTestId('call-cabo').click();
        await page.getByTestId('confirm-cabo').click();
      } else {
        turnsInRound++;
        await page.getByTestId('draw').click();
      }
      continue;
    }
    if (await clickable(page, 'discard')) {
      await page.getByTestId('discard').click();
      continue;
    }
    if (await page.getByTestId('replace').isVisible()) {
      // Holding a card that cannot be discarded (taken from the discard pile): replace a card.
      await mySlots(page).first().click();
      await page.getByTestId('replace').click();
      continue;
    }
    await page.waitForTimeout(100);
  }
  throw new Error('game did not finish');
}

export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}
