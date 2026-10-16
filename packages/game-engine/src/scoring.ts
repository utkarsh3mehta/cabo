import {
  QUICK_GAME_ROUNDS,
  SCORING,
  type CardValue,
  type GameMode,
  type GameResultView,
  type PlayerId,
  type StandingView,
} from '@cabo/shared';

export interface RoundScoringInput {
  /** Seat order. */
  players: readonly PlayerId[];
  /** Remaining card values per player (empty slots omitted or null). */
  hands: Readonly<Record<PlayerId, readonly (CardValue | null)[]>>;
  caboCaller: PlayerId | null;
}

export interface RoundScoringOutput {
  handTotals: Record<PlayerId, number>;
  roundScores: Record<PlayerId, number>;
  winners: PlayerId[];
  moonShooter: PlayerId | null;
  /** True when the caller missed the lowest total and received the +5 penalty. */
  caboPenaltyApplied: boolean;
}

function cardsOf(hand: readonly (CardValue | null)[]): CardValue[] {
  return hand.filter((v): v is CardValue => v !== null);
}

/** Shooting the Moon: the remaining cards are exactly two 12s and two 13s. */
export function isMoonHand(hand: readonly (CardValue | null)[]): boolean {
  const cards = cardsOf(hand);
  if (cards.length !== 4) return false;
  const twelves = cards.filter((v) => v === 12).length;
  const thirteens = cards.filter((v) => v === 13).length;
  return twelves === 2 && thirteens === 2;
}

/**
 * Scores one round according to the publisher's standard rules
 * (RULES_SPECIFICATION.md §7.2). Pure and deterministic.
 */
export function scoreRound(input: RoundScoringInput): RoundScoringOutput {
  const { players, hands, caboCaller } = input;
  const handTotals: Record<PlayerId, number> = {};
  for (const p of players) {
    const hand = hands[p];
    if (!hand) throw new Error(`Missing hand for ${p}`);
    handTotals[p] = cardsOf(hand).reduce<number>((sum, v) => sum + v, 0);
  }

  const moonShooter = players.find((p) => isMoonHand(hands[p] ?? [])) ?? null;
  if (moonShooter !== null) {
    const roundScores: Record<PlayerId, number> = {};
    for (const p of players) roundScores[p] = p === moonShooter ? 0 : SCORING.moonPenaltyForOthers;
    return { handTotals, roundScores, winners: [moonShooter], moonShooter, caboPenaltyApplied: false };
  }

  const lowest = Math.min(...players.map((p) => handTotals[p] as number));
  const lowestPlayers = players.filter((p) => handTotals[p] === lowest);
  const callerIsLowest = caboCaller !== null && lowestPlayers.includes(caboCaller);
  const winners = callerIsLowest ? [caboCaller] : lowestPlayers;

  const roundScores: Record<PlayerId, number> = {};
  let caboPenaltyApplied = false;
  for (const p of players) {
    const total = handTotals[p] as number;
    if (winners.includes(p)) {
      roundScores[p] = 0;
    } else if (p === caboCaller) {
      roundScores[p] = total + SCORING.failedCaboPenalty;
      caboPenaltyApplied = true;
    } else {
      roundScores[p] = total;
    }
  }
  return { handTotals, roundScores, winners, moonShooter: null, caboPenaltyApplied };
}

export interface CumulativeScore {
  total: number;
  resetUsed: boolean;
  roundWins: number;
}

export interface CumulativeUpdate {
  before: CumulativeScore;
  after: CumulativeScore;
  resetApplied: boolean;
}

/**
 * Adds one round's score to a player's running score. In full games a total
 * of exactly 100 drops to 50, once per player per game (§7.4).
 */
