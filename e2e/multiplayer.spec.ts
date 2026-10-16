import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { io } from 'socket.io-client';
import { completeInspection, horizontalOverflow, newPlayer, setName } from './helpers';

async function findActive(pages: Page[]): Promise<Page> {
  for (let i = 0; i < 100; i++) {
    for (const p of pages) {
      if (((await p.getByTestId('status-line').textContent()) ?? '').startsWith('Your turn')) return p;
    }
    await pages[0]!.waitForTimeout(100);
  }
  throw new Error('no active player found');
}

test('guests create a room, join by code and by invitation link, start and play a synchronised move', async ({ browser }) => {
  // 1. A new guest creates a private room.
  const ada = await newPlayer(browser);
  await setName(ada, 'Ada');
  await ada.getByTestId('create-room').click();
  await expect(ada.getByTestId('lobby')).toBeVisible();
  const code = (await ada.getByTestId('room-code').textContent())!.trim();
  const invite = (await ada.getByTestId('invite-url').textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  expect(invite).toContain(`/r/${code}`);
  expect(await horizontalOverflow(ada)).toBe(0);

  // 2. Another guest joins with the room code (typed in lower case with a dash).
  const ben = await newPlayer(browser);
  await setName(ben, 'Ben');
  await ben.getByTestId('join-code').fill(`${code.slice(0, 3)}-${code.slice(3)}`.toLowerCase());
  await ben.getByTestId('join-room').click();
  await expect(ben.getByTestId('lobby')).toBeVisible();

  // 3. A third guest opens the invitation link directly.
  const cy = await newPlayer(browser);
  await cy.goto(invite);
  await expect(cy.getByTestId('join-form')).toBeVisible();
  await cy.getByTestId('join-name').fill('Cy');
  await cy.getByTestId('join-submit').click();
  await expect(cy.getByTestId('lobby')).toBeVisible();

  await expect(ada.getByTestId('seat')).toHaveCount(3);
  await expect(ben.getByTestId('start-game')).toHaveCount(0); // only the host can start

  // 4. The host starts a legal game.
  await ada.getByTestId('start-game').click();
  const pages = [ada, ben, cy];
  for (const p of pages) await expect(p.getByTestId('game-table')).toBeVisible();

  // 5. Initial inspection: values are visible only to their owner.
  await ada.locator('.my-area button.slot').nth(0).click();
  await ada.locator('.my-area button.slot').nth(1).click();
  await ada.getByTestId('confirm-inspect').click();
  await expect(ada.locator('.my-area .card-face')).toHaveCount(2);
  await expect(ben.locator('.seat .card-face')).toHaveCount(0);
  await expect(cy.locator('.seat .card-face')).toHaveCount(0);
  await ada.getByTestId('finish-inspect').click();
  await completeInspection(ben);
  await completeInspection(cy);

  // 6. The active player draws: only they see the card; then they discard it and every board updates.
  const active = await findActive(pages);
  const others = pages.filter((p) => p !== active);
  const drawCountBefore = await active.getByTestId('draw-pile').getAttribute('aria-label');
  await active.getByTestId('draw').click();
  const held = active.getByTestId('held-card').locator('.card-face');
  await expect(held).toBeVisible();
  const value = await held.getAttribute('data-value');
  for (const p of others) {
    await expect(p.getByTestId('held-card').locator('.card-back')).toBeVisible();
    await expect(p.getByTestId('held-card').locator('.card-face')).toHaveCount(0);
  }

  // 7. A modified client cannot act out of turn or claim another identity. React will not fire a
  //    disabled button, so this sends raw protocol messages with the seat's own stored credential.
  const intruder = others[0]!;
  const stored = await intruder.evaluate(() => localStorage.getItem('cabo.sessions.v1'));
  const token = (JSON.parse(stored!) as Record<string, { token: string }>)[code]!.token;
  const raw = io(new URL(intruder.url()).origin, {
    path: '/socket.io',
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    // Only relaxed for local HTTPS runs through Caddy's internal certificate authority.
    rejectUnauthorized: process.env.E2E_IGNORE_HTTPS_ERRORS !== '1',
  });
  await new Promise<void>((resolve, reject) => {
    raw.once('connect', () => resolve());
    raw.once('connect_error', reject);
  });
  const sendRaw = (command: unknown) =>
    new Promise<{ ok: boolean; error?: { code: string } }>((resolve) => raw.emit('room:command', { actionId: randomUUID(), command }, resolve));
  expect(await sendRaw({ type: 'game', action: { type: 'drawFromDeck' } })).toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });
  expect(await sendRaw({ type: 'game', action: { type: 'useSpy', target: { playerId: 'p_x', slot: 0 } } })).toMatchObject({ ok: false });
  expect(await sendRaw({ type: 'game', action: { type: 'discardDrawn' }, playerId: 'someone-else' })).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
  expect(await sendRaw({ type: 'startGame' })).toMatchObject({ ok: false });
  raw.disconnect();
  // The tampered connection replaced the intruder's tab; reloading takes the seat back.
  await expect(intruder.getByTestId('session-ended')).toContainText('Opened elsewhere');
  await intruder.reload();
  await expect(intruder.getByTestId('game-table')).toBeVisible();
  // The active player's drawn card is untouched.
  await expect(held).toHaveAttribute('data-value', value!);

  await active.getByTestId('discard').click();
  for (const p of pages) {
    await expect(p.getByTestId('discard-pile').locator('.card-face')).toHaveAttribute('data-value', value!);
    await expect(p.getByTestId('activity')).toContainText(`discarded a ${value}`);
  }
  expect(await active.getByTestId('draw-pile').getAttribute('aria-label')).not.toBe(drawCountBefore);
  // The turn passed to someone else, and nobody saw any other hidden card.
  await expect(active.getByTestId('status-line')).not.toHaveText(/^Your turn/);
  for (const p of pages) await expect(p.locator('.seat .card-face')).toHaveCount(0);
});

test('the host can hand a disconnected player’s seat to a bot after the grace period', async ({ browser }) => {
  const ada = await newPlayer(browser);
  await setName(ada, 'Ada');
  await ada.getByTestId('create-room').click();
  const invite = (await ada.getByTestId('invite-url').textContent())!.trim();
  const ben = await newPlayer(browser);
  await ben.goto(invite);
  await ben.getByTestId('join-name').fill('Ben');
  await ben.getByTestId('join-submit').click();
  await expect(ada.getByTestId('seat')).toHaveCount(2);
  await ada.getByTestId('start-game').click();
  await expect(ben.getByTestId('game-table')).toBeVisible();

  // Ben's browser goes away (tab closed / network lost).
  const benContext = ben.context();
  await ben.close();
  await expect(ada.getByText('Ben is disconnected.')).toBeVisible();
  const replace = ada.getByRole('button', { name: 'Replace with bot' });
  await expect(replace).toBeVisible({ timeout: 15_000 });
  await replace.click();
  await expect(ada.getByText('Bot (replaced)')).toBeVisible();

  // Ben comes back with the same browser storage and is told the seat is gone.
  const benAgain = await benContext.newPage();
  await benAgain.goto(invite);
  await expect(benAgain.getByTestId('session-ended')).toContainText('handed to a bot');

  // Ada can still finish the round with the bot in Ben's seat.
  await completeInspection(ada);
  await expect(ada.getByTestId('draw')).toBeVisible({ timeout: 15_000 });
});
