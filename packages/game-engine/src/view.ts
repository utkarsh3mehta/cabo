import {
  NO_LEGAL_ACTIONS,
  QUICK_GAME_ROUNDS,
  SLOT_INDICES,
  abilityForValue,
  type GameView,
  type LegalActions,
  type PlayerId,
  type RoundHistoryEntry,
  type RoundView,
  type SlotIndex,
  type SlotView,
  type TableSeatView,
  type TurnStepView,
} from '@cabo/shared';
import type { GameState, Hand, RoundState } from './state.js';

/**
 * Whether `viewer` may currently see the card in `owner`'s `slot`.
 * This is the single rule that decides every face-down card's visibility.
 */
export function canSee(state: GameState, viewer: PlayerId, owner: PlayerId, slot: SlotIndex): boolean {
  const round = state.round;
  if (round.phase === 'complete') return true;
  if (round.phase === 'initialInspection') {
    const own = round.inspection[viewer];
    return owner === viewer && !!own && !own.done && !!own.peeked?.includes(slot);
  }
  const step = round.step;
  return (
    step.kind === 'viewing' &&
    round.currentPlayer === viewer &&
    step.target.playerId === owner &&
    step.target.slot === slot
  );
}

function seatView(state: GameState, viewer: PlayerId, owner: PlayerId): TableSeatView {
  const round = state.round;
  const hand: Hand = round.hands[owner] ?? [];
  const slots: SlotView[] = SLOT_INDICES.map((index) => {
    const card = hand[index] ?? null;
    const view: SlotView = { index, occupied: card !== null };
    if (card && canSee(state, viewer, owner, index)) view.value = card.value;
    return view;
  });
  return {
    playerId: owner,
    slots,
    cardCount: hand.filter((c) => c !== null).length,
    inspectionDone: round.inspection[owner]?.done ?? false,
  };
}

function stepView(round: RoundState, viewer: PlayerId): TurnStepView | null {
  if (round.phase !== 'turns') return null;
  const step = round.step;
  const isActor = round.currentPlayer === viewer;
  switch (step.kind) {
    case 'awaitingAction':
      return { kind: 'awaitingAction' };
    case 'holding': {
      const visible = isActor || step.source === 'discard';
      const view: TurnStepView = {
        kind: 'holding',
        source: step.source,
        // Revealing the ability would reveal the value range, so only the holder sees it.
        ability: isActor && step.source === 'deck' ? abilityForValue(step.card.value) : null,
      };
      if (visible) view.value = step.card.value;
      return view;
    }
    case 'viewing': {
      const view: TurnStepView = { kind: 'viewing', ability: step.ability, target: { ...step.target } };
      if (isActor) {
        const card = round.hands[step.target.playerId]?.[step.target.slot];
        if (card) view.value = card.value;
      }
      return view;
    }
  }
}

export function getLegalActions(state: GameState, viewer: PlayerId): LegalActions {
  if (state.phase !== 'round' || !state.players.includes(viewer)) return { ...NO_LEGAL_ACTIONS, replaceSlots: [] };
  const round = state.round;
  const legal: LegalActions = { ...NO_LEGAL_ACTIONS, replaceSlots: [] };

  if (round.phase === 'initialInspection') {
    const own = round.inspection[viewer];
    legal.inspect = !!own && own.peeked === null;
    legal.finishInspection = !!own && own.peeked !== null && !own.done;
    return legal;
  }
  if (round.phase !== 'turns' || round.currentPlayer !== viewer) return legal;

  const step = round.step;
  const hand = round.hands[viewer] ?? [];
  const occupied = SLOT_INDICES.filter((i) => hand[i]);
  switch (step.kind) {
    case 'awaitingAction':
      legal.drawFromDeck = true;
      legal.takeDiscard = round.discardPile.length > 0;
      legal.callCabo = round.caboCaller === null;
      break;
    case 'holding':
      legal.replaceSlots = occupied;
      legal.match = occupied.length >= 2;
      legal.discardDrawn = step.source === 'deck';
      legal.ability = step.source === 'deck' ? abilityForValue(step.card.value) : null;
      break;
    case 'viewing':
      legal.acknowledgeReveal = true;
      break;
  }
  return legal;
}

function roundView(state: GameState, viewer: PlayerId): RoundView {
  const round = state.round;
  const own = round.inspection[viewer];
  return {
    number: round.number,
    phase: round.phase,
    startingPlayer: round.startingPlayer,
    activePlayer: round.phase === 'turns' ? round.currentPlayer : null,
    step: stepView(round, viewer),
    caboCaller: round.caboCaller,
    finalTurnsRemaining: round.finalTurnsRemaining,
    drawPileCount: round.drawPile.length,
    discardTop: round.discardPile[round.discardPile.length - 1]?.value ?? null,
    discardCount: round.discardPile.length,
    table: state.players.map((p) => seatView(state, viewer, p)),
    myInspection:
      own && round.phase === 'initialInspection' ? { peeked: own.peeked ? [...own.peeked] : null, done: own.done } : null,
  };
}

/**
 * Projects the full game state into what one viewer may know. Every snapshot
 * sent to a browser or handed to a bot is produced here.
 */
export function getPlayerView(state: GameState, viewer: PlayerId): GameView {
  const history: RoundHistoryEntry[] = state.roundResults.map((r) => ({
    roundNumber: r.roundNumber,
    winners: [...r.winners],
    scores: Object.fromEntries(r.players.map((p) => [p.playerId, p.roundScore])),
  }));
  return {
    mode: state.config.mode,
    phase: state.phase,
    players: [...state.players],
    scores: state.players.map((p) => {
      const s = state.scores[p];
      return { playerId: p, total: s?.total ?? 0, resetUsed: s?.resetUsed ?? false, roundWins: s?.roundWins ?? 0 };
    }),
    round: roundView(state, viewer),
    lastRoundResult: state.roundResults[state.roundResults.length - 1] ?? null,
    history,
    result: state.result,
    quickRounds: state.config.mode === 'quick' ? QUICK_GAME_ROUNDS : null,
    viewer,
    legal: getLegalActions(state, viewer),
  };
}
