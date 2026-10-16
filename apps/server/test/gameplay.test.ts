import { randomUUID } from 'node:crypto';
import { scoreRound } from '@cabo/game-engine';
import type { RoomView, SessionResponse, VisibleEvent } from '@cabo/shared';
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

async function startHumans(n: number, mode: 'full' | 'quick' = 'full') {
  const host = await createRoom(t.url, { name: 'P1', mode, allowBots: false });
  const list = [await client(host)];
  for (let i = 2; i <= n; i++) list.push(await client(await joinRoom(t.url, host.roomCode, `P${i}`)));
  await list[0]!.waitFor((v) => v.participants.length === n && v.participants.every((p) => p.connected));
  expectOk(await list[0]!.send({ type: 'startGame' }));
  for (const c of list) await c.waitFor((v) => v.phase === 'playing');
  return list;
}

async function finishInspections(list: TestClient[]) {
  for (const c of list) {
    expectOk(await c.game({ type: 'inspect', slots: [0, 1] }));
    expectOk(await c.game({ type: 'finishInspection' }));
  }
  return list[0]!.waitFor((v) => v.game?.round.phase === 'turns');
}

/** Asserts that a snapshot reveals nothing the viewer is not entitled to. */
function assertSanitised(view: RoomView) {
  const g = view.game;
  expect(JSON.stringify(view)).not.toMatch(/"id"\s*:|"token"|drawPile"|"hands"/);
  if (!g || g.round.phase === 'complete') return;
  for (const seat of g.round.table) {
    for (const slot of seat.slots) {
      if (slot.value === undefined) continue;
      if (g.round.phase === 'initialInspection') {
        expect(seat.playerId).toBe(view.you.playerId);
      } else {
        const step = g.round.step;
        expect(step?.kind).toBe('viewing');
        expect(g.round.activePlayer).toBe(view.you.playerId);
        if (step?.kind === 'viewing') expect(step.target).toEqual({ playerId: seat.playerId, slot: slot.index });
      }
    }
  }
  const step = g.round.step;
  if (step?.kind === 'holding' && step.source === 'deck' && g.round.activePlayer !== view.you.playerId) {
    expect(step.value).toBeUndefined();
    expect(step.ability).toBeNull();
  }
}

function privateEventsOf(c: TestClient): VisibleEvent[] {
  return c.events.filter((e) => e.type === 'initialPeek' || e.type === 'drawnCard' || e.type === 'revealed');
}

describe('hidden information over the wire', () => {
  it('delivers initial inspection only to the inspecting player', async () => {
    t = await startTestServer();
    const [a, b] = await startHumans(2);
    expectOk(await a!.game({ type: 'inspect', slots: [2, 3] }));
    const peek = a!.events.find((e) => e.type === 'initialPeek');
    expect(peek?.type === 'initialPeek' && peek.cards.map((c) => c.slot)).toEqual([2, 3]);
    await b!.waitFor((v) => v.version >= a!.latest().version);
    expect(privateEventsOf(b!)).toEqual([]);
    const mine = a!.latest().game!.round.table.find((s) => s.playerId === a!.playerId)!;
    expect(mine.slots.filter((s) => s.value !== undefined).map((s) => s.index)).toEqual([2, 3]);
    for (const seat of b!.latest().game!.round.table) for (const s of seat.slots) expect(s.value).toBeUndefined();
    expect(await a!.game({ type: 'inspect', slots: [0, 1] })).toMatchObject({ ok: false, error: { code: 'ALREADY_DONE' } });
  });

  it('keeps every snapshot sanitised and private events private through a whole game', async () => {
    t = await startTestServer();
    const list = await startHumans(3, 'quick');
    await driveToFinish(list, 2);
    for (const c of list) {
      expect(c.snapshots.length).toBeGreaterThan(10);
      for (const s of c.snapshots) assertSanitised(s);
      // Private events received by a client always concern that client.
      for (const e of c.events) {
        if (e.type === 'revealed') expect(c.latest().participants.some((p) => p.playerId === e.target.playerId)).toBe(true);
      }
    }
    const peeksSeen = list.map((c) => c.events.filter((e) => e.type === 'initialPeek').length);
    const rounds = list[0]!.latest().game!.history.length;
    expect(peeksSeen).toEqual(list.map(() => rounds));
  });

  it('shows a drawn card only to the drawer and Spy results only to the spy', async () => {
    t = await startTestServer();
    const list = await startHumans(2);
    const v = await finishInspections(list);
    const active = list.find((c) => c.playerId === v.game!.round.activePlayer)!;
    const other = list.find((c) => c !== active)!;
    expectOk(await active.game({ type: 'drawFromDeck' }));
    const drawn = active.events.findLast((e) => e.type === 'drawnCard');
    expect(drawn).toBeDefined();
    await other.waitFor((x) => x.version >= active.latest().version);
    expect(other.events.some((e) => e.type === 'drawnCard')).toBe(false);
    assertSanitised(other.latest());
    expect(other.latest().game!.round.step).toEqual({ kind: 'holding', source: 'deck', ability: null });
  });
});

describe('choice-card results over the wire', () => {
  /** Moves a card of `value` to the top of the real draw pile (white-box test setup; accounting preserved). */
  function stageTopCard(code: string, value: number) {
    const room = t.server.manager.getRoom(code)!;
    const pile = room.game!.round.drawPile;
    const i = pile.findIndex((c) => c.value === value);
    expect(i).toBeGreaterThanOrEqual(0);
    const [card] = pile.splice(i, 1);
    pile.push(card!);
  }

  it('delivers a Spy result only to the spy, and hides it again after acknowledgement', async () => {
    t = await startTestServer();
    const list = await startHumans(3);
    const v = await finishInspections(list);
    const spy = list.find((c) => c.playerId === v.game!.round.activePlayer)!;
    const target = list.find((c) => c !== spy)!;
    const bystander = list.find((c) => c !== spy && c !== target)!;
    const spyCard = t.server.manager.getRoom(spy.session.roomCode)!.game!.round.drawPile.find((c) => c.value === 9 || c.value === 10)!.value;
    stageTopCard(spy.session.roomCode, spyCard);
    expectOk(await spy.game({ type: 'drawFromDeck' }));
    expect(spy.latest().game!.legal.ability).toBe('spy');
    expectOk(await spy.game({ type: 'useSpy', target: { playerId: target.playerId, slot: 2 } }));
    const actual = t.server.manager.getRoom(spy.session.roomCode)!.game!.round.hands[target.playerId]![2]!.value;

    const revealed = spy.events.filter((e) => e.type === 'revealed');
    expect(revealed).toEqual([{ type: 'revealed', ability: 'spy', target: { playerId: target.playerId, slot: 2 }, value: actual }]);
    const spySeat = spy.latest().game!.round.table.find((s) => s.playerId === target.playerId)!;
    expect(spySeat.slots[2]!.value).toBe(actual);
    for (const other of [target, bystander]) {
      await other.waitFor((x) => x.version >= spy.latest().version);
      expect(other.events.some((e) => e.type === 'revealed')).toBe(false);
      expect(other.events).toContainEqual({ type: 'inspected', player: spy.playerId, ability: 'spy', target: { playerId: target.playerId, slot: 2 } });
      assertSanitised(other.latest());
      for (const seat of other.latest().game!.round.table) for (const s of seat.slots) expect(s.value).toBeUndefined();
    }
    expectOk(await spy.game({ type: 'acknowledgeReveal' }));
    for (const seat of spy.latest().game!.round.table) for (const s of seat.slots) expect(s.value).toBeUndefined();
  });

  it('delivers a Peek result only to the owner and keeps a Swap blind for everyone', async () => {
    t = await startTestServer();
    const list = await startHumans(2);
    let v = await finishInspections(list);
    const a = list.find((c) => c.playerId === v.game!.round.activePlayer)!;
    const b = list.find((c) => c !== a)!;
    stageTopCard(a.session.roomCode, 7);
    expectOk(await a.game({ type: 'drawFromDeck' }));
    expectOk(await a.game({ type: 'usePeek', slot: 1 }));
    expect(a.events.filter((e) => e.type === 'revealed')).toHaveLength(1);
    await b.waitFor((x) => x.version >= a.latest().version);
    expect(b.events.some((e) => e.type === 'revealed')).toBe(false);
    expectOk(await a.game({ type: 'acknowledgeReveal' }));

    v = await b.waitFor((x) => x.game?.round.activePlayer === b.playerId);
    stageTopCard(b.session.roomCode, 11);
    expectOk(await b.game({ type: 'drawFromDeck' }));
    const before = a.events.length;
    expectOk(await b.game({ type: 'useSwap', ownSlot: 0, target: { playerId: a.playerId, slot: 3 } }));
    await a.waitFor((x) => x.version >= b.latest().version);
    const swapEvents = [...a.events.slice(before), ...b.events].filter((e) => e.type === 'swapped');
    expect(swapEvents.length).toBeGreaterThan(0);
    for (const e of swapEvents) expect(JSON.stringify(e)).not.toMatch(/"value"/);
    for (const c of [a, b]) for (const seat of c.latest().game!.round.table) for (const s of seat.slots) expect(s.value).toBeUndefined();
  });
});

describe('authorisation and robustness', () => {
  it('rejects moves from the wrong player and out-of-phase moves', async () => {
    t = await startTestServer();
    const list = await startHumans(3);
    expect(await list[0]!.game({ type: 'drawFromDeck' })).toMatchObject({ ok: false, error: { code: 'WRONG_PHASE' } });
    const v = await finishInspections(list);
    const active = v.game!.round.activePlayer!;
    for (const c of list.filter((x) => x.playerId !== active)) {
      expect(await c.game({ type: 'drawFromDeck' })).toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });
      expect(await c.game({ type: 'callCabo' })).toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });
    }
    expect(await list[0]!.send({ type: 'readyNextRound' })).toMatchObject({ ok: false, error: { code: 'WRONG_PHASE' } });
  });

  it('executes a duplicated command only once', async () => {
    t = await startTestServer();
    const list = await startHumans(2);
    const v = await finishInspections(list);
    const active = list.find((c) => c.playerId === v.game!.round.activePlayer)!;
    const envelope = { actionId: randomUUID(), command: { type: 'game', action: { type: 'drawFromDeck' } } };
    const [first, second] = await Promise.all([active.raw(envelope), active.raw(envelope)]);
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: true, duplicate: true });
    const third = await active.raw(envelope);
    expect(third).toMatchObject({ ok: true, duplicate: true });
    const room = t.server.manager.getRoom(active.session.roomCode)!;
    expect(room.game!.round.step.kind).toBe('holding');
    expect(room.game!.round.drawPile.length).toBe(v.game!.round.drawPileCount - 1);
  });

  it('serialises concurrent moves: only one of two simultaneous draws succeeds', async () => {
    t = await startTestServer();
    const list = await startHumans(3);
    const v = await finishInspections(list);
    const active = list.find((c) => c.playerId === v.game!.round.activePlayer)!;
    const others = list.filter((c) => c !== active);
    const acks = await Promise.all([
      active.send({ type: 'game', action: { type: 'drawFromDeck' } }),
      active.send({ type: 'game', action: { type: 'takeDiscard' } }),
      ...others.map((c) => c.send({ type: 'game', action: { type: 'drawFromDeck' } })),
    ]);
    expect(acks.filter((a) => a.ok)).toHaveLength(1);
    expect(acks.slice(2).every((a) => !a.ok && a.error.code === 'NOT_YOUR_TURN')).toBe(true);
  });

  it('rejects stale moves when an expected version is supplied', async () => {
    t = await startTestServer();
    const list = await startHumans(2);
    const v = await finishInspections(list);
    const active = list.find((c) => c.playerId === v.game!.round.activePlayer)!;
    const stale = active.latest().version - 1;
    expect(await active.game({ type: 'drawFromDeck' }, stale)).toMatchObject({ ok: false, error: { code: 'STALE_VERSION' } });
    expectOk(await active.game({ type: 'drawFromDeck' }, active.latest().version));
  });

  it('cannot request hidden information: there is no command for it and invalid targets fail safely', async () => {
    t = await startTestServer();
    const list = await startHumans(2);
    const v = await finishInspections(list);
    const active = list.find((c) => c.playerId === v.game!.round.activePlayer)!;
    const other = list.find((c) => c !== active)!;
    for (const action of [{ type: 'revealAll' }, { type: 'usePeek', slot: 0, playerId: other.playerId }, { type: 'useSpy', target: { playerId: other.playerId, slot: 7 } }]) {
      expect(await active.raw({ actionId: randomUUID(), command: { type: 'game', action } })).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
    }
    // Using Spy without holding a Spy card is rejected without revealing anything.
    const ack = await active.game({ type: 'useSpy', target: { playerId: other.playerId, slot: 0 } });
    expect(ack).toMatchObject({ ok: false, error: { code: 'WRONG_PHASE' } });
    expect(JSON.stringify(ack)).not.toMatch(/value/);
    expect(active.events.some((e) => e.type === 'revealed')).toBe(false);
  });
});

