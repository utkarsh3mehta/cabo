/**
 * Card definitions for the current publisher's standard Cabo deck.
 *
 * See docs/RULES_SPECIFICATION.md §2 for sources and verification status.
 * The per-value counts and the ability mapping are corroborated by several
 * independent sources but are not printed in the publisher's published text;
 * if a physical deck disagrees, this file is the only place to change.
 */

export const MIN_CARD_VALUE = 0;
export const MAX_CARD_VALUE = 13;

/** A card's printed number, which is also its score. */
export type CardValue = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

export const CARD_VALUES: readonly CardValue[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

/** Number of copies of each value in one deck. */
export const CARD_INVENTORY: Readonly<Record<CardValue, number>> = {
  0: 2,
  1: 4,
  2: 4,
  3: 4,
  4: 4,
  5: 4,
  6: 4,
  7: 4,
  8: 4,
  9: 4,
  10: 4,
  11: 4,
  12: 4,
  13: 2,
};

export const DECK_SIZE = 52;

export type Ability = 'peek' | 'spy' | 'swap';

/** The choice-card ability printed on a value, or null for plain cards. */
export function abilityForValue(value: CardValue): Ability | null {
  if (value === 7 || value === 8) return 'peek';
  if (value === 9 || value === 10) return 'spy';
  if (value === 11 || value === 12) return 'swap';
  return null;
}

export function isCardValue(value: unknown): value is CardValue {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_CARD_VALUE && value <= MAX_CARD_VALUE;
}

/** Cards dealt to each player and the number of layout slots. */
export const HAND_SIZE = 4;

export type SlotIndex = 0 | 1 | 2 | 3;
export const SLOT_INDICES: readonly SlotIndex[] = [0, 1, 2, 3];

export function isSlotIndex(value: unknown): value is SlotIndex {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

/** Number of cards each player inspects privately at the start of a round. */
export const INITIAL_PEEK_COUNT = 2;

/** Scoring constants from the publisher's standard rules. */
export const SCORING = {
  failedCaboPenalty: 5,
  moonPenaltyForOthers: 50,
  resetTrigger: 100,
  resetTo: 50,
  /** The full game ends when any cumulative score is strictly greater than this. */
  gameEndThreshold: 100,
} as const;

/** The quick-play option: best of three rounds. */
export const QUICK_GAME_ROUNDS = 3;
