import { SLOT_INDICES, type CardValue, type GameAction, type GameMode, type PlayerId, type SlotIndex } from '@cabo/shared';
import { expect } from 'vitest';
import {
  applyAction,
  checkInvariants,
  createGame,
  createSeededRng,
  getLegalActions,
  type Card,
  type GameState,
  type Rng,
  type TransitionResult,
} from '../src/index.js';

export const rng = (seed: number | string = 1): Rng => createSeededRng(seed);

export function newGame(players: PlayerId[] = ['a', 'b', 'c'], mode: GameMode = 'full', seed: number | string = 1): GameState {
  return createGame({ players, mode }, { rng: rng(seed) }).state;
}

/** Applies an action that must succeed and returns the new state. */
export function act(state: GameState, actor: PlayerId, action: GameAction, seed: number | string = 99): GameState {
  const result = applyAction(state, actor, action, { rng: rng(seed) });
  if (!result.ok) throw new Error(`Expected ${action.type} by ${actor} to succeed: ${result.error.code} ${result.error.detail}`);
  expect(checkInvariants(result.state)).toEqual([]);
  return result.state;
}

export function actResult(state: GameState, actor: PlayerId, action: GameAction, seed: number | string = 99): TransitionResult {
  return applyAction(state, actor, action, { rng: rng(seed) });
}

export function expectRejected(state: GameState, actor: PlayerId, action: GameAction, code: string): void {
  const before = JSON.stringify(state);
  const result = applyAction(state, actor, action, { rng: rng(5) });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
  expect(JSON.stringify(state)).toBe(before);
}

export function finishInspections(state: GameState): GameState {
  let s = state;
  for (const p of s.players) {
    s = act(s, p, { type: 'inspect', slots: [0, 1] });
    s = act(s, p, { type: 'finishInspection' });
  }
  return s;
}

export interface RigSpec {
  /** Values per slot; null leaves a slot empty (as after a match). */
  hands?: Record<PlayerId, (CardValue | null)[]>;
  /** The next cards to be drawn, first element drawn first. */
  drawTop?: CardValue[];
  /** Discard pile from bottom to top. Defaults to a single card. */
  discard?: CardValue[];
  currentPlayer?: PlayerId;
  /** Leave the draw pile with exactly this many cards (after drawTop). */
  drawPileSize?: number;
}

/**
 * Rearranges the real cards of a game into a chosen scenario and puts the
 * round into the turn phase. Card accounting stays valid because cards are
 * only moved, never created.
 */
export function rig(state: GameState, spec: RigSpec): GameState {
  const s: GameState = JSON.parse(JSON.stringify(state));
  const round = s.round;
  const pool: Card[] = [...round.drawPile, ...round.discardPile];
  for (const p of s.players) for (const c of round.hands[p] ?? []) if (c) pool.push(c);
  if (round.step.kind === 'holding') pool.push(round.step.card);
  pool.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));

  const take = (value: CardValue): Card => {
    const i = pool.findIndex((c) => c.value === value);
    if (i < 0) throw new Error(`No card of value ${value} left to rig`);
    return pool.splice(i, 1)[0] as Card;
  };

  for (const p of s.players) {
    const wanted = spec.hands?.[p];
    round.hands[p] = SLOT_INDICES.map((i) => {
      if (!wanted) return null;
      const v = wanted[i];
      return v === null || v === undefined ? null : take(v);
    });
  }
  // Players without a specified hand get the lowest-numbered remaining cards that are not 12/13.
  for (const p of s.players) {
    if (spec.hands?.[p]) continue;
    round.hands[p] = SLOT_INDICES.map(() => {
      const i = pool.findIndex((c) => c.value >= 1 && c.value <= 6);
      return pool.splice(i, 1)[0] as Card;
    });
  }
  const top = (spec.drawTop ?? []).map(take);
  const discard = spec.discard ? spec.discard.map(take) : pool.splice(0, 1);
  let rest = pool;
  if (spec.drawPileSize !== undefined) {
    const keep = spec.drawPileSize - top.length;
    discard.unshift(...rest.slice(keep));
    rest = rest.slice(0, keep);
  }
  round.discardPile = discard;
  round.drawPile = [...rest, ...top.reverse()];
  round.phase = 'turns';
  for (const p of s.players) round.inspection[p] = { peeked: [0, 1], done: true };
  round.currentPlayer = spec.currentPlayer ?? s.players[0]!;
  round.step = { kind: 'awaitingAction' };
  round.caboCaller = null;
  round.finalTurnsRemaining = null;
  s.phase = 'round';
  expect(checkInvariants(s)).toEqual([]);
  return s;
}

export function handValues(state: GameState, p: PlayerId): (CardValue | null)[] {
  return (state.round.hands[p] ?? []).map((c) => (c ? c.value : null));
}

export function discardTop(state: GameState): CardValue | undefined {
  return state.round.discardPile[state.round.discardPile.length - 1]?.value;
}

/** Picks a uniformly random legal action for `player` using only legal-action data. */
export function randomLegalAction(state: GameState, player: PlayerId, r: Rng, allowCabo: boolean): GameAction | null {
  const legal = getLegalActions(state, player);
  const pick = <T>(xs: readonly T[]): T => xs[r.int(xs.length)] as T;
  if (legal.inspect) {
    const slots = [...SLOT_INDICES];
    const a = slots.splice(r.int(4), 1)[0] as SlotIndex;
    const b = slots[r.int(3)] as SlotIndex;
    return { type: 'inspect', slots: [a, b] };
  }
  if (legal.finishInspection) return { type: 'finishInspection' };
  if (legal.acknowledgeReveal) return { type: 'acknowledgeReveal' };
  if (legal.drawFromDeck) {
    const options: GameAction[] = [{ type: 'drawFromDeck' }];
    if (legal.takeDiscard) options.push({ type: 'takeDiscard' });
    if (legal.callCabo && allowCabo) options.push({ type: 'callCabo' });
    return pick(options);
  }
  if (legal.replaceSlots.length > 0) {
    const options: GameAction[] = legal.replaceSlots.map((slot) => ({ type: 'replace', slot }));
    if (legal.discardDrawn) options.push({ type: 'discardDrawn' });
    if (legal.match) {
      const shuffled = [...legal.replaceSlots].sort(() => r.int(3) - 1);
      const n = 2 + r.int(Math.min(3, legal.replaceSlots.length - 1));
      options.push({ type: 'match', slots: shuffled.slice(0, n) });
    }
    const opponents = state.players.filter((p) => p !== player);
    const opponent = pick(opponents);
    const oppSlots = SLOT_INDICES.filter((i) => state.round.hands[opponent]?.[i]);
    if (legal.ability === 'peek') options.push({ type: 'usePeek', slot: pick(legal.replaceSlots) });
    if (legal.ability === 'spy') options.push({ type: 'useSpy', target: { playerId: opponent, slot: pick(oppSlots) } });
    if (legal.ability === 'swap') {
      options.push({ type: 'useSwap', ownSlot: pick(legal.replaceSlots), target: { playerId: opponent, slot: pick(oppSlots) } });
    }
    return pick(options);
  }
  return null;
}
