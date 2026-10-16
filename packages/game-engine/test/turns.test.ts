import { CARD_INVENTORY, CARD_VALUES, eventsVisibleTo } from '@cabo/shared';
import { describe, expect, it } from 'vitest';
import { checkInvariants, createDeck, createGame, getLegalActions, getPlayerView } from '../src/index.js';
import {
  act,
  actResult,
  discardTop,
  expectRejected,
  finishInspections,
  handValues,
  newGame,
  rig,
  rng,
} from './helpers.js';

describe('deck', () => {
  it('builds the verified 52-card inventory with unique ids', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((c) => c.id)).size).toBe(52);
    for (const v of CARD_VALUES) expect(deck.filter((c) => c.value === v)).toHaveLength(CARD_INVENTORY[v]);
  });
});

describe('setup', () => {
  it('deals four cards to each player, flips one discard and keeps the rest as the draw pile', () => {
    for (const n of [2, 3, 4, 5]) {
      const players = ['p1', 'p2', 'p3', 'p4', 'p5'].slice(0, n);
      const s = newGame(players, 'full', n);
      expect(checkInvariants(s)).toEqual([]);
      for (const p of players) expect(s.round.hands[p]).toHaveLength(4);
      expect(s.round.discardPile).toHaveLength(1);
      expect(s.round.drawPile).toHaveLength(52 - 4 * n - 1);
      expect(s.round.phase).toBe('initialInspection');
      expect(players).toContain(s.round.startingPlayer);
    }
  });

  it('is reproducible for a given seed and differs across seeds', () => {
    const a = newGame(['a', 'b'], 'full', 'seed-x');
    const b = newGame(['a', 'b'], 'full', 'seed-x');
    const c = newGame(['a', 'b'], 'full', 'seed-y');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a.round.drawPile)).not.toBe(JSON.stringify(c.round.drawPile));
  });

  it('rejects invalid player counts and duplicate ids', () => {
    expect(() => createGame({ players: ['a'], mode: 'full' }, { rng: rng() })).toThrow();
    expect(() => createGame({ players: ['a', 'b', 'c', 'd', 'e', 'f'], mode: 'full' }, { rng: rng() })).toThrow();
    expect(() => createGame({ players: ['a', 'a'], mode: 'full' }, { rng: rng() })).toThrow();
  });
});

