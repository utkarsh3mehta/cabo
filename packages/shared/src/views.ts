import type { PlayerId, SlotRef } from './actions.js';
import type { Ability, CardValue, SlotIndex } from './cards.js';

export type GameMode = 'full' | 'quick';
export type DrawSource = 'deck' | 'discard';

/**
 * One position in a player's 2×2 layout as seen by a particular viewer.
 * `value` is present only while the viewer is entitled to see that card.
 * Face-down cards never carry an identifier.
 */
export interface SlotView {
  index: SlotIndex;
  occupied: boolean;
  value?: CardValue;
}

export interface TableSeatView {
  playerId: PlayerId;
  slots: SlotView[];
  cardCount: number;
  inspectionDone: boolean;
}

export type TurnStepView =
  | { kind: 'awaitingAction' }
  /** `value` is visible to the holder, and to everyone when the card came from the discard pile. */
  | { kind: 'holding'; source: DrawSource; value?: CardValue; ability: Ability | null }
  /** `value` is visible only to the acting player. */
  | { kind: 'viewing'; ability: 'peek' | 'spy'; target: SlotRef; value?: CardValue };

export interface RoundView {
  number: number;
  phase: 'initialInspection' | 'turns' | 'complete';
  startingPlayer: PlayerId;
  /** The player whose turn it is; null during initial inspection and after the round. */
  activePlayer: PlayerId | null;
  step: TurnStepView | null;
  caboCaller: PlayerId | null;
  finalTurnsRemaining: number | null;
  drawPileCount: number;
  discardTop: CardValue | null;
  discardCount: number;
  table: TableSeatView[];
  /** The viewer's own initial inspection state (null for bots-only views or after the phase). */
  myInspection: { peeked: SlotIndex[] | null; done: boolean } | null;
}

export interface ScoreView {
  playerId: PlayerId;
  total: number;
  resetUsed: boolean;
  roundWins: number;
}

export interface RoundPlayerResult {
  playerId: PlayerId;
  /** Values by slot after the round; null marks a slot emptied by matching. */
  hand: (CardValue | null)[];
  handTotal: number;
  roundScore: number;
  isWinner: boolean;
  calledCabo: boolean;
  caboPenaltyApplied: boolean;
  shotTheMoon: boolean;
  moonPenaltyApplied: boolean;
  totalBefore: number;
  totalAfter: number;
  resetApplied: boolean;
  roundWinsAfter: number;
}

export interface RoundResultView {
  roundNumber: number;
  caboCaller: PlayerId | null;
  moonShooter: PlayerId | null;
  winners: PlayerId[];
  players: RoundPlayerResult[];
}

export interface StandingView {
  playerId: PlayerId;
  rank: number;
  total: number;
  roundWins: number;
  isWinner: boolean;
}

export interface GameResultView {
  mode: GameMode;
  winners: PlayerId[];
  standings: StandingView[];
  roundsPlayed: number;
}

export interface RoundHistoryEntry {
  roundNumber: number;
  scores: Record<PlayerId, number>;
  winners: PlayerId[];
}

/** What the viewer may legally do right now. The server re-validates every move. */
export interface LegalActions {
  inspect: boolean;
  finishInspection: boolean;
  drawFromDeck: boolean;
  takeDiscard: boolean;
  callCabo: boolean;
  /** Own occupied slots that may receive the held card (replace or match). */
  replaceSlots: SlotIndex[];
  match: boolean;
  discardDrawn: boolean;
  ability: Ability | null;
  acknowledgeReveal: boolean;
}

export const NO_LEGAL_ACTIONS: LegalActions = Object.freeze({
  inspect: false,
  finishInspection: false,
  drawFromDeck: false,
  takeDiscard: false,
  callCabo: false,
  replaceSlots: [],
  match: false,
  discardDrawn: false,
  ability: null,
  acknowledgeReveal: false,
}) as LegalActions;

export interface GameView {
  mode: GameMode;
  phase: 'round' | 'roundComplete' | 'gameComplete';
  /** Seat order, which is also clockwise turn order. */
  players: PlayerId[];
  scores: ScoreView[];
  round: RoundView;
  lastRoundResult: RoundResultView | null;
  history: RoundHistoryEntry[];
  result: GameResultView | null;
  /** Number of rounds in a quick game; null for full games. */
  quickRounds: number | null;
  viewer: PlayerId;
  legal: LegalActions;
}

export type RoomPhase = 'lobby' | 'playing' | 'finished';
export type ParticipantKind = 'human' | 'bot';

export interface ParticipantView {
  playerId: PlayerId;
  name: string;
  kind: ParticipantKind;
  seat: number;
  connected: boolean;
  isHost: boolean;
  /** True when the participant has been disconnected beyond the grace period. */
  graceExpired: boolean;
  /** True when this seat was a human that has been handed over to a bot. */
  takenOverByBot: boolean;
}

export interface RoomSettings {
  mode: GameMode;
  allowBots: boolean;
}

export interface RoomView {
  code: string;
  version: number;
  phase: RoomPhase;
  you: { playerId: PlayerId; isHost: boolean };
  settings: RoomSettings;
  participants: ParticipantView[];
  game: GameView | null;
  nextRound: { ready: PlayerId[]; waitingFor: PlayerId[] } | null;
  limits: { minPlayers: number; maxPlayers: number; reconnectGraceMs: number };
}
