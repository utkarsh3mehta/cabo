import {
  HAND_SIZE,
  INITIAL_PEEK_COUNT,
  MAX_PLAYERS,
  MIN_PLAYERS,
  abilityForValue,
  gameActionSchema,
  type CardValue,
  type GameAction,
  type GameMode,
  type PlayerId,
  type RoundPlayerResult,
  type RoundResultView,
  type RoutedEvent,
  type SlotIndex,
  type SlotRef,
  type VisibleEvent,
} from '@cabo/shared';
import { createShuffledDeck } from './deck.js';
import { EngineRejection, reject, type EngineError } from './errors.js';
import { shuffleInPlace, type Rng } from './rng.js';
import { applyRoundScore, evaluateGameEnd, pickNextStarter, scoreRound } from './scoring.js';
import type { Card, GameState, Hand, PlayerScore, RoundState } from './state.js';

export interface EngineDeps {
  rng: Rng;
}

export type TransitionResult =
  | { ok: true; state: GameState; events: RoutedEvent[] }
  | { ok: false; error: EngineError };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cloneState(state: GameState): GameState {
  // The state is plain JSON data by construction (no Maps, Dates or class instances).
  return JSON.parse(JSON.stringify(state)) as GameState;
}

class EventSink {
  readonly events: RoutedEvent[] = [];
  all(event: VisibleEvent): void {
    this.events.push({ audience: 'all', event });
  }
  to(player: PlayerId, event: VisibleEvent): void {
    this.events.push({ audience: player, event });
  }
}

function handOf(round: RoundState, player: PlayerId): Hand {
  const hand = round.hands[player];
  if (!hand) reject('INVALID_TARGET', 'unknown player');
  return hand;
}

function occupiedCard(hand: Hand, slot: SlotIndex): Card {
  const card = hand[slot];
  if (!card) reject('INVALID_TARGET', `slot ${slot} is empty`);
  return card;
}

function nextPlayer(players: readonly PlayerId[], current: PlayerId): PlayerId {
  const i = players.indexOf(current);
  return players[(i + 1) % players.length] as PlayerId;
}

function topOf(pile: readonly Card[]): Card | undefined {
  return pile[pile.length - 1];
}

// ---------------------------------------------------------------------------
// Game and round setup
// ---------------------------------------------------------------------------

export interface CreateGameOptions {
  mode: GameMode;
  /** Seat order of all participants, bots included. */
  players: readonly PlayerId[];
}

/** Shuffles, deals four cards to everyone and flips the first discard. */
function dealRound(
  players: readonly PlayerId[],
  roundNumber: number,
  startingPlayer: PlayerId,
  rng: Rng,
): RoundState {
  const drawPile = createShuffledDeck(rng);
  const hands: Record<PlayerId, Hand> = {};
  const inspection: RoundState['inspection'] = {};
  for (const p of players) {
    hands[p] = [];
    inspection[p] = { peeked: null, done: false };
  }
  for (let i = 0; i < HAND_SIZE; i++) {
    for (const p of players) {
      const card = drawPile.pop();
      if (!card) throw new Error('Deck exhausted while dealing');
      (hands[p] as Hand).push(card);
    }
  }
  const firstDiscard = drawPile.pop();
  if (!firstDiscard) throw new Error('Deck exhausted while dealing');
  return {
    number: roundNumber,
    phase: 'initialInspection',
    startingPlayer,
    drawPile,
    discardPile: [firstDiscard],
    hands,
    inspection,
    currentPlayer: startingPlayer,
    step: { kind: 'awaitingAction' },
    caboCaller: null,
    finalTurnsRemaining: null,
  };
}

export function createGame(options: CreateGameOptions, deps: EngineDeps): { state: GameState; events: RoutedEvent[] } {
  const players = [...options.players];
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new Error(`A game needs ${MIN_PLAYERS}–${MAX_PLAYERS} players`);
  }
  if (new Set(players).size !== players.length) throw new Error('Duplicate player ids');
  const starter = players[deps.rng.int(players.length)] as PlayerId;
  const scores: Record<PlayerId, PlayerScore> = {};
  for (const p of players) scores[p] = { total: 0, resetUsed: false, roundWins: 0 };
  const state: GameState = {
    config: { mode: options.mode },
    players,
    scores,
    roundResults: [],
    phase: 'round',
    round: dealRound(players, 1, starter, deps.rng),
    result: null,
  };
  return { state, events: [{ audience: 'all', event: { type: 'roundStarted', round: 1, startingPlayer: starter } }] };
}

