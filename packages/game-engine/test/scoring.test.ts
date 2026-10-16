import type { CardValue } from '@cabo/shared';
import { describe, expect, it } from 'vitest';
import {
  applyRoundScore,
  evaluateGameEnd,
  isMoonHand,
  isQuickGameClinched,
  pickNextStarter,
  scoreRound,
  startNextRound,
  type CumulativeScore,
} from '../src/index.js';
import { act, newGame, rig, rng } from './helpers.js';

const P = ['a', 'b', 'c'];
const score = (hands: Record<string, (CardValue | null)[]>, caboCaller: string | null = null, players = Object.keys(hands)) =>
  scoreRound({ players, hands, caboCaller });

describe('round scoring', () => {
  it('gives the lowest total 0 and everyone else their hand total', () => {
    const r = score({ a: [1, 2, 3, 4], b: [0, 0, 1, 2], c: [9, 9, 9, 9] }, null);
    expect(r.handTotals).toEqual({ a: 10, b: 3, c: 36 });
    expect(r.roundScores).toEqual({ a: 10, b: 0, c: 36 });
    expect(r.winners).toEqual(['b']);
  });

  it('a successful caller scores 0 without penalty', () => {
    const r = score({ a: [1, 1, 1, null], b: [5, 5, 5, 5], c: [2, 2, 2, 2] }, 'a');
    expect(r.roundScores).toEqual({ a: 0, b: 20, c: 8 });
    expect(r.caboPenaltyApplied).toBe(false);
  });

  it('an unsuccessful caller scores hand + 5 and the lowest player scores 0', () => {
    const r = score({ a: [3, 3, 3, 3], b: [1, 1, 1, 1], c: [2, 2, 2, 2] }, 'a');
    expect(r.roundScores).toEqual({ a: 17, b: 0, c: 8 });
    expect(r.winners).toEqual(['b']);
    expect(r.caboPenaltyApplied).toBe(true);
  });

  it('the caller wins a tie for lowest; the other tied player scores their total', () => {
    const r = score({ a: [2, 2, 2, 2], b: [4, 4, null, null], c: [9, 9, 9, 9] }, 'a');
    expect(r.handTotals.a).toBe(8);
    expect(r.handTotals.b).toBe(8);
    expect(r.roundScores).toEqual({ a: 0, b: 8, c: 36 });
    expect(r.winners).toEqual(['a']);
  });

  it('players tied for lowest without the caller all score 0 and the caller is penalised', () => {
    const r = score({ a: [5, 5, 5, 5], b: [1, 2, null, null], c: [3, null, null, null] }, 'a');
    expect(r.roundScores).toEqual({ a: 25, b: 0, c: 0 });
    expect(r.winners).toEqual(['b', 'c']);
  });

  it('a three-way tie including the caller: only the caller scores 0', () => {
    const r = score({ a: [3], b: [3], c: [1, 2] }, 'b');
    expect(r.roundScores).toEqual({ a: 3, b: 0, c: 3 });
    expect(r.winners).toEqual(['b']);
  });

  it('caller and another player both at 0: caller wins, the other still scores 0 points', () => {
    const r = score({ a: [0, 0], b: [0], c: [5] }, 'a');
    expect(r.roundScores).toEqual({ a: 0, b: 0, c: 5 });
    expect(r.winners).toEqual(['a']);
  });

  it('Shooting the Moon: 0 for the shooter, 50 for everyone else, whoever called Cabo', () => {
    const r = score({ a: [1, 1, 1, 1], b: [12, 13, 12, 13], c: [0, 0, 2, 2] }, 'a');
    expect(r.moonShooter).toBe('b');
    expect(r.roundScores).toEqual({ a: 50, b: 0, c: 50 });
    expect(r.winners).toEqual(['b']);
    expect(r.caboPenaltyApplied).toBe(false);
  });

  it('Shooting the Moon also works when the shooter called Cabo', () => {
    const r = score({ a: [13, 12, 13, 12], b: [0, 0, 1, 1] }, 'a');
    expect(r.roundScores).toEqual({ a: 0, b: 50 });
  });

  it('recognises only exactly two 12s and two 13s', () => {
    expect(isMoonHand([12, 12, 13, 13])).toBe(true);
    expect(isMoonHand([13, 12, 13, 12])).toBe(true);
    expect(isMoonHand([12, 13, 13, null])).toBe(false);
    expect(isMoonHand([12, 12, 12, 13])).toBe(false);
    expect(isMoonHand([11, 12, 13, 13])).toBe(false);
  });
});

