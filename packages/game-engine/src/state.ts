import type {
  CardValue,
  DrawSource,
  GameMode,
  GameResultView,
  PlayerId,
  RoundResultView,
  SlotIndex,
  SlotRef,
} from '@cabo/shared';

/**
 * A physical card. `id` is unique within a game and exists for accounting
 * only; it is never sent to clients (see ARCHITECTURE.md §4).
 */
export interface Card {
  readonly id: string;
  readonly value: CardValue;
}

/** Four layout slots; null marks a slot emptied by a successful match. */
export type Hand = (Card | null)[];

export interface PlayerScore {
  total: number;
  resetUsed: boolean;
  roundWins: number;
}

export type TurnStep =
  | { kind: 'awaitingAction' }
  | { kind: 'holding'; card: Card; source: DrawSource }
  | { kind: 'viewing'; ability: 'peek' | 'spy'; target: SlotRef };

export interface InspectionState {
  peeked: SlotIndex[] | null;
  done: boolean;
}

export type RoundPhase = 'initialInspection' | 'turns' | 'complete';

export interface RoundState {
  number: number;
  phase: RoundPhase;
  startingPlayer: PlayerId;
  /** Top of the pile is the last element. */
  drawPile: Card[];
  /** Top of the pile is the last element. */
  discardPile: Card[];
  hands: Record<PlayerId, Hand>;
  inspection: Record<PlayerId, InspectionState>;
  currentPlayer: PlayerId;
  step: TurnStep;
  caboCaller: PlayerId | null;
  /** Turns still owed after a Cabo call; null before Cabo is called. */
  finalTurnsRemaining: number | null;
}

export interface GameConfig {
  mode: GameMode;
}

export type GamePhase = 'round' | 'roundComplete' | 'gameComplete';

export interface GameState {
  config: GameConfig;
  /** Seat order, which is also clockwise turn order. */
  players: PlayerId[];
  scores: Record<PlayerId, PlayerScore>;
  roundResults: RoundResultView[];
  phase: GamePhase;
  round: RoundState;
  result: GameResultView | null;
}