/** Starts the next round once the previous one has been scored. */
export function startNextRound(state: GameState, deps: EngineDeps): TransitionResult {
  if (state.phase !== 'roundComplete') {
    return { ok: false, error: { code: 'WRONG_PHASE', detail: 'round is not complete' } };
  }
  const draft = cloneState(state);
  const previous = draft.roundResults[draft.roundResults.length - 1];
  const starter = pickNextStarter(draft.players, draft.round.startingPlayer, previous?.winners ?? []);
  draft.round = dealRound(draft.players, draft.round.number + 1, starter, deps.rng);
  draft.phase = 'round';
  return {
    ok: true,
    state: draft,
    events: [{ audience: 'all', event: { type: 'roundStarted', round: draft.round.number, startingPlayer: starter } }],
  };
}

// ---------------------------------------------------------------------------
// Turn flow
// ---------------------------------------------------------------------------

function requirePlayer(state: GameState, actor: PlayerId): void {
  if (!state.players.includes(actor)) reject('ILLEGAL_ACTION', 'actor is not seated in this game');
}

function requireTurn(state: GameState, actor: PlayerId): RoundState {
  if (state.phase !== 'round') reject('WRONG_PHASE', 'no round in progress');
  const round = state.round;
  if (round.phase !== 'turns') reject('WRONG_PHASE', 'round is not in the turn phase');
  if (round.currentPlayer !== actor) reject('NOT_YOUR_TURN', 'actor is not the current player');
  return round;
}

function requireAwaiting(state: GameState, actor: PlayerId): RoundState {
  const round = requireTurn(state, actor);
  if (round.step.kind !== 'awaitingAction') reject('WRONG_PHASE', 'turn already started');
  return round;
}

function requireHolding(state: GameState, actor: PlayerId): { round: RoundState; card: Card; source: 'deck' | 'discard' } {
  const round = requireTurn(state, actor);
  const step = round.step;
  if (step.kind !== 'holding') reject('WRONG_PHASE', 'not holding a drawn card');
  return { round, card: step.card, source: step.source };
}

function requireDeckAbility(state: GameState, actor: PlayerId, ability: 'peek' | 'spy' | 'swap') {
  const held = requireHolding(state, actor);
  if (held.source !== 'deck') reject('ILLEGAL_ACTION', 'abilities only work on cards drawn from the draw pile');
  if (abilityForValue(held.card.value) !== ability) reject('ILLEGAL_ACTION', `held card has no ${ability} ability`);
  return held;
}

function requireOpponentSlot(state: GameState, actor: PlayerId, target: SlotRef): Card {
  if (target.playerId === actor) reject('INVALID_TARGET', 'target must belong to another player');
  if (!state.players.includes(target.playerId)) reject('INVALID_TARGET', 'unknown target player');
  return occupiedCard(handOf(state.round, target.playerId), target.slot);
}

function reshuffleIfNeeded(round: RoundState, rng: Rng, sink: EventSink): void {
  if (round.drawPile.length > 0) return;
  const top = round.discardPile.pop();
  if (!top) throw new Error('No cards available to reshuffle');
  const rest = round.discardPile;
  shuffleInPlace(rest, rng);
  round.drawPile = rest;
  round.discardPile = [top];
  sink.all({ type: 'deckReshuffled', drawPileCount: round.drawPile.length });
}

/** Ends the current player's turn: advances the turn or ends the round after the final turns. */
function endTurn(state: GameState, sink: EventSink, isCaboCall: boolean): void {
  const round = state.round;
  if (round.caboCaller !== null && !isCaboCall) {
    round.finalTurnsRemaining = (round.finalTurnsRemaining ?? 0) - 1;
    if (round.finalTurnsRemaining <= 0) {
      round.finalTurnsRemaining = 0;
      endRound(state, sink);
      return;
    }
  }
  round.currentPlayer = nextPlayer(state.players, round.currentPlayer);
  round.step = { kind: 'awaitingAction' };
  sink.all({ type: 'turnStarted', player: round.currentPlayer });
}

