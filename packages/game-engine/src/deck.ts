import { CARD_INVENTORY, CARD_VALUES, DECK_SIZE } from '@cabo/shared';
import { shuffleInPlace, type Rng } from './rng.js';
import type { Card } from './state.js';

/** Builds the 52-card deck in a fixed order with unique identifiers. */
export function createDeck(): Card[] {
  const cards: Card[] = [];
  for (const value of CARD_VALUES) {
    for (let copy = 0; copy < CARD_INVENTORY[value]; copy++) {
      cards.push({ id: `c${cards.length}`, value });
    }
  }
  if (cards.length !== DECK_SIZE) throw new Error(`Deck inventory produced ${cards.length} cards`);
  return cards;
}

export function createShuffledDeck(rng: Rng): Card[] {
  const deck = createDeck();
  shuffleInPlace(deck, rng);
  return deck;
}