describe('cumulative scores and the 100 reset', () => {
  const s = (total: number, resetUsed = false): CumulativeScore => ({ total, resetUsed, roundWins: 0 });

  it('drops exactly 100 to 50 once per game', () => {
    const first = applyRoundScore(s(90), 10, false, 'full');
    expect(first.after).toEqual({ total: 50, resetUsed: true, roundWins: 0 });
    expect(first.resetApplied).toBe(true);
    const second = applyRoundScore(first.after, 50, false, 'full');
    expect(second.after.total).toBe(100);
    expect(second.resetApplied).toBe(false);
  });

  it('does not reset at 99 or 101', () => {
    expect(applyRoundScore(s(90), 9, false, 'full').after.total).toBe(99);
    expect(applyRoundScore(s(90), 11, false, 'full').after.total).toBe(101);
  });

  it('applies to a 50-point moon penalty landing on 100', () => {
    expect(applyRoundScore(s(50), 50, false, 'full').after.total).toBe(50);
  });

  it('does not reset in quick games', () => {
    expect(applyRoundScore(s(50), 50, false, 'quick').after.total).toBe(100);
  });

  it('counts round wins', () => {
    expect(applyRoundScore(s(0), 0, true, 'quick').after.roundWins).toBe(1);
  });
});

describe('game end', () => {
  const scores = (entries: Record<string, [number, number?]>) =>
    Object.fromEntries(Object.entries(entries).map(([p, [total, wins]]) => [p, { total, resetUsed: false, roundWins: wins ?? 0 }]));

  it('full game continues at exactly 100 and ends above 100', () => {
    expect(evaluateGameEnd({ mode: 'full', players: P, scores: scores({ a: [100], b: [20], c: [99] }), roundsPlayed: 7 })).toBeNull();
    const r = evaluateGameEnd({ mode: 'full', players: P, scores: scores({ a: [101], b: [20], c: [35] }), roundsPlayed: 7 });
    expect(r?.winners).toEqual(['b']);
    expect(r?.standings.map((x) => [x.playerId, x.rank])).toEqual([['b', 1], ['c', 2], ['a', 3]]);
  });

  it('full game ties for the lowest total share the win', () => {
    const r = evaluateGameEnd({ mode: 'full', players: P, scores: scores({ a: [40], b: [104], c: [40] }), roundsPlayed: 9 });
    expect(r?.winners).toEqual(['a', 'c']);
    expect(r?.standings.map((x) => x.rank)).toEqual([1, 1, 3]);
  });

  it('quick game ends after three rounds; most round wins, then fewest points', () => {
    expect(evaluateGameEnd({ mode: 'quick', players: P, scores: scores({ a: [10, 1], b: [5, 1], c: [30, 0] }), roundsPlayed: 2 })).toBeNull();
    const r = evaluateGameEnd({ mode: 'quick', players: P, scores: scores({ a: [10, 1], b: [25, 1], c: [30, 1] }), roundsPlayed: 3 });
    expect(r?.winners).toEqual(['a']);
    const shared = evaluateGameEnd({ mode: 'quick', players: P, scores: scores({ a: [10, 1], b: [10, 1], c: [0, 1] }), roundsPlayed: 3 });
    expect(shared?.winners).toEqual(['c']);
    const tie = evaluateGameEnd({ mode: 'quick', players: ['a', 'b'], scores: scores({ a: [12, 1], b: [12, 1] }), roundsPlayed: 3 });
    expect(tie?.winners).toEqual(['a', 'b']);
  });

  it('quick game ends early once a player has clinched', () => {
    expect(isQuickGameClinched(P, scores({ a: [0, 2], b: [9, 0], c: [9, 0] }), 2)).toBe(true);
    expect(isQuickGameClinched(P, scores({ a: [0, 2], b: [9, 1], c: [9, 0] }), 2)).toBe(false);
    expect(isQuickGameClinched(P, scores({ a: [0, 1], b: [9, 0], c: [9, 0] }), 1)).toBe(false);
    const r = evaluateGameEnd({ mode: 'quick', players: P, scores: scores({ a: [0, 2], b: [9, 0], c: [9, 0] }), roundsPlayed: 2 });
    expect(r?.winners).toEqual(['a']);
    expect(r?.roundsPlayed).toBe(2);
  });

  it('quick game ignores the 100-point threshold', () => {
    expect(evaluateGameEnd({ mode: 'quick', players: P, scores: scores({ a: [150, 0], b: [0, 1], c: [100, 0] }), roundsPlayed: 1 })).toBeNull();
  });
});