function endRound(state: GameState, sink: EventSink): void {
  const round = state.round;
  round.phase = 'complete';
  round.step = { kind: 'awaitingAction' };
  const values: Record<PlayerId, (CardValue | null)[]> = {};
  for (const p of state.players) values[p] = handOf(round, p).map((c) => (c ? c.value : null));

  const scoring = scoreRound({ players: state.players, hands: values, caboCaller: round.caboCaller });
  const players: RoundPlayerResult[] = state.players.map((p) => {
    const current = state.scores[p] as PlayerScore;
    const isWinner = scoring.winners.includes(p);
    const roundScore = scoring.roundScores[p] as number;
    const update = applyRoundScore(current, roundScore, isWinner, state.config.mode);
    state.scores[p] = update.after;
    return {
      playerId: p,
      hand: values[p] as (CardValue | null)[],
      handTotal: scoring.handTotals[p] as number,
      roundScore,
      isWinner,
      calledCabo: round.caboCaller === p,
      caboPenaltyApplied: scoring.caboPenaltyApplied && round.caboCaller === p,
      shotTheMoon: scoring.moonShooter === p,
      moonPenaltyApplied: scoring.moonShooter !== null && scoring.moonShooter !== p,
      totalBefore: update.before.total,
      totalAfter: update.after.total,
      resetApplied: update.resetApplied,
      roundWinsAfter: update.after.roundWins,
    };
  });
  const result: RoundResultView = {
    roundNumber: round.number,
    caboCaller: round.caboCaller,
    moonShooter: scoring.moonShooter,
    winners: scoring.winners,
    players,
  };
  state.roundResults.push(result);
  sink.all({ type: 'roundEnded', result });

  const gameResult = evaluateGameEnd({
    mode: state.config.mode,
    players: state.players,
    scores: state.scores,
    roundsPlayed: state.roundResults.length,
  });
  if (gameResult) {
    state.phase = 'gameComplete';
    state.result = gameResult;
    sink.all({ type: 'gameEnded', result: gameResult });
  } else {
    state.phase = 'roundComplete';
  }
}

// ---------------------------------------------------------------------------
// Action handlers (each mutates the draft or throws EngineRejection)
// ---------------------------------------------------------------------------

function inspect(state: GameState, actor: PlayerId, slots: readonly SlotIndex[], sink: EventSink): void {
  if (state.phase !== 'round' || state.round.phase !== 'initialInspection') reject('WRONG_PHASE', 'not in initial inspection');
  const round = state.round;
  const own = round.inspection[actor];
  if (!own) reject('ILLEGAL_ACTION', 'actor is not seated');
  if (own.peeked !== null) reject('ALREADY_DONE', 'initial inspection already used');
  if (slots.length !== INITIAL_PEEK_COUNT || new Set(slots).size !== slots.length) {
    reject('INVALID_TARGET', 'choose two different slots');
  }
  const hand = handOf(round, actor);
  const cards = slots.map((slot) => ({ slot, value: occupiedCard(hand, slot).value }));
  own.peeked = [...slots];
  sink.to(actor, { type: 'initialPeek', cards });
}

function finishInspection(state: GameState, actor: PlayerId, sink: EventSink): void {
  if (state.phase !== 'round' || state.round.phase !== 'initialInspection') reject('WRONG_PHASE', 'not in initial inspection');
  const round = state.round;
  const own = round.inspection[actor];
  if (!own) reject('ILLEGAL_ACTION', 'actor is not seated');
  if (own.done) reject('ALREADY_DONE', 'inspection already finished');
  if (own.peeked === null) reject('ILLEGAL_ACTION', 'look at two cards first');
  own.done = true;
  sink.all({ type: 'inspectionFinished', player: actor });
  if (state.players.every((p) => round.inspection[p]?.done)) {
    round.phase = 'turns';
    round.currentPlayer = round.startingPlayer;
    round.step = { kind: 'awaitingAction' };
    sink.all({ type: 'turnStarted', player: round.currentPlayer });
  }
}

