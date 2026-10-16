import { SOCKET_PATH, type SessionResponse } from '@cabo/shared';
import { io } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  connectClient,
  createRoom,
  driveToFinish,
  expectOk,
  joinRoom,
  startTestServer,
  type TestClient,
  type TestServer,
} from './harness.js';

let t: TestServer;
const clients: TestClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.socket?.disconnect();
  await t?.close();
});

async function client(session: SessionResponse) {
  const c = await connectClient(t.url, session);
  clients.push(c);
  return c;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function twoPlayerGame(allowBots = true) {
  const hostSession = await createRoom(t.url, { name: 'Host', allowBots });
  const host = await client(hostSession);
  const guestSession = await joinRoom(t.url, hostSession.roomCode, 'Guest');
  const guest = await client(guestSession);
  await host.waitFor((v) => v.participants.every((p) => p.connected) && v.participants.length === 2);
  expectOk(await host.send({ type: 'startGame' }));
  await guest.waitFor((v) => v.phase === 'playing');
  return { host, guest, hostSession, guestSession };
}

async function finishInspections(list: TestClient[]) {
  for (const c of list) {
    expectOk(await c.game({ type: 'inspect', slots: [0, 1] }));
    expectOk(await c.game({ type: 'finishInspection' }));
  }
  return list[0]!.waitFor((v) => v.game?.round.phase === 'turns');
}

function connectErrorFor(token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = io(t.url, { path: SOCKET_PATH, auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
    s.on('connect', () => {
      s.disconnect();
      reject(new Error('connected'));
    });
    s.on('connect_error', (e) => {
      s.disconnect();
      resolve(e.message);
    });
  });
}

describe('reconnection', () => {
  it('restores a seat mid-turn, including the privately held card, without repeating the draw', async () => {
    t = await startTestServer({ reconnectGraceMs: 5_000 });
    const { host, guest, guestSession } = await twoPlayerGame();
    const v = await finishInspections([host, guest]);
    const activeIsGuest = v.game!.round.activePlayer === guest.playerId;
    const [active, activeSession] = activeIsGuest ? [guest, guestSession] : [host, host.session];
    const watcher = activeIsGuest ? host : guest;
    expectOk(await active.game({ type: 'drawFromDeck' }));
    const held = active.latest().game!.round.step;
    expect(held).toMatchObject({ kind: 'holding', source: 'deck' });
    const drawPileBefore = active.latest().game!.round.drawPileCount;

    active.disconnect();
    await watcher.waitFor((x) => x.participants.some((p) => p.playerId === active.playerId && !p.connected));

    const back = await client(activeSession);
    const restored = back.latest();
    expect(restored.game!.round.step).toEqual(held);
    expect(restored.game!.round.drawPileCount).toBe(drawPileBefore);
    expect(restored.game!.legal.discardDrawn).toBe(true);
    await watcher.waitFor((x) => x.participants.every((p) => p.connected));
    expectOk(await back.game({ type: 'discardDrawn' }));
  });

  it('restores an unfinished initial inspection and an unacknowledged Peek after a refresh', async () => {
    t = await startTestServer({ reconnectGraceMs: 5_000 });
    const { host, guest, guestSession } = await twoPlayerGame();
    expectOk(await guest.game({ type: 'inspect', slots: [1, 2] }));
    const seen = guest.latest().game!.round.table.find((s) => s.playerId === guest.playerId)!.slots.map((s) => s.value);
    guest.disconnect();
    const back = await client(guestSession);
    const again = back.latest().game!.round.table.find((s) => s.playerId === guest.playerId)!.slots.map((s) => s.value);
    expect(again).toEqual(seen);
    expect(back.latest().game!.legal.finishInspection).toBe(true);
    expectOk(await back.game({ type: 'finishInspection' }));
    // After finishing, a refresh no longer shows the cards.
    back.disconnect();
    const later = await client(guestSession);
    expect(later.latest().game!.round.table.flatMap((s) => s.slots).every((s) => s.value === undefined)).toBe(true);
    expect(host.latest().phase).toBe('playing');
  });

  it('keeps the game going while the round completes and lets a returning player ready up', async () => {
    t = await startTestServer({ reconnectGraceMs: 5_000 });
    const { host, guest, guestSession } = await twoPlayerGame();
    const v = await finishInspections([host, guest]);
    const caller = v.game!.round.activePlayer === host.playerId ? host : guest;
    const other = caller === host ? guest : host;
    expectOk(await caller.game({ type: 'callCabo' }));
    expectOk(await other.game({ type: 'drawFromDeck' }));
    guest.disconnect();
    if (other === guest) {
      // The guest disconnected while holding a card in their final turn: reconnect and finish it.
      const back = await client(guestSession);
      expectOk(await back.game({ type: 'discardDrawn' }));
      const done = await back.waitFor((x) => x.game?.phase !== 'round');
      expect(done.game!.lastRoundResult).not.toBeNull();
    } else {
      expectOk(await host.game({ type: 'discardDrawn' }));
      const done = await host.waitFor((x) => x.game?.phase !== 'round');
      // A disconnected player never blocks the next round.
      if (done.game!.phase === 'roundComplete') {
        expect(done.nextRound?.waitingFor).toEqual([host.playerId]);
        const back = await client(guestSession);
        expect(back.latest().game!.lastRoundResult?.roundNumber).toBe(1);
      }
    }
  });

  it('a second connection with the same token replaces the first', async () => {
    t = await startTestServer();
    const session = await createRoom(t.url, { name: 'Ada' });
    const first = await client(session);
    const second = await client(session);
    await first.waitFor(() => first.ended.length > 0 || !first.socket.connected, 3000).catch(() => undefined);
    expect(first.ended).toContainEqual({ reason: 'replacedByNewConnection' });
    expect(second.latest().participants[0]!.connected).toBe(true);
  });
});

describe('host continuity', () => {
  it('keeps the host during the grace period, then transfers to a connected human', async () => {
    t = await startTestServer({ reconnectGraceMs: 400 });
    const hostSession = await createRoom(t.url, { name: 'Host' });
    const host = await client(hostSession);
    const guest = await client(await joinRoom(t.url, hostSession.roomCode, 'Guest'));
    host.disconnect();
    let v = await guest.waitFor((x) => x.participants[0]?.connected === false);
    expect(v.you.isHost).toBe(false);
    v = await guest.waitFor((x) => x.you.isHost, 3000, 'host transfer');
    expect(v.participants[1]!.isHost).toBe(true);
    // The original host returns as an ordinary player.
    const back = await client(hostSession);
    expect(back.latest().you.isHost).toBe(false);
  });

  it('a host who returns within the grace period is still host', async () => {
    t = await startTestServer({ reconnectGraceMs: 5_000 });
    const hostSession = await createRoom(t.url, { name: 'Host' });
    const host = await client(hostSession);
    const guest = await client(await joinRoom(t.url, hostSession.roomCode, 'Guest'));
    host.disconnect();
    await guest.waitFor((x) => x.participants[0]?.connected === false);
    const back = await client(hostSession);
    expect(back.latest().you.isHost).toBe(true);
    expectOk(await back.send({ type: 'addBot' }));
  });
});

describe('bot takeover', () => {
  it('lets the host hand a disconnected seat to a bot only after the grace period', async () => {
    t = await startTestServer({ reconnectGraceMs: 300 });
    const { host, guest, guestSession } = await twoPlayerGame();
    await finishInspections([host, guest]);
    guest.disconnect();
    await host.waitFor((x) => x.participants[1]?.connected === false);
    expect(await host.send({ type: 'replaceWithBot', playerId: guest.playerId })).toMatchObject({ ok: false, error: { code: 'NOT_REPLACEABLE' } });
    await host.waitFor((x) => x.participants[1]?.graceExpired === true, 3000, 'grace expiry');
    expectOk(await host.send({ type: 'replaceWithBot', playerId: guest.playerId }));
    const v = await host.waitFor((x) => x.participants[1]?.kind === 'bot');
    expect(v.participants[1]).toMatchObject({ takenOverByBot: true, connected: true, name: 'Guest' });
    // The original player cannot reclaim the seat and is told why.
    expect(await connectErrorFor(guestSession.token)).toBe('SEAT_TAKEN_OVER');
    // The bot plays the seat's turns; the game reaches its end.
    const final = await driveToFinish([host], 1, 40_000);
    expect(final.phase).toBe('finished');
  }, 60_000);

  it('cannot replace a connected player, a bot, or anyone when bots are off', async () => {
    t = await startTestServer({ reconnectGraceMs: 100 });
    const { host, guest } = await twoPlayerGame(false);
    expect(await host.send({ type: 'replaceWithBot', playerId: guest.playerId })).toMatchObject({ ok: false, error: { code: 'BOTS_NOT_ALLOWED' } });
    expect(await guest.send({ type: 'replaceWithBot', playerId: host.playerId })).toMatchObject({ ok: false, error: { code: 'NOT_HOST' } });
  });

  it('a player who leaves mid-game can be replaced at once', async () => {
    t = await startTestServer({ reconnectGraceMs: 60_000 });
    const { host, guest, guestSession } = await twoPlayerGame();
    expectOk(await guest.send({ type: 'leave' }));
    await host.waitFor((x) => x.participants[1]?.graceExpired === true);
    expectOk(await host.send({ type: 'replaceWithBot', playerId: guest.playerId }));
    expect(await connectErrorFor(guestSession.token)).toMatch(/INVALID_SESSION|SEAT_TAKEN_OVER/);
  });
});

describe('cleanup', () => {
  it('closes idle rooms and tells connected clients', async () => {
    t = await startTestServer({ roomIdleTtlMs: 150, sweepIntervalMs: 100, reconnectGraceMs: 50 });
    const session = await createRoom(t.url, { name: 'Ada' });
    const ada = await client(session);
    expect(t.server.manager.roomCount).toBe(1);
    ada.disconnect();
    for (let i = 0; i < 30 && t.server.manager.roomCount > 0; i++) await sleep(50);
    expect(t.server.manager.roomCount).toBe(0);
    expect(await connectErrorFor(session.token)).toBe('INVALID_SESSION');
  });

  it('closes finished rooms after their TTL', async () => {
    t = await startTestServer({ finishedRoomTtlMs: 200, sweepIntervalMs: 100 });
    const human = await client(await createRoom(t.url, { name: 'Solo', mode: 'quick', botCount: 1 }));
    expectOk(await human.send({ type: 'startGame' }));
    await driveToFinish([human], 1, 30_000);
    await human.waitFor(() => human.ended.length > 0, 3000, 'room closed').catch(() => undefined);
    expect(human.ended).toContainEqual({ reason: 'roomClosed' });
  }, 40_000);
});
