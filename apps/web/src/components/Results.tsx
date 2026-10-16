import type { GameResultView, PlayerId, RoundHistoryEntry, RoundResultView, ScoreView } from '@cabo/shared/client';
import type { NameLookup } from '../lib/describe';
import { CardFace, EmptySlot } from './Card';
import { CheckIcon } from './Icons';

interface RoundResultsProps {
  result: RoundResultView;
  name: NameLookup;
  me: PlayerId;
  quick: boolean;
  nextRound: { ready: PlayerId[]; waitingFor: PlayerId[] } | null;
  canReady: boolean;
  pending: boolean;
  onReady: () => void;
}

export function RoundResults({ result, name, me, quick, nextRound, canReady, pending, onReady }: RoundResultsProps) {
  const sorted = [...result.players].sort((a, b) => (quick ? b.roundWinsAfter - a.roundWinsAfter || a.totalAfter - b.totalAfter : a.totalAfter - b.totalAfter));
  const leader = sorted[0];
  const leaders = sorted.filter((p) => leader && p.totalAfter === leader.totalAfter && (!quick || p.roundWinsAfter === leader.roundWinsAfter));
  const iAmReady = nextRound?.ready.includes(me) ?? false;
  return (
    <section className="panel" aria-labelledby="round-results-title" data-testid="round-results">
      <h2 id="round-results-title">Round {result.roundNumber} results</h2>
      <p className="muted">
        {result.moonShooter
          ? `${name(result.moonShooter)} shot the moon: two 12s and both 13s! Everyone else scores 50.`
          : result.caboCaller
            ? `${name(result.caboCaller)} called Cabo${result.winners.includes(result.caboCaller) ? ' and had the lowest total.' : ' but did not have the lowest total (+5 penalty).'}`
            : 'Round complete.'}
      </p>
      {leader && (
        <p data-testid="leader-line">
          <strong>
            {leaders.length > 1 ? `Tied for the lead: ${leaders.map((p) => name(p.playerId)).join(', ')}` : `${name(leader.playerId)} ${name(leader.playerId) === 'You' ? 'are' : 'is'} ahead`}
          </strong>{' '}
          <span className="muted">
            ({quick ? `${leader.roundWinsAfter} round win${leader.roundWinsAfter === 1 ? '' : 's'}, ` : ''}
            {leader.totalAfter} pts)
          </span>
        </p>
      )}
      <div className="results-list">
        {sorted.map((p) => (
          <div key={p.playerId} className={`result-row ${p.isWinner ? 'winner' : ''}`} data-testid="result-row" data-player={p.playerId}>
            <div className="stack" style={{ gap: 6 }}>
              <strong>
                {name(p.playerId)}
                {p.isWinner ? ' — wins the round' : ''}
              </strong>
              <div className="result-cards" aria-label={`Cards: ${p.hand.filter((v) => v !== null).join(', ')}`}>
                {p.hand.map((v, i) => (v === null ? <EmptySlot key={i} size="mini" /> : <CardFace key={i} value={v} size="mini" />))}
              </div>
            </div>
            <div className="result-score">
              <div className="small muted">Cards: <span data-testid="hand-total">{p.handTotal}</span></div>
              <div className="big" data-testid="round-score">+{p.roundScore}</div>
              <div className="small">
                Total <span data-testid="total-after">{p.totalAfter}</span>
              </div>
            </div>
            <div className="result-notes">
              {p.calledCabo && <span className="badge cabo">Called Cabo</span>}
              {p.caboPenaltyApplied && <span className="badge offline">+5 Cabo penalty</span>}
              {p.shotTheMoon && <span className="badge host">Shot the moon</span>}
              {p.moonPenaltyApplied && <span className="badge offline">Moon: 50 points</span>}
              {p.resetApplied && <span className="badge ok">Hit exactly 100 → reset to 50</span>}
              {quick && <span className="badge">{p.roundWinsAfter} round win{p.roundWinsAfter === 1 ? '' : 's'}</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 14, justifyContent: 'space-between' }}>
        <span className="muted small" aria-live="polite">
          {nextRound && nextRound.waitingFor.length > 0
            ? `Waiting for: ${nextRound.waitingFor.map((id) => name(id)).join(', ')}`
            : 'Starting the next round…'}
        </span>
        {canReady && (
          <button type="button" className="primary" onClick={onReady} disabled={pending || iAmReady}>
            {iAmReady ? (
              <>
                <CheckIcon width={18} /> Ready
              </>
            ) : (
              'Next round'
            )}
          </button>
        )}
      </div>
    </section>
  );
}

export function ScoreTable({
  scores,
  name,
  me,
  quick,
  history,
}: {
  scores: ScoreView[];
  name: NameLookup;
  me: PlayerId;
  quick: boolean;
  history: RoundHistoryEntry[];
}) {
  const order = [...scores].sort((a, b) => (quick ? b.roundWins - a.roundWins || a.total - b.total : a.total - b.total));
  return (
    <div className="table-scroll">
      <table className="scores-table" data-testid="score-table">
        <caption className="visually-hidden">Scores</caption>
        <thead>
          <tr>
            <th scope="col">Player</th>
            {quick && (
              <th scope="col" className="num">
                Wins
              </th>
            )}
            {history.map((h) => (
              <th key={h.roundNumber} scope="col" className="num" title={`Round ${h.roundNumber}`}>
                R{h.roundNumber}
              </th>
            ))}
            <th scope="col" className="num">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {order.map((s) => (
            <tr key={s.playerId} data-player={s.playerId}>
              <th scope="row" style={{ fontWeight: s.playerId === me ? 800 : 500 }}>
                {name(s.playerId)}
                {s.resetUsed ? ' ↺' : ''}
              </th>
              {quick && <td className="num">{s.roundWins}</td>}
              {history.map((h) => (
                <td key={h.roundNumber} className="num">
                  {h.scores[s.playerId] ?? '–'}
                </td>
              ))}
              <td className="num" data-testid="score-total">
                <strong>{s.total}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface GameOverProps {
  result: GameResultView;
  name: NameLookup;
  me: PlayerId;
  isHost: boolean;
  pending: boolean;
  scores: ScoreView[];
  history: RoundHistoryEntry[];
  onReturnToLobby: () => void;
  onHome: () => void;
}

export function GameOver({ result, name, me, isHost, pending, scores, history, onReturnToLobby, onHome }: GameOverProps) {
  const quick = result.mode === 'quick';
  const winners = result.winners.map((w) => name(w));
  return (
    <section className="panel" aria-labelledby="game-over-title" data-testid="game-over">
      <h2 id="game-over-title">Game over</h2>
      <p style={{ fontSize: '1.2rem', fontWeight: 700 }} data-testid="winner-line">
        {winners.length === 1 ? `${winners[0]} ${winners[0] === 'You' ? 'win' : 'wins'}!` : `Shared win: ${winners.join(' and ')}!`}
      </p>
      <p className="muted small">
        {quick
          ? `Quick game: most round wins after ${result.roundsPlayed} round${result.roundsPlayed === 1 ? '' : 's'}; ties broken by lowest points.`
          : 'Full game: someone passed 100 points, so the lowest total wins.'}
      </p>
      <ol className="seat-list" aria-label="Final standings">
        {result.standings.map((s) => (
          <li key={s.playerId} data-testid="standing" data-rank={s.rank}>
            <span className="who">
              <strong>
                {s.rank}. {name(s.playerId)}
              </strong>
              {s.isWinner && <span className="badge host">Winner</span>}
            </span>
            <span className="muted">
              {quick ? `${s.roundWins} round win${s.roundWins === 1 ? '' : 's'} · ` : ''}
              {s.total} pts
            </span>
          </li>
        ))}
      </ol>
      <h3 style={{ marginTop: 16 }}>Round by round</h3>
      <ScoreTable scores={scores} name={name} me={me} quick={quick} history={history} />
      <div className="row" style={{ marginTop: 16 }}>
        {isHost ? (
          <button type="button" className="primary" onClick={onReturnToLobby} disabled={pending}>
            Play again with this room
          </button>
        ) : (
          <span className="muted small">The host can start another game in this room.</span>
        )}
        <button type="button" onClick={onHome}>
          Back to home
        </button>
      </div>
    </section>
  );
}