describe('initial inspection', () => {
  it('reveals exactly the two chosen cards to their owner only', () => {
    const s0 = newGame(['a', 'b', 'c']);
    const result = actResult(s0, 'a', { type: 'inspect', slots: [1, 3] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const forA = eventsVisibleTo(result.events, 'a');
    const forB = eventsVisibleTo(result.events, 'b');
    expect(forA).toEqual([
      {
        type: 'initialPeek',
        cards: [
          { slot: 1, value: s0.round.hands.a![1]!.value },
          { slot: 3, value: s0.round.hands.a![3]!.value },
        ],
      },
    ]);
    expect(forB).toEqual([]);

    const viewA = getPlayerView(result.state, 'a');
    const mySeat = viewA.round.table.find((t) => t.playerId === 'a')!;
    expect(mySeat.slots.map((sl) => sl.value)).toEqual([undefined, s0.round.hands.a![1]!.value, undefined, s0.round.hands.a![3]!.value]);
    const viewB = getPlayerView(result.state, 'b');
    for (const seat of viewB.round.table) for (const sl of seat.slots) expect(sl.value).toBeUndefined();
  });

  it('allows only one inspection and hides the cards again when finished', () => {
    let s = newGame(['a', 'b']);
    expectRejected(s, 'a', { type: 'finishInspection' }, 'ILLEGAL_ACTION');
    s = act(s, 'a', { type: 'inspect', slots: [0, 1] });
    expectRejected(s, 'a', { type: 'inspect', slots: [2, 3] }, 'ALREADY_DONE');
    s = act(s, 'a', { type: 'finishInspection' });
    expectRejected(s, 'a', { type: 'finishInspection' }, 'ALREADY_DONE');
    const seat = getPlayerView(s, 'a').round.table.find((t) => t.playerId === 'a')!;
    expect(seat.slots.every((sl) => sl.value === undefined)).toBe(true);
  });

  it('starts turns only after every player has finished', () => {
    let s = newGame(['a', 'b']);
    const starter = s.round.startingPlayer;
    expectRejected(s, starter, { type: 'drawFromDeck' }, 'WRONG_PHASE');
    s = act(s, 'a', { type: 'inspect', slots: [0, 1] });
    s = act(s, 'a', { type: 'finishInspection' });
    expect(s.round.phase).toBe('initialInspection');
    s = act(s, 'b', { type: 'inspect', slots: [2, 3] });
    s = act(s, 'b', { type: 'finishInspection' });
    expect(s.round.phase).toBe('turns');
    expect(s.round.currentPlayer).toBe(starter);
  });
});

describe('turn actions', () => {
  const base = () =>
    rig(newGame(['a', 'b', 'c']), {
      hands: { a: [5, 6, 2, 9], b: [1, 1, 4, 8], c: [3, 7, 10, 0] },
      drawTop: [4, 7, 9, 11, 5],
      discard: [6],
      currentPlayer: 'a',
    });

  it('draw then replace: the old card goes face up on the discard pile and the turn passes', () => {
    let s = base();
    const draw = actResult(s, 'a', { type: 'drawFromDeck' });
    expect(draw.ok).toBe(true);
    if (!draw.ok) return;
    expect(eventsVisibleTo(draw.events, 'a')).toContainEqual({ type: 'drawnCard', value: 4 });
    expect(eventsVisibleTo(draw.events, 'b')).not.toContainEqual(expect.objectContaining({ type: 'drawnCard' }));
    s = draw.state;
    expect(getPlayerView(s, 'a').round.step).toEqual({ kind: 'holding', source: 'deck', value: 4, ability: null });
    expect(getPlayerView(s, 'b').round.step).toEqual({ kind: 'holding', source: 'deck', ability: null });
    s = act(s, 'a', { type: 'replace', slot: 1 });
    expect(handValues(s, 'a')).toEqual([5, 4, 2, 9]);
    expect(discardTop(s)).toBe(6);
    expect(s.round.currentPlayer).toBe('b');
  });

  it('draw then discard without use', () => {
    let s = act(base(), 'a', { type: 'drawFromDeck' });
    s = act(s, 'a', { type: 'discardDrawn' });
    expect(discardTop(s)).toBe(4);
    expect(handValues(s, 'a')).toEqual([5, 6, 2, 9]);
    expect(s.round.currentPlayer).toBe('b');
  });

  it('taking the discard is public, must be used, and never grants an ability', () => {
    let s = rig(newGame(['a', 'b']), { hands: { a: [5, 6, 2, 9], b: [1, 1, 4, 8] }, discard: [4, 7] });
    const take = actResult(s, 'a', { type: 'takeDiscard' });
    expect(take.ok && eventsVisibleTo(take.events, 'b')).toContainEqual({ type: 'tookDiscard', player: 'a', value: 7 });
    s = act(s, 'a', { type: 'takeDiscard' });
    expect(getPlayerView(s, 'b').round.step).toEqual({ kind: 'holding', source: 'discard', value: 7, ability: null });
    expect(getLegalActions(s, 'a').ability).toBeNull();
    expect(getLegalActions(s, 'a').discardDrawn).toBe(false);
    expectRejected(s, 'a', { type: 'discardDrawn' }, 'ILLEGAL_ACTION');
    expectRejected(s, 'a', { type: 'usePeek', slot: 0 }, 'ILLEGAL_ACTION');
    s = act(s, 'a', { type: 'replace', slot: 3 });
    expect(handValues(s, 'a')).toEqual([5, 6, 2, 7]);
    expect(discardTop(s)).toBe(9);
  });

  it('rejects out-of-turn and out-of-step actions without changing state', () => {
    const s = base();
    expectRejected(s, 'b', { type: 'drawFromDeck' }, 'NOT_YOUR_TURN');
    expectRejected(s, 'a', { type: 'replace', slot: 0 }, 'WRONG_PHASE');
    expectRejected(s, 'a', { type: 'acknowledgeReveal' }, 'WRONG_PHASE');
    expectRejected(s, 'zed', { type: 'drawFromDeck' }, 'ILLEGAL_ACTION');
    const held = act(s, 'a', { type: 'drawFromDeck' });
    expectRejected(held, 'a', { type: 'drawFromDeck' }, 'WRONG_PHASE');
    expectRejected(held, 'a', { type: 'callCabo' }, 'WRONG_PHASE');
    expectRejected(held, 'a', { type: 'inspect', slots: [0, 1] }, 'WRONG_PHASE');
  });
});

describe('choice-card abilities', () => {
  const withDraw = (top: Parameters<typeof rig>[1]['drawTop']) =>
    rig(newGame(['a', 'b', 'c']), {
      hands: { a: [5, 6, 2, null], b: [1, 13, 4, 8], c: [3, 0, 10, 0] },
      drawTop: top,
      currentPlayer: 'a',
    });

  it('Peek shows one own card privately until acknowledged', () => {
    let s = act(withDraw([7]), 'a', { type: 'drawFromDeck' });
    expect(getLegalActions(s, 'a').ability).toBe('peek');
    expectRejected(s, 'a', { type: 'usePeek', slot: 3 }, 'INVALID_TARGET');
    expectRejected(s, 'a', { type: 'useSpy', target: { playerId: 'b', slot: 0 } }, 'ILLEGAL_ACTION');
    const r = actResult(s, 'a', { type: 'usePeek', slot: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(eventsVisibleTo(r.events, 'a')).toContainEqual({ type: 'revealed', ability: 'peek', target: { playerId: 'a', slot: 2 }, value: 2 });
    expect(eventsVisibleTo(r.events, 'b').some((e) => e.type === 'revealed')).toBe(false);
    s = r.state;
    expect(discardTop(s)).toBe(7);
    expect(getPlayerView(s, 'a').round.table[0]!.slots[2]!.value).toBe(2);
    expect(getPlayerView(s, 'b').round.table[0]!.slots[2]!.value).toBeUndefined();
    expect(getPlayerView(s, 'b').round.step).toEqual({ kind: 'viewing', ability: 'peek', target: { playerId: 'a', slot: 2 } });
    expectRejected(s, 'b', { type: 'acknowledgeReveal' }, 'NOT_YOUR_TURN');
    s = act(s, 'a', { type: 'acknowledgeReveal' });
    expect(getPlayerView(s, 'a').round.table[0]!.slots[2]!.value).toBeUndefined();
    expect(s.round.currentPlayer).toBe('b');
  });

  it("Spy shows one opponent card privately and rejects own or empty targets", () => {
    let s = act(withDraw([10]), 'a', { type: 'drawFromDeck' });
    expectRejected(s, 'a', { type: 'useSpy', target: { playerId: 'a', slot: 0 } }, 'INVALID_TARGET');
    expectRejected(s, 'a', { type: 'useSpy', target: { playerId: 'nobody', slot: 0 } }, 'INVALID_TARGET');
    const r = actResult(s, 'a', { type: 'useSpy', target: { playerId: 'b', slot: 1 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(eventsVisibleTo(r.events, 'a')).toContainEqual({ type: 'revealed', ability: 'spy', target: { playerId: 'b', slot: 1 }, value: 13 });
    for (const p of ['b', 'c']) expect(eventsVisibleTo(r.events, p).some((e) => e.type === 'revealed')).toBe(false);
    s = r.state;
    expect(getPlayerView(s, 'a').round.table[1]!.slots[1]!.value).toBe(13);
    expect(getPlayerView(s, 'b').round.table[1]!.slots[1]!.value).toBeUndefined();
    s = act(s, 'a', { type: 'acknowledgeReveal' });
    expect(getPlayerView(s, 'a').round.table[1]!.slots[1]!.value).toBeUndefined();
  });

  it('Swap exchanges one own and one opponent card without revealing either', () => {
    let s = act(withDraw([12]), 'a', { type: 'drawFromDeck' });
    expectRejected(s, 'a', { type: 'useSwap', ownSlot: 3, target: { playerId: 'b', slot: 0 } }, 'INVALID_TARGET');
    expectRejected(s, 'a', { type: 'useSwap', ownSlot: 0, target: { playerId: 'a', slot: 1 } }, 'INVALID_TARGET');
    const r = actResult(s, 'a', { type: 'useSwap', ownSlot: 0, target: { playerId: 'c', slot: 1 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(handValues(s, 'a')).toEqual([0, 6, 2, null]);
    expect(handValues(s, 'c')).toEqual([3, 5, 10, 0]);
    expect(discardTop(s)).toBe(12);
    expect(JSON.stringify(r.events.map((e) => e.event))).not.toMatch(/"value":(0|5),/);
    for (const p of ['a', 'b', 'c']) {
      for (const seat of getPlayerView(s, p).round.table) for (const sl of seat.slots) expect(sl.value).toBeUndefined();
    }
  });

  it('rejects abilities on plain cards and on the wrong ability', () => {
    const plain = act(withDraw([5]), 'a', { type: 'drawFromDeck' });
    expect(getLegalActions(plain, 'a').ability).toBeNull();
    expectRejected(plain, 'a', { type: 'usePeek', slot: 0 }, 'ILLEGAL_ACTION');
    const peekCard = act(withDraw([8]), 'a', { type: 'drawFromDeck' });
    expectRejected(peekCard, 'a', { type: 'useSwap', ownSlot: 0, target: { playerId: 'b', slot: 0 } }, 'ILLEGAL_ACTION');
  });

  it('allows keeping a choice card for its value', () => {
    let s = act(withDraw([11]), 'a', { type: 'drawFromDeck' });
    s = act(s, 'a', { type: 'replace', slot: 0 });
    expect(handValues(s, 'a')).toEqual([11, 6, 2, null]);
  });
});

describe('matching', () => {
  it('replaces a pair with one card and leaves the other slot empty', () => {
    let s = rig(newGame(['a', 'b']), { hands: { a: [5, 9, 5, 2], b: [1, 1, 1, 1] }, drawTop: [3] });
    s = act(s, 'a', { type: 'drawFromDeck' });
    const r = actResult(s, 'a', { type: 'match', slots: [2, 0] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(eventsVisibleTo(r.events, 'b')).toContainEqual({
      type: 'matchSucceeded', player: 'a', slots: [2, 0], value: 5, keptSlot: 2, source: 'deck', placedValue: null,
    });
    s = r.state;
    expect(handValues(s, 'a')).toEqual([null, 9, 3, 2]);
    expect(s.round.discardPile.slice(-2).map((c) => c.value)).toEqual([5, 5]);
    expect(getPlayerView(s, 'b').round.table[0]!.cardCount).toBe(3);
    expect(s.round.currentPlayer).toBe('b');
  });

  it('handles three and four of a kind', () => {
    let s = rig(newGame(['a', 'b']), { hands: { a: [4, 4, 9, 4], b: [1, 1, 2, 2] }, drawTop: [0] });
    s = act(s, 'a', { type: 'drawFromDeck' });
    s = act(s, 'a', { type: 'match', slots: [0, 1, 3] });
    expect(handValues(s, 'a')).toEqual([0, null, 9, null]);

    let t = rig(newGame(['a', 'b']), { hands: { a: [6, 6, 6, 6], b: [1, 1, 2, 2] }, drawTop: [13] });
    t = act(t, 'a', { type: 'drawFromDeck' });
    t = act(t, 'a', { type: 'match', slots: [3, 2, 1, 0] });
    expect(handValues(t, 'a')).toEqual([null, null, null, 13]);
  });

  it('works with the card taken from the discard pile, which is then public in place', () => {
    let s = rig(newGame(['a', 'b']), { hands: { a: [8, 8, 1, 2], b: [1, 1, 2, 2] }, discard: [9, 0] });
    s = act(s, 'a', { type: 'takeDiscard' });
    const r = actResult(s, 'a', { type: 'match', slots: [0, 1] });
    expect(r.ok && r.events.map((e) => e.event)).toContainEqual(expect.objectContaining({ type: 'matchSucceeded', placedValue: 0 }));
    s = act(s, 'a', { type: 'match', slots: [0, 1] });
    expect(handValues(s, 'a')).toEqual([0, null, 1, 2]);
  });

  it('a failed match reveals the cards to everyone, returns them, discards the drawn card and ends the turn', () => {
    let s = rig(newGame(['a', 'b', 'c']), { hands: { a: [5, 6, 5, 2], b: [1, 1, 2, 2], c: [3, 3, 4, 4] }, drawTop: [1] });
    s = act(s, 'a', { type: 'drawFromDeck' });
    const r = actResult(s, 'a', { type: 'match', slots: [0, 1, 2] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const viewer of ['a', 'b', 'c']) {
      expect(eventsVisibleTo(r.events, viewer)).toContainEqual({
        type: 'matchFailed', player: 'a', revealed: [{ slot: 0, value: 5 }, { slot: 1, value: 6 }, { slot: 2, value: 5 }], discardedValue: 1,
      });
    }
    s = r.state;
    expect(handValues(s, 'a')).toEqual([5, 6, 5, 2]);
    expect(discardTop(s)).toBe(1);
    expect(s.round.currentPlayer).toBe('b');
    // The returned cards are face down again for everyone.
    for (const viewer of ['a', 'b']) expect(getPlayerView(s, viewer).round.table[0]!.slots.every((sl) => sl.value === undefined)).toBe(true);
  });

  it('a failed match with the taken discard puts that card back on the discard pile', () => {
    let s = rig(newGame(['a', 'b']), { hands: { a: [5, 6, 1, 2], b: [1, 1, 2, 2] }, discard: [9, 4] });
    s = act(s, 'a', { type: 'takeDiscard' });
    s = act(s, 'a', { type: 'match', slots: [0, 1] });
    expect(handValues(s, 'a')).toEqual([5, 6, 1, 2]);
    expect(discardTop(s)).toBe(4);
  });

  it('rejects matches involving empty slots and keeps empty slots empty', () => {
    let s = rig(newGame(['a', 'b']), { hands: { a: [5, null, 5, 2], b: [1, 1, 2, 2] }, drawTop: [3, 4] });
    s = act(s, 'a', { type: 'drawFromDeck' });
    expectRejected(s, 'a', { type: 'match', slots: [0, 1] }, 'INVALID_TARGET');
    expectRejected(s, 'a', { type: 'replace', slot: 1 }, 'INVALID_TARGET');
    expect(getLegalActions(s, 'a').replaceSlots).toEqual([0, 2, 3]);
  });
});

describe('calling Cabo', () => {
  it('gives every other player exactly one more turn, then ends the round', () => {
    let s = rig(newGame(['a', 'b', 'c']), {
      hands: { a: [0, 1, 1, 2], b: [9, 9, 8, 8], c: [7, 7, 6, 6] },
      drawTop: [5, 5, 5],
      currentPlayer: 'a',
    });
    s = act(s, 'a', { type: 'callCabo' });
    expect(s.round.caboCaller).toBe('a');
    expect(s.round.finalTurnsRemaining).toBe(2);
    expect(s.round.currentPlayer).toBe('b');
    expectRejected(s, 'b', { type: 'callCabo' }, 'ILLEGAL_ACTION');
    expect(getLegalActions(s, 'b').callCabo).toBe(false);
    s = act(s, 'b', { type: 'drawFromDeck' });
    s = act(s, 'b', { type: 'discardDrawn' });
    expect(s.phase).toBe('round');
    expect(s.round.currentPlayer).toBe('c');
    s = act(s, 'c', { type: 'drawFromDeck' });
    s = act(s, 'c', { type: 'discardDrawn' });
    expect(s.phase).toBe('roundComplete');
    expect(s.round.phase).toBe('complete');
    expectRejected(s, 'a', { type: 'drawFromDeck' }, 'WRONG_PHASE');
    const result = s.roundResults[0]!;
    expect(result.caboCaller).toBe('a');
    expect(result.winners).toEqual(['a']);
    expect(result.players.map((p) => p.roundScore)).toEqual([0, 34, 26]);
  });

  it('may be called on the very first turn and with two players gives one final turn', () => {
    let s = finishInspections(newGame(['a', 'b'], 'full', 3));
    const caller = s.round.currentPlayer;
    const other = caller === 'a' ? 'b' : 'a';
    s = act(s, caller, { type: 'callCabo' });
    expect(s.round.finalTurnsRemaining).toBe(1);
    s = act(s, other, { type: 'drawFromDeck' });
    s = act(s, other, { type: 'discardDrawn' });
    expect(s.phase).not.toBe('round');
  });

  it("allows Spy and Swap on the caller's cards during final turns", () => {
    let s = rig(newGame(['a', 'b']), { hands: { a: [0, 1, 1, 2], b: [9, 9, 8, 8] }, drawTop: [11] });
    s = act(s, 'a', { type: 'callCabo' });
    s = act(s, 'b', { type: 'drawFromDeck' });
    s = act(s, 'b', { type: 'useSwap', ownSlot: 0, target: { playerId: 'a', slot: 0 } });
    expect(handValues(s, 'a')).toEqual([9, 1, 1, 2]);
    expect(s.roundResults[0]!.players.find((p) => p.playerId === 'a')!.handTotal).toBe(13);
  });

  it('a final turn that ends with a Peek finishes only after acknowledgement', () => {
    let s = rig(newGame(['a', 'b']), { hands: { a: [0, 1, 1, 2], b: [9, 9, 8, 8] }, drawTop: [7] });
    s = act(s, 'a', { type: 'callCabo' });
    s = act(s, 'b', { type: 'drawFromDeck' });
    s = act(s, 'b', { type: 'usePeek', slot: 2 });
    expect(s.phase).toBe('round');
    s = act(s, 'b', { type: 'acknowledgeReveal' });
    expect(s.phase).toBe('roundComplete');
  });
});

describe('draw pile exhaustion', () => {
  it('keeps the top discard and shuffles the rest into a new draw pile', () => {
    let s = rig(newGame(['a', 'b']), { hands: { a: [5, 6, 2, 9], b: [1, 1, 4, 8] }, drawTop: [3], drawPileSize: 1, discard: [10] });
    expect(s.round.drawPile).toHaveLength(1);
    s = act(s, 'a', { type: 'drawFromDeck' });
    s = act(s, 'a', { type: 'discardDrawn' });
    expect(s.round.drawPile).toHaveLength(0);
    const before = s.round.discardPile.length;
    const r = actResult(s, 'b', { type: 'drawFromDeck' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events.map((e) => e.event)).toContainEqual({ type: 'deckReshuffled', drawPileCount: before - 1 });
    expect(r.state.round.discardPile.map((c) => c.value)).toEqual([3]);
    expect(r.state.round.drawPile).toHaveLength(before - 2);
    expect(checkInvariants(r.state)).toEqual([]);
  });
});
