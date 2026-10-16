import { CARD_INVENTORY, CARD_VALUES, DECK_SIZE, HAND_SIZE, type CardValue } from '@cabo/shared';
import type { Card, GameState } from './state.js';

/**
 * Checks physical card accounting: all 52 cards exist exactly once across the
 * draw pile, discard pile, layouts and the card in hand, with the verified
 * inventory. Returns a list of violations (empty when consistent).
 */
export function checkInvariants(state: GameState): string[] {
  const problems: string[] = [];
  const round = state.round;
  const locations = new Map<string, string>();
  const counts = new Map<CardValue, number>();
  const note = (card: Card, where: string) => {
    const previous = locations.get(card.id);
    if (previous) problems.push(`card ${card.id} is in both ${previous} and ${where}`);
    locations.set(card.id, where);
    counts.set(card.value, (counts.get(card.value) ?? 0) + 1);
  };

  round.drawPile.forEach((c) => note(c, 'drawPile'));
  round.discardPile.forEach((c) => note(c, 'discardPile'));
  for (const p of state.players) {
    const hand = round.hands[p];
    if (!hand) {
      problems.push(`missing hand for ${p}`);
      continue;
    }
    if (hand.length !== HAND_SIZE) problems.push(`hand of ${p} has ${hand.length} slots`);
    hand.forEach((c, i) => c && note(c, `hand:${p}:${i}`));
    if (round.phase !== 'complete' && hand.every((c) => c === null)) problems.push(`${p} has no cards`);
  }
  if (round.step.kind === 'holding') note(round.step.card, 'held');

  if (locations.size !== DECK_SIZE) problems.push(`expected ${DECK_SIZE} cards, found ${locations.size}`);
  for (const v of CARD_VALUES) {
    if ((counts.get(v) ?? 0) !== CARD_INVENTORY[v]) problems.push(`value ${v} appears ${counts.get(v) ?? 0} times`);
  }
  if (round.phase === 'turns' && round.step.kind === 'awaitingAction' && round.discardPile.length === 0) {
    problems.push('discard pile empty at the start of a turn');
  }
  if (round.caboCaller !== null && round.finalTurnsRemaining === null) problems.push('Cabo called without final turns');
  return problems;
}
