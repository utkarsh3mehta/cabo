import {
  SLOT_INDICES,
  type CardValue,
  type GameAction,
  type GameView,
  type PlayerId,
  type SlotIndex,
} from '@cabo/shared';
import type { BotMemory } from './memory.js';

/** Minimal random source (structurally compatible with the engine's Rng). */
export interface BotRng {
  int(maxExclusive: number): number;
}

/** Average card value of the deck: (2·0 + 4·(1+…+12) + 2·13) / 52 = 6.5. */
export const UNKNOWN_CARD_ESTIMATE = 6.5;

const chance = (rng: BotRng, percent: number) => rng.int(100) < percent;
const pick = <T>(rng: BotRng, items: readonly T[]): T => items[rng.int(items.length)] as T;

interface OwnSlot {
  slot: SlotIndex;
  value: CardValue | undefined;
  expected: number;
}

function ownSlots(view: GameView, memory: BotMemory): OwnSlot[] {
  const seat = view.round.table.find((t) => t.playerId === view.viewer);
  if (!seat) return [];
  return SLOT_INDICES.filter((i) => seat.slots[i]?.occupied).map((slot) => {
    const value = memory.get(view.viewer, slot);
    return { slot, value, expected: value ?? UNKNOWN_CARD_ESTIMATE };
  });
}

/** Known groups of 2+ own cards with the same value, best first. */
function knownGroups(slots: OwnSlot[]): Array<{ value: CardValue; slots: SlotIndex[] }> {
  const byValue = new Map<CardValue, SlotIndex[]>();
  for (const s of slots) if (s.value !== undefined) byValue.set(s.value, [...(byValue.get(s.value) ?? []), s.slot]);
  return [...byValue.entries()]
    .filter(([, group]) => group.length >= 2)
    .map(([value, group]) => ({ value, slots: group }))
    .sort((a, b) => b.value * b.slots.length - a.value * a.slots.length);
}