function drawFromDeck(state: GameState, actor: PlayerId, sink: EventSink, rng: Rng): void {
  const round = requireAwaiting(state, actor);
  reshuffleIfNeeded(round, rng, sink);
  const card = round.drawPile.pop();
  if (!card) throw new Error('Draw pile empty after reshuffle');
  round.step = { kind: 'holding', card, source: 'deck' };
  sink.all({ type: 'drewFromDeck', player: actor });
  sink.to(actor, { type: 'drawnCard', value: card.value });
}

function takeDiscard(state: GameState, actor: PlayerId, sink: EventSink): void {
  const round = requireAwaiting(state, actor);
  const card = round.discardPile.pop();
  if (!card) reject('ILLEGAL_ACTION', 'discard pile is empty');
  round.step = { kind: 'holding', card, source: 'discard' };
  sink.all({ type: 'tookDiscard', player: actor, value: card.value });
}

function callCabo(state: GameState, actor: PlayerId, sink: EventSink): void {
  const round = requireAwaiting(state, actor);
  if (round.caboCaller !== null) reject('ILLEGAL_ACTION', 'Cabo has already been called this round');
  round.caboCaller = actor;
  round.finalTurnsRemaining = state.players.length - 1;
  sink.all({ type: 'caboCalled', player: actor, finalTurns: round.finalTurnsRemaining });
  endTurn(state, sink, true);
}

function replace(state: GameState, actor: PlayerId, slot: SlotIndex, sink: EventSink): void {
  const { round, card, source } = requireHolding(state, actor);
  const hand = handOf(round, actor);
  const old = occupiedCard(hand, slot);
  hand[slot] = card;
  round.discardPile.push(old);
  sink.all({
    type: 'replaced',
    player: actor,
    slot,
    source,
    discardedValue: old.value,
    placedValue: source === 'discard' ? card.value : null,
  });
  endTurn(state, sink, false);
}

function discardDrawn(state: GameState, actor: PlayerId, sink: EventSink): void {
  const { round, card, source } = requireHolding(state, actor);
  if (source !== 'deck') reject('ILLEGAL_ACTION', 'a card taken from the discard pile must be used');
  round.discardPile.push(card);
  sink.all({ type: 'discardedDrawn', player: actor, value: card.value });
  endTurn(state, sink, false);
}

function match(state: GameState, actor: PlayerId, slots: readonly SlotIndex[], sink: EventSink): void {
  const { round, card, source } = requireHolding(state, actor);
  if (slots.length < 2 || slots.length > HAND_SIZE || new Set(slots).size !== slots.length) {
    reject('INVALID_TARGET', 'choose two to four different slots');
  }
  const hand = handOf(round, actor);
  const selected = slots.map((slot) => ({ slot, card: occupiedCard(hand, slot) }));
  const firstValue = (selected[0] as { card: Card }).card.value;
  const success = selected.every((s) => s.card.value === firstValue);
  if (success) {
    for (const s of selected) {
      round.discardPile.push(s.card);
      hand[s.slot] = null;
    }
    const keptSlot = slots[0] as SlotIndex;
    hand[keptSlot] = card;
    sink.all({
      type: 'matchSucceeded',
      player: actor,
      slots: [...slots],
      value: firstValue,
      keptSlot,
      source,
      placedValue: source === 'discard' ? card.value : null,
    });
  } else {
    round.discardPile.push(card);
    sink.all({
      type: 'matchFailed',
      player: actor,
      revealed: selected.map((s) => ({ slot: s.slot, value: s.card.value })),
      discardedValue: card.value,
    });
  }
  endTurn(state, sink, false);
}

