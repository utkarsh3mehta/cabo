import type { PlayerId, SlotRef } from './actions.js';
import type { CardValue, SlotIndex } from './cards.js';
import type { DrawSource, GameResultView, RoundResultView } from './views.js';

/**
 * Game events as delivered to one recipient. Each event is produced with an
 * audience; private events (marked below) only ever reach that player.
 */
export type VisibleEvent =
  | { type: 'roundStarted'; round: number; startingPlayer: PlayerId }
  /** Private: the values of the recipient's two initially inspected cards. */
  | { type: 'initialPeek'; cards: Array<{ slot: SlotIndex; value: CardValue }> }
  | { type: 'inspectionFinished'; player: PlayerId }
  | { type: 'turnStarted'; player: PlayerId }
  | { type: 'drewFromDeck'; player: PlayerId }
  /** Private: the card the recipient just drew from the draw pile. */
  | { type: 'drawnCard'; value: CardValue }
  | { type: 'tookDiscard'; player: PlayerId; value: CardValue }
  /**
   * A card replaced one slot. `discardedValue` is now face up on the discard
   * pile. `placedValue` is public only when the card came from the discard pile.
   */
  | {
      type: 'replaced';
      player: PlayerId;
      slot: SlotIndex;
      source: DrawSource;
      discardedValue: CardValue;
      placedValue: CardValue | null;
    }
  | { type: 'discardedDrawn'; player: PlayerId; value: CardValue }
  /** Public: someone used Peek or Spy on a slot (no value). */
  | { type: 'inspected'; player: PlayerId; ability: 'peek' | 'spy'; target: SlotRef }
  /** Private: the value seen through Peek or Spy. */
  | { type: 'revealed'; ability: 'peek' | 'spy'; target: SlotRef; value: CardValue }
  | { type: 'revealEnded'; player: PlayerId }
  | { type: 'swapped'; player: PlayerId; own: SlotRef; other: SlotRef }
  | {
      type: 'matchSucceeded';
      player: PlayerId;
      slots: SlotIndex[];
      value: CardValue;
      keptSlot: SlotIndex;
      source: DrawSource;
      placedValue: CardValue | null;
    }
  | {
      type: 'matchFailed';
      player: PlayerId;
      revealed: Array<{ slot: SlotIndex; value: CardValue }>;
      discardedValue: CardValue;
    }
  | { type: 'caboCalled'; player: PlayerId; finalTurns: number }
  | { type: 'deckReshuffled'; drawPileCount: number }
  | { type: 'roundEnded'; result: RoundResultView }
  | { type: 'gameEnded'; result: GameResultView };

export type VisibleEventType = VisibleEvent['type'];

/** An event plus the audience it may be delivered to. Server-side only. */
export interface RoutedEvent {
  audience: 'all' | PlayerId;
  event: VisibleEvent;
}

export function eventsVisibleTo(events: readonly RoutedEvent[], playerId: PlayerId): VisibleEvent[] {
  return events.filter((e) => e.audience === 'all' || e.audience === playerId).map((e) => e.event);
}
