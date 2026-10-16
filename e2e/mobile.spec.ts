import { expect, test } from '@playwright/test';
import { completeInspection, horizontalOverflow, mySlots, setName, startSolo } from './helpers';

test.describe('narrow mobile viewport', () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

  test('every screen fits without horizontal scrolling and the table stays playable with five players', async ({ page }) => {
    await page.goto('/');
    expect(await horizontalOverflow(page)).toBe(0);
    await page.goto('/rules');
    expect(await horizontalOverflow(page)).toBe(0);

    await setName(page, 'Mo');
    await page.getByTestId('create-room').click();
    await expect(page.getByTestId('lobby')).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);

    await startSolo(page, 'Mo', 4, 'quick');
    await expect(page.locator('.opponents .seat')).toHaveCount(4);
    expect(await horizontalOverflow(page)).toBe(0);

    // Own cards are comfortably tappable.
    for (let i = 0; i < 4; i++) {
      const box = await mySlots(page).nth(i).boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    // Opponent layouts are identifiable by name.
    for (const name of ['Pip', 'Juno', 'Basil', 'Mabel']) await expect(page.locator('.opponents')).toContainText(name);

    await completeInspection(page);
    await expect(page.getByTestId('draw')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('draw').tap();
    await expect(page.getByTestId('held-card')).toBeVisible();
    // Select a card by tapping, then replace it.
    await mySlots(page).nth(0).tap();
    await expect(mySlots(page).nth(0)).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('replace').tap();
    await expect(page.getByTestId('activity')).toContainText('You replaced your top left card');
    expect(await horizontalOverflow(page)).toBe(0);
    // The action panel and status line are readable text, not only colour.
    await expect(page.getByTestId('status-line')).not.toBeEmpty();
  });
});