/** The own slot most worth replacing (highest expected value, unknowns slightly preferred on ties). */
function worstSlot(slots: OwnSlot[], rng: BotRng): OwnSlot | undefined {
  let best: OwnSlot | undefined;
  let bestScore = -Infinity;
  for (const s of slots) {
    const score = s.expected + (s.value === undefined ? 0.25 : 0) + rng.int(10) / 100;
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

function opponentSlots(view: GameView, memory: BotMemory) {
  const result: Array<{ playerId: PlayerId; slot: SlotIndex; value: CardValue | undefined }> = [];
  for (const seat of view.round.table) {
    if (seat.playerId === view.viewer) continue;
    for (const slot of SLOT_INDICES) {
      if (seat.slots[slot]?.occupied) result.push({ playerId: seat.playerId, slot, value: memory.get(seat.playerId, slot) });
    }
  }
  return result;
}

function chooseMatchOrReplace(
  view: GameView,
  memory: BotMemory,
  rng: BotRng,
  held: CardValue,
  mustUse: boolean,
): GameAction | null {
  const slots = ownSlots(view, memory);
  const allowed = new Set(view.legal.replaceSlots);
  const usable = slots.filter((s) => allowed.has(s.slot));

  if (view.legal.match) {
    const group = knownGroups(usable).find((g) => g.value * g.slots.length - held > 2);
    if (group) {
      const ordered = [...group.slots].sort(() => rng.int(3) - 1);
      return { type: 'match', slots: ordered };
    }
  }
  const worst = worstSlot(usable, rng);
  if (!worst) return null;
  const margin = 1 + rng.int(2);
  if (mustUse || held + margin <= worst.expected || (held <= 2 && worst.value === undefined)) {
    return { type: 'replace', slot: worst.slot };
  }
  return null;
}

function estimateOwnTotal(view: GameView, memory: BotMemory) {
  const slots = ownSlots(view, memory);
  const unknown = slots.filter((s) => s.value === undefined).length;
  const knownTotal = slots.reduce((sum, s) => sum + (s.value ?? 0), 0);
  return { unknown, knownTotal, estimate: knownTotal + unknown * UNKNOWN_CARD_ESTIMATE };
}

function shouldCallCabo(view: GameView, memory: BotMemory, rng: BotRng): boolean {
  if (!view.legal.callCabo) return false;
  const { unknown, knownTotal, estimate } = estimateOwnTotal(view, memory);
  // Grows more willing as the round drags on, so games keep moving.
  const patience = Math.floor(memory.turnsThisRound / 4);
  const threshold = 5 + rng.int(4) + patience;
  if (unknown === 0) return knownTotal <= threshold;
  if (unknown === 1) return knownTotal + 4 <= threshold;
  return memory.turnsThisRound > 12 && estimate <= threshold + 6;
}

function decideOnHeldCard(view: GameView, memory: BotMemory, rng: BotRng): GameAction {
  const step = view.round.step;
  if (step?.kind !== 'holding' || step.value === undefined) {
    // Should not happen for the holder; fall back to the safest legal option.
    return view.legal.discardDrawn ? { type: 'discardDrawn' } : { type: 'replace', slot: view.legal.replaceSlots[0] ?? 0 };
  }
  const held = step.value;
  const ability = view.legal.ability;
  const slots = ownSlots(view, memory);

  // A really good card is better kept than spent on an ability.
  if (held <= 3 || !ability) {
    const choice = chooseMatchOrReplace(view, memory, rng, held, !view.legal.discardDrawn);
    if (choice) return choice;
  }

  if (ability === 'peek') {
    const unknownOwn = slots.filter((s) => s.value === undefined);
    if (unknownOwn.length > 0 && chance(rng, 90)) return { type: 'usePeek', slot: pick(rng, unknownOwn).slot };
  } else if (ability === 'spy') {
    const unknown = opponentSlots(view, memory).filter((s) => s.value === undefined);
    if (unknown.length > 0 && chance(rng, 65)) {
      const caller = view.round.caboCaller;
      const preferred = caller ? unknown.filter((s) => s.playerId === caller) : [];
      const target = pick(rng, preferred.length > 0 ? preferred : unknown);
      return { type: 'useSpy', target: { playerId: target.playerId, slot: target.slot } };
    }
  } else if (ability === 'swap') {
    const myHigh = slots.filter((s) => s.value !== undefined && s.value >= 8).sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
    const theirLow = opponentSlots(view, memory)
      .filter((s) => s.value !== undefined && s.value <= 3)
      .sort((a, b) => (a.value ?? 0) - (b.value ?? 0))[0];
    if (myHigh && theirLow && chance(rng, 90)) {
      return { type: 'useSwap', ownSlot: myHigh.slot, target: { playerId: theirLow.playerId, slot: theirLow.slot } };
    }
  }

  const choice = chooseMatchOrReplace(view, memory, rng, held, !view.legal.discardDrawn);
  if (choice) return choice;
  return { type: 'discardDrawn' };
}

function decideTurnStart(view: GameView, memory: BotMemory, rng: BotRng): GameAction {
  if (shouldCallCabo(view, memory, rng)) return { type: 'callCabo' };
  const top = view.round.discardTop;
  if (view.legal.takeDiscard && top !== null) {
    const slots = ownSlots(view, memory);
    const groups = knownGroups(slots);
    if (groups.some((g) => g.value * g.slots.length - top > 4) && chance(rng, 80)) return { type: 'takeDiscard' };
    const worst = worstSlot(slots, rng);
    if (worst && top <= 4 && worst.expected - top >= 3 && chance(rng, 85)) return { type: 'takeDiscard' };
  }
  return { type: 'drawFromDeck' };
}

/**
 * Chooses the bot's next action from its own view and memory only.
 * Returns null when the bot has nothing to do.
 */
export function decideAction(view: GameView, memory: BotMemory, rng: BotRng): GameAction | null {
  memory.syncWithView(view);
  const legal = view.legal;
  if (legal.inspect) {
    const slots = [...SLOT_INDICES];
    const first = slots.splice(rng.int(slots.length), 1)[0] as SlotIndex;
    return { type: 'inspect', slots: [first, pick(rng, slots)] };
  }
  if (legal.finishInspection) return { type: 'finishInspection' };
  if (legal.acknowledgeReveal) return { type: 'acknowledgeReveal' };
  if (legal.drawFromDeck) return decideTurnStart(view, memory, rng);
  if (legal.replaceSlots.length > 0) return decideOnHeldCard(view, memory, rng);
  return null;
}

/** The simplest legal action, used if a strategic choice is ever rejected. */
export function fallbackAction(view: GameView): GameAction | null {
  const legal = view.legal;
  if (legal.inspect) return { type: 'inspect', slots: [0, 1] };
  if (legal.finishInspection) return { type: 'finishInspection' };
  if (legal.acknowledgeReveal) return { type: 'acknowledgeReveal' };
  if (legal.drawFromDeck) return { type: 'drawFromDeck' };
  if (legal.discardDrawn) return { type: 'discardDrawn' };
  const slot = legal.replaceSlots[0];
  if (slot !== undefined) return { type: 'replace', slot };
  return null;
}