describe('complete games', () => {
  function verifyResults(view: RoomView, events: VisibleEvent[]) {
    const g = view.game!;
    const results = events.filter((e): e is Extract<VisibleEvent, { type: 'roundEnded' }> => e.type === 'roundEnded').map((e) => e.result);
    expect(results.length).toBe(g.history.length);
    const totals = new Map<string, number>(g.players.map((p) => [p, 0]));
    const resetUsed = new Set<string>();
    for (const r of results) {
      const hands = Object.fromEntries(r.players.map((p) => [p.playerId, p.hand]));
      const expected = scoreRound({ players: g.players, hands, caboCaller: r.caboCaller });
      for (const p of r.players) {
        expect(p.handTotal).toBe(p.hand.reduce<number>((s, v) => s + (v ?? 0), 0));
        expect(p.roundScore).toBe(expected.roundScores[p.playerId]);
        let total = (totals.get(p.playerId) ?? 0) + p.roundScore;
        if (g.mode === 'full' && total === 100 && !resetUsed.has(p.playerId)) {
          total = 50;
          resetUsed.add(p.playerId);
        }
        totals.set(p.playerId, total);
        expect(p.totalAfter).toBe(total);
      }
      expect(r.winners).toEqual(expected.winners);
    }
    for (const s of g.scores) expect(s.total).toBe(totals.get(s.playerId));
    expect(g.result).not.toBeNull();
    const best = Math.min(...g.scores.map((s) => s.total));
    if (g.mode === 'full') {
      expect(g.scores.some((s) => s.total > 100)).toBe(true);
      expect(new Set(g.result!.winners)).toEqual(new Set(g.scores.filter((s) => s.total === best).map((s) => s.playerId)));
    }
  }

  it('plays a full multiplayer game between three humans to completion', async () => {
    t = await startTestServer();
    const list = await startHumans(3, 'full');
    const final = await driveToFinish(list, 1, 40_000);
    expect(final.phase).toBe('finished');
    verifyResults(list[0]!.latest(), list[0]!.events);
    for (const c of list) await c.waitFor((v) => v.phase === 'finished');
    const winners = list.map((c) => c.latest().game!.result!.winners.join(','));
    expect(new Set(winners).size).toBe(1);
  }, 60_000);

  it('plays a complete solo quick game against bots', async () => {
    t = await startTestServer();
    const human = await client(await createRoom(t.url, { name: 'Solo', mode: 'quick', botCount: 3 }));
    expectOk(await human.send({ type: 'startGame' }));
    await human.waitFor((v) => v.phase === 'playing');
    const final = await driveToFinish([human], 2, 40_000);
    expect(final.game!.result!.roundsPlayed).toBeLessThanOrEqual(3);
    verifyResults(human.latest(), human.events);
    for (const s of human.snapshots) assertSanitised(s);
  }, 60_000);

  it('plays a complete solo full game against a bot and returns to the lobby', async () => {
    t = await startTestServer();
    const human = await client(await createRoom(t.url, { name: 'Solo', mode: 'full', botCount: 1 }));
    expectOk(await human.send({ type: 'startGame' }));
    await driveToFinish([human], 1, 50_000);
    verifyResults(human.latest(), human.events);
    expectOk(await human.send({ type: 'returnToLobby' }));
    const lobby = await human.waitFor((v) => v.phase === 'lobby');
    expect(lobby.game).toBeNull();
    expect(lobby.participants).toHaveLength(2);
  }, 60_000);

  it('waits for connected humans before starting the next round', async () => {
    t = await startTestServer();
    const list = await startHumans(2, 'full');
    let v = await finishInspections(list);
    const caller = list.find((c) => c.playerId === v.game!.round.activePlayer)!;
    const other = list.find((c) => c !== caller)!;
    expectOk(await caller.game({ type: 'callCabo' }));
    expectOk(await other.game({ type: 'drawFromDeck' }));
    expectOk(await other.game({ type: 'discardDrawn' }));
    v = await caller.waitFor((x) => x.game?.phase === 'roundComplete' || x.game?.phase === 'gameComplete');
    if (v.game!.phase === 'gameComplete') return;
    expect(new Set(v.nextRound?.waitingFor)).toEqual(new Set([caller.playerId, other.playerId]));
    // Every hand is revealed once the round is over.
    for (const seat of v.game!.round.table) for (const s of seat.slots) if (s.occupied) expect(s.value).toBeDefined();
    expectOk(await caller.send({ type: 'readyNextRound' }));
    v = await other.waitFor((x) => x.nextRound?.waitingFor.length === 1);
    expect(v.nextRound?.waitingFor).toEqual([other.playerId]);
    expectOk(await other.send({ type: 'readyNextRound' }));
    v = await other.waitFor((x) => x.game?.round.number === 2);
    expect(v.game!.round.startingPlayer).toBe(v.game!.history[0]!.winners[0]);
  });
});