export function applyRoundScore(
  current: CumulativeScore,
  roundScore: number,
  isWinner: boolean,
  mode: GameMode,
): CumulativeUpdate {
  let total = current.total + roundScore;
  let resetUsed = current.resetUsed;
  let resetApplied = false;
  if (mode === 'full' && total === SCORING.resetTrigger && !resetUsed) {
    total = SCORING.resetTo;
    resetUsed = true;
    resetApplied = true;
  }
  return {
    before: { ...current },
    after: { total, resetUsed, roundWins: current.roundWins + (isWinner ? 1 : 0) },
    resetApplied,
  };
}

export interface GameEndInput {
  mode: GameMode;
  players: readonly PlayerId[];
  scores: Readonly<Record<PlayerId, CumulativeScore>>;
  roundsPlayed: number;
}

/** Ranks players with standard competition ranking (1, 1, 3). */
function rankStandings(
  players: readonly PlayerId[],
  scores: Readonly<Record<PlayerId, CumulativeScore>>,
  compare: (a: CumulativeScore, b: CumulativeScore) => number,
): StandingView[] {
  const sorted = [...players].sort((a, b) => {
    const cmp = compare(scores[a] as CumulativeScore, scores[b] as CumulativeScore);
    return cmp !== 0 ? cmp : players.indexOf(a) - players.indexOf(b);
  });
  const standings: StandingView[] = [];
  sorted.forEach((p, i) => {
    const s = scores[p] as CumulativeScore;
    const prev = standings[i - 1];
    const prevScore = i > 0 ? (scores[sorted[i - 1] as PlayerId] as CumulativeScore) : null;
    const rank = prev && prevScore && compare(prevScore, s) === 0 ? prev.rank : i + 1;
    standings.push({ playerId: p, rank, total: s.total, roundWins: s.roundWins, isWinner: rank === 1 });
  });
  return standings;
}

const fullOrder = (a: CumulativeScore, b: CumulativeScore) => a.total - b.total;
const quickOrder = (a: CumulativeScore, b: CumulativeScore) => b.roundWins - a.roundWins || a.total - b.total;

/** True when one player's round-win lead can no longer be caught. */
export function isQuickGameClinched(
  players: readonly PlayerId[],
  scores: Readonly<Record<PlayerId, CumulativeScore>>,
  roundsPlayed: number,
): boolean {
  const remaining = Math.max(0, QUICK_GAME_ROUNDS - roundsPlayed);
  return players.some((leader) => {
    const leaderWins = (scores[leader] as CumulativeScore).roundWins;
    return players.every((p) => p === leader || (scores[p] as CumulativeScore).roundWins + remaining < leaderWins);
  });
}

/**
 * Decides whether the game is over and, if so, who won (§9).
 * Returns null while the game continues.
 */
export function evaluateGameEnd(input: GameEndInput): GameResultView | null {
  const { mode, players, scores, roundsPlayed } = input;
  let over: boolean;
  if (mode === 'full') {
    over = players.some((p) => (scores[p] as CumulativeScore).total > SCORING.gameEndThreshold);
  } else {
    over = roundsPlayed >= QUICK_GAME_ROUNDS || isQuickGameClinched(players, scores, roundsPlayed);
  }
  if (!over) return null;
  const standings = rankStandings(players, scores, mode === 'full' ? fullOrder : quickOrder);
  return {
    mode,
    winners: standings.filter((s) => s.isWinner).map((s) => s.playerId),
    standings,
    roundsPlayed,
  };
}

/**
 * The previous round's winner starts the next round. With several winners,
 * the first of them clockwise from the previous starter (inclusive) starts.
 */
export function pickNextStarter(
  players: readonly PlayerId[],
  previousStarter: PlayerId,
  winners: readonly PlayerId[],
): PlayerId {
  const startIndex = Math.max(0, players.indexOf(previousStarter));
  for (let offset = 0; offset < players.length; offset++) {
    const candidate = players[(startIndex + offset) % players.length] as PlayerId;
    if (winners.includes(candidate)) return candidate;
  }
  return previousStarter;
}