describe('next-round starter', () => {
  it('is the previous round winner', () => {
    expect(pickNextStarter(['a', 'b', 'c', 'd'], 'a', ['c'])).toBe('c');
  });
  it('is the first winner clockwise from the previous starter, inclusive', () => {
    expect(pickNextStarter(['a', 'b', 'c', 'd'], 'c', ['a', 'd'])).toBe('d');
    expect(pickNextStarter(['a', 'b', 'c', 'd'], 'c', ['c', 'a'])).toBe('c');
  });
});

describe('round and game lifecycle', () => {
  const playRoundWithCabo = (hands: Record<string, (CardValue | null)[]>, start: number[] = [], caller = 'a') => {
    let s = rig(newGame(['a', 'b'], 'full', 11), { hands, drawTop: [5, 5], currentPlayer: caller });
    s = { ...s, scores: { a: { total: start[0] ?? 0, resetUsed: false, roundWins: 0 }, b: { total: start[1] ?? 0, resetUsed: false, roundWins: 0 } } };
    s = act(s, caller, { type: 'callCabo' });
    const other = caller === 'a' ? 'b' : 'a';
    s = act(s, other, { type: 'drawFromDeck' });
    s = act(s, other, { type: 'discardDrawn' });
    return s;
  };

  it('records results, accumulates scores and starts the next round with the winner', () => {
    const s = playRoundWithCabo({ a: [9, 9, 9, 9], b: [0, 1, 1, 1] });
    expect(s.phase).toBe('roundComplete');
    const result = s.roundResults[0]!;
    expect(result.winners).toEqual(['b']);
    expect(result.players.find((p) => p.playerId === 'a')).toMatchObject({ roundScore: 41, caboPenaltyApplied: true, totalAfter: 41 });
    expect(s.scores.a!.total).toBe(41);

    const next = startNextRound(s, { rng: rng(4) });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.state.round.number).toBe(2);
    expect(next.state.round.startingPlayer).toBe('b');
    expect(next.state.round.phase).toBe('initialInspection');
    expect(next.state.scores.a!.total).toBe(41);
  });

  it('cannot start a new round while a round is in progress', () => {
    const s = newGame(['a', 'b']);
    const r = startNextRound(s, { rng: rng() });
    expect(r.ok).toBe(false);
  });

  it('ends a full game when a total exceeds 100 and applies the reset first', () => {
    const over = playRoundWithCabo({ a: [0, 1, 1, 1], b: [3, 3, 3, 3] }, [10, 90]);
    expect(over.scores.b!.total).toBe(102);
    expect(over.phase).toBe('gameComplete');
    expect(over.result?.winners).toEqual(['a']);
    expect(startNextRound(over, { rng: rng() }).ok).toBe(false);

    const reset = playRoundWithCabo({ a: [0, 1, 1, 1], b: [2, 3, 2, 3] }, [10, 90]);
    expect(reset.scores.b).toEqual({ total: 50, resetUsed: true, roundWins: 0 });
    expect(reset.phase).toBe('roundComplete');
    expect(reset.roundResults[0]!.players.find((p) => p.playerId === 'b')!.resetApplied).toBe(true);
  });

  it('runs a quick game for at most three rounds', () => {
    let s = newGame(['a', 'b'], 'quick', 21);
    let rounds = 0;
    while (s.phase !== 'gameComplete' && rounds < 5) {
      s = rig(s, { hands: { a: [0, 0, 1, 1], b: [9, 9, 9, 9] }, drawTop: [4], currentPlayer: 'a' });
      s = act(s, 'a', { type: 'callCabo' });
      s = act(s, 'b', { type: 'drawFromDeck' });
      s = act(s, 'b', { type: 'discardDrawn' });
      rounds++;
      if (s.phase === 'roundComplete') {
        const n = startNextRound(s, { rng: rng(rounds) });
        if (!n.ok) throw new Error('next round failed');
        s = n.state;
      }
    }
    // a wins rounds 1 and 2, which clinches the best of three.
    expect(rounds).toBe(2);
    expect(s.result?.winners).toEqual(['a']);
    expect(s.result?.standings[0]).toMatchObject({ playerId: 'a', roundWins: 2 });
  });
});