function useInspectAbility(
  state: GameState,
  actor: PlayerId,
  ability: 'peek' | 'spy',
  target: SlotRef,
  sink: EventSink,
): void {
  const { round, card } = requireDeckAbility(state, actor, ability);
  const seen =
    ability === 'peek' ? occupiedCard(handOf(round, actor), target.slot) : requireOpponentSlot(state, actor, target);
  round.discardPile.push(card);
  round.step = { kind: 'viewing', ability, target: { playerId: target.playerId, slot: target.slot } };
  sink.all({ type: 'discardedDrawn', player: actor, value: card.value });
  sink.all({ type: 'inspected', player: actor, ability, target: { playerId: target.playerId, slot: target.slot } });
  sink.to(actor, { type: 'revealed', ability, target: { playerId: target.playerId, slot: target.slot }, value: seen.value });
}

function acknowledgeReveal(state: GameState, actor: PlayerId, sink: EventSink): void {
  const round = requireTurn(state, actor);
  if (round.step.kind !== 'viewing') reject('WRONG_PHASE', 'nothing is being viewed');
  sink.all({ type: 'revealEnded', player: actor });
  endTurn(state, sink, false);
}

function useSwap(state: GameState, actor: PlayerId, ownSlot: SlotIndex, target: SlotRef, sink: EventSink): void {
  const { round, card } = requireDeckAbility(state, actor, 'swap');
  const ownHand = handOf(round, actor);
  const ownCard = occupiedCard(ownHand, ownSlot);
  const otherCard = requireOpponentSlot(state, actor, target);
  const otherHand = handOf(round, target.playerId);
  ownHand[ownSlot] = otherCard;
  otherHand[target.slot] = ownCard;
  round.discardPile.push(card);
  sink.all({ type: 'discardedDrawn', player: actor, value: card.value });
  sink.all({
    type: 'swapped',
    player: actor,
    own: { playerId: actor, slot: ownSlot },
    other: { playerId: target.playerId, slot: target.slot },
  });
  endTurn(state, sink, false);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Applies one player's action. Atomic: on rejection the input state is
 * untouched; on success a new state is returned together with routed events.
 */
export function applyAction(state: GameState, actor: PlayerId, input: GameAction, deps: EngineDeps): TransitionResult {
  // Defence in depth: the server validates first, but the engine never trusts its input.
  const parsed = gameActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: 'ILLEGAL_ACTION', detail: 'malformed action' } };
  const action = parsed.data;
  const draft = cloneState(state);
  const sink = new EventSink();
  try {
    requirePlayer(draft, actor);
    switch (action.type) {
      case 'inspect':
        inspect(draft, actor, action.slots, sink);
        break;
      case 'finishInspection':
        finishInspection(draft, actor, sink);
        break;
      case 'drawFromDeck':
        drawFromDeck(draft, actor, sink, deps.rng);
        break;
      case 'takeDiscard':
        takeDiscard(draft, actor, sink);
        break;
      case 'callCabo':
        callCabo(draft, actor, sink);
        break;
      case 'replace':
        replace(draft, actor, action.slot, sink);
        break;
      case 'discardDrawn':
        discardDrawn(draft, actor, sink);
        break;
      case 'match':
        match(draft, actor, action.slots, sink);
        break;
      case 'usePeek':
        useInspectAbility(draft, actor, 'peek', { playerId: actor, slot: action.slot }, sink);
        break;
      case 'useSpy':
        useInspectAbility(draft, actor, 'spy', action.target, sink);
        break;
      case 'useSwap':
        useSwap(draft, actor, action.ownSlot, action.target, sink);
        break;
      case 'acknowledgeReveal':
        acknowledgeReveal(draft, actor, sink);
        break;
      default: {
        const unreachable: never = action;
        reject('ILLEGAL_ACTION', `unknown action ${(unreachable as { type: string }).type}`);
      }
    }
  } catch (err) {
    if (err instanceof EngineRejection) return { ok: false, error: { code: err.code, detail: err.detail } };
    throw err;
  }
  return { ok: true, state: draft, events: sink.events };
}

/** Players whose input the game is currently waiting for. */
export function playersToAct(state: GameState): PlayerId[] {
  if (state.phase !== 'round') return [];
  const round = state.round;
  if (round.phase === 'initialInspection') return state.players.filter((p) => !round.inspection[p]?.done);
  if (round.phase === 'turns') return [round.currentPlayer];
  return [];
}

export function topDiscard(state: GameState): Card | undefined {
  return topOf(state.round.discardPile);
}
