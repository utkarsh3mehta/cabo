import { SLOT_INDICES, type GameView, type PlayerId, type SlotIndex } from '@cabo/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  checkInvariants,
  createSeededRng,
  getPlayerView,
  startNextRound,
  type GameState,
} from '../src/index.js';
import { act, newGame, randomLegalAction, rig } from './helpers.js';

/**
 * Independent oracle for what a viewer may see, written from the rules
 * specification §11 rather than from the engine's implementation.
 */
function allowedSlots(state: GameState, viewer: PlayerId): Set<string> {
  const allowed = new Set<string>();
  const round = state.round;
  if (round.phase === 'complete') {
    for (const p of state.players) for (const i of SLOT_INDICES) allowed.add(`${p}:${i}`);
  } else if (round.phase === 'initialInspection') {
    const own = round.inspection[viewer];
    if (own && !own.done) for (const i of own.peeked ?? []) allowed.add(`${viewer}:${i}`);
  } else if (round.step.kind === 'viewing' && round.currentPlayer === viewer) {
    allowed.add(`${round.step.target.playerId}:${round.step.target.slot}`);
  }
  return allowed;
}

function assertNoLeak(state: GameState, viewer: PlayerId, view: GameView): void {
  const allowed = allowedSlots(state, viewer);
  for (const seat of view.round.table) {
    for (const slot of seat.slots) {
      if (slot.value !== undefined) expect(allowed.has(`${seat.playerId}:${slot.index}`)).toBe(true);
      const actual = state.round.hands[seat.playerId]?.[slot.index as SlotIndex];
      expect(slot.occupied).toBe(!!actual);
    }
  }
  const step = state.round.step;
  if (state.round.phase === 'turns' && step.kind === 'holding' && step.source === 'deck' && state.round.currentPlayer !== viewer) {
    expect(view.round.step).toEqual({ kind: 'holding', source: 'deck', ability: null });
  }
  // Card identifiers never leave the engine.
  expect(JSON.stringify(view)).not.toMatch(/"id"\s*:/);
}

describe('player views', () => {
  it('never include another player’s face-down cards during a round', () => {
    let s = rig(newGame(['a', 'b', 'c']), { hands: { a: [1, 2, 3, 4], b: [5, 6, 7, 8], c: [9, 10, 11, 12] }, drawTop: [0] });
    for (const viewer of ['a', 'b', 'c']) assertNoLeak(s, viewer, getPlayerView(s, viewer));
    s = act(s, 'a', { type: 'drawFromDeck' });
    expect(getPlayerView(s, 'a').round.step).toMatchObject({ value: 0 });
    for (const viewer of ['b', 'c']) {
      const view = getPlayerView(s, viewer);
      expect(JSON.stringify(view.round.step)).not.toContain('"value"');
      assertNoLeak(s, viewer, view);
    }
  });

  it('reveal every hand once the round is complete', () => {
    let s = rig(newGame(['a', 'b']), { hands: { a: [1, 2, 3, 4], b: [5, 6, 7, 8] }, drawTop: [0] });
    s = act(s, 'a', { type: 'callCabo' });
    s = act(s, 'b', { type: 'drawFromDeck' });
    s = act(s, 'b', { type: 'discardDrawn' });
    const view = getPlayerView(s, 'a');
    expect(view.round.table.map((t) => t.slots.map((x) => x.value))).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]);
  });

  it('give an outsider no private information at all', () => {
    const s = act(newGame(['a', 'b']), 'a', { type: 'inspect', slots: [0, 1] });
    const view = getPlayerView(s, 'intruder');
    expect(view.legal.inspect).toBe(false);
    expect(view.round.myInspection).toBeNull();
    for (const seat of view.round.table) for (const sl of seat.slots) expect(sl.value).toBeUndefined();
  });
});

describe('random legal playouts (property-based)', () => {
  it('preserve card accounting, never leak hidden cards and always finish', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), fc.integer({ min: 2, max: 5 }), fc.constantFrom('full' as const, 'quick' as const), (seed, n, mode) => {
        const players = ['p1', 'p2', 'p3', 'p4', 'p5'].slice(0, n);
        let s = newGame(players, mode, seed);
        const r = createSeededRng(`play-${seed}`);
        let steps = 0;
        let turnsThisRound = 0;
        while (s.phase !== 'gameComplete') {
          steps++;
          if (steps > 20_000) throw new Error('game did not terminate');
          if (s.phase === 'roundComplete') {
            const next = startNextRound(s, { rng: r });
            if (!next.ok) throw new Error('could not start next round');
            s = next.state;
            turnsThisRound = 0;
            continue;
          }
          const actors = s.round.phase === 'initialInspection'
            ? s.players.filter((p) => !s.round.inspection[p]?.done)
            : [s.round.currentPlayer];
          const actor = actors[r.int(actors.length)] as PlayerId;
          if (s.round.phase === 'turns' && s.round.step.kind === 'awaitingAction') turnsThisRound++;
          const action = randomLegalAction(s, actor, r, turnsThisRound > 6 || r.int(25) === 0);
          if (!action) throw new Error(`no legal action for ${actor}`);
          const result = applyAction(s, actor, action, { rng: r });
          if (!result.ok) throw new Error(`legal action rejected: ${action.type} ${result.error.code} ${result.error.detail}`);
          s = result.state;
          expect(checkInvariants(s)).toEqual([]);
          // Private events only ever target the acting player.
          for (const e of result.events) if (e.audience !== 'all') expect(e.audience).toBe(actor);
          for (const viewer of s.players) assertNoLeak(s, viewer, getPlayerView(s, viewer));
        }
        expect(s.result?.winners.length).toBeGreaterThan(0);
        if (mode === 'quick') expect(s.roundResults.length).toBeLessThanOrEqual(3);
        else expect(s.players.some((p) => (s.scores[p]?.total ?? 0) > 100)).toBe(true);
      }),
      { numRuns: 40 },
    );
  });

  it('reject random malformed or unauthorised actions without changing state', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), fc.jsonValue(), (seed, junk) => {
        const s = rig(newGame(['a', 'b', 'c'], 'full', seed), {});
        const before = JSON.stringify(s);
        const result = applyAction(s, 'b', { type: 'drawFromDeck' }, { rng: createSeededRng(seed) });
        expect(result.ok).toBe(false);
        // A structurally invalid action (bypassing schema validation) is also rejected.
        const r2 = applyAction(s, 'a', junk as never, { rng: createSeededRng(seed) });
        expect(r2.ok).toBe(false);
        expect(JSON.stringify(s)).toBe(before);
      }),
      { numRuns: 100 },
    );
  });
});
