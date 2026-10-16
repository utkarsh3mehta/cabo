import type { GameView, PlayerId, RoomView, SlotIndex } from '@cabo/shared/client';
import { useMemo } from 'react';
import { CardBack, CardFace } from '../components/Card';
import { GameOver, RoundResults, ScoreTable } from '../components/Results';
import { PlayerLayout, type SlotState } from '../components/Seat';
import { describeEvent, nameLookup, recentlyChangedSlots, SLOT_LABELS, type NameLookup } from '../lib/describe';
import type { RoomConnection } from '../lib/useRoomConnection';
import { useInteraction, type Mode } from './interaction';

interface GameTableProps {
  conn: RoomConnection;
  view: RoomView;
  game: GameView;
  onError: (message: string) => void;
  onHome: () => void;
}

const ABILITY_NAME = { peek: 'Peek', spy: 'Spy', swap: 'Swap' } as const;

function statusText(game: GameView, view: RoomView, name: NameLookup): string {
  const r = game.round;
  const me = view.you.playerId;
  if (game.phase === 'roundComplete') return 'Round over.';
  if (game.phase === 'gameComplete') return 'Game over.';
  if (r.phase === 'initialInspection') {
    const ready = r.table.filter((s) => s.inspectionDone).length;
    return `Everyone looks at two of their own cards (${ready} of ${r.table.length} ready).`;
  }
  const active = r.activePlayer;
  const who = name(active);
  const step = r.step;
  const finalTurns = r.caboCaller ? ` Cabo was called by ${name(r.caboCaller)}: ${r.finalTurnsRemaining} final turn${r.finalTurnsRemaining === 1 ? '' : 's'} left.` : '';
  if (active === me) return `Your turn.${finalTurns}`;
  if (!step) return `${who}’s turn.${finalTurns}`;
  switch (step.kind) {
    case 'awaitingAction':
      return `${who}’s turn.${finalTurns}`;
    case 'holding':
      return step.source === 'discard'
        ? `${who} took the ${step.value} from the discard pile and is choosing where it goes.${finalTurns}`
        : `${who} drew from the draw pile and is deciding.${finalTurns}`;
    case 'viewing':
      return `${who} is ${step.ability === 'peek' ? 'peeking at' : 'spying on'} ${step.target.playerId === active ? 'their own' : `${name(step.target.playerId)}’s`} ${SLOT_LABELS[step.target.slot]} card.${finalTurns}`;
  }
}

export function GameTable({ conn, view, game, onError, onHome }: GameTableProps) {
  const name = useMemo(() => nameLookup(view), [view]);
  const me = view.you.playerId;
  const { mode, setMode, select } = useInteraction(game);
  const round = game.round;
  const legal = game.legal;
  const step = round.step;
  const quick = game.mode === 'quick';
  const changed = useMemo(() => recentlyChangedSlots(conn.events), [conn.events]);
  const participants = useMemo(() => new Map(view.participants.map((p) => [p.playerId, p])), [view.participants]);
  const scores = useMemo(() => new Map(game.scores.map((s) => [s.playerId, s])), [game.scores]);

  const run = async (p: Promise<{ ok: boolean; error?: { message: string } }>) => {
    const ack = await p;
    if (!ack.ok && ack.error) onError(ack.error.message);
    return ack.ok;
  };
  const act = (action: Parameters<RoomConnection['game']>[0]) => run(conn.game(action));

  const seats = round.table;
  const myIndex = Math.max(0, seats.findIndex((s) => s.playerId === me));
  const mySeat = seats[myIndex];
  // Opponents in clockwise order starting after me.
  const opponents = [...seats.slice(myIndex + 1), ...seats.slice(0, myIndex)].filter((s) => s.playerId !== me);

  const occupied = (owner: PlayerId, slot: SlotIndex) => !!seats.find((s) => s.playerId === owner)?.slots[slot]?.occupied;

  function slotState(owner: PlayerId, slot: SlotIndex): SlotState {
    const isMine = owner === me;
    const base = { selectable: false, selected: false, changed: changed.has(`${owner}:${slot}`) } as SlotState;
    if (conn.pending) return base;
    switch (mode.kind) {
      case 'inspect': {
        const selected = isMine && mode.slots.includes(slot);
        return { ...base, selected, selectable: isMine && occupied(owner, slot) && (selected || mode.slots.length < 2), order: selected ? mode.slots.indexOf(slot) + 1 : undefined };
      }
      case 'hold': {
        const selected = isMine && mode.slots.includes(slot);
        return { ...base, selected, selectable: isMine && legal.replaceSlots.includes(slot), order: selected && mode.slots.length > 1 ? mode.slots.indexOf(slot) + 1 : undefined };
      }
      case 'peek':
        return { ...base, selectable: isMine && occupied(owner, slot) };
      case 'spy':
        return { ...base, selectable: !isMine && occupied(owner, slot) };
      case 'swap': {
        const selected = isMine ? mode.own === slot : mode.other?.playerId === owner && mode.other.slot === slot;
        return { ...base, selected, selectable: occupied(owner, slot) };
      }
      default:
        return base;
    }
  }

  async function onSelect(owner: PlayerId, slot: SlotIndex) {
    const result = select(owner, slot);
    if (!result) return;
    if (result.peek !== undefined) await act({ type: 'usePeek', slot: result.peek });
    if (result.spy) await act({ type: 'useSpy', target: result.spy });
  }

  const activity = conn.events
    .map((e) => describeEvent(e, name))
    .filter((s): s is string => !!s)
    .slice(-6)
    .reverse();

  const holdingVisible = step?.kind === 'holding' ? step.value : undefined;
  const heldBy = round.activePlayer;
  const showResults = game.phase === 'roundComplete' && game.lastRoundResult;
  const showGameOver = game.phase === 'gameComplete' && game.result;
  const disconnected = view.participants.filter((p) => p.kind === 'human' && !p.connected && !p.takenOverByBot);

  return (
    <div className="table-page" data-testid="game-table" data-phase={game.phase} data-round-phase={round.phase}>
      <div className="table-top">
        <div className="table-meta">
          <strong data-testid="round-label">
            Round {round.number}
            {quick && game.quickRounds ? ` of up to ${game.quickRounds}` : ''}
          </strong>
          <span>· {quick ? 'Quick game (best of 3 rounds)' : 'Full game (to 100)'}</span>
          <span>· Room {view.code}</span>
          {conn.status !== 'connected' && <span className="badge offline">Reconnecting…</span>}
        </div>
        <ol className="turn-order" aria-label="Turn order (clockwise)" data-testid="turn-order">
          {seats.map((s) => (
            <li key={s.playerId} aria-current={round.activePlayer === s.playerId ? 'true' : undefined}>
              {s.playerId === me ? 'You' : (participants.get(s.playerId)?.name ?? 'Player')}
            </li>
          ))}
        </ol>
      </div>

      {disconnected.length > 0 && game.phase !== 'gameComplete' && (
        <div className="notice info" role="status">
          {disconnected.map((p) => (
            <div key={p.playerId} className="row" style={{ justifyContent: 'space-between' }}>
              <span>
                {p.name} is disconnected.{' '}
                {p.graceExpired
                  ? view.settings.allowBots
                    ? view.you.isHost
                      ? 'You can let a bot play their seat for the rest of this game.'
                      : 'The host can hand their seat to a bot.'
                    : 'Waiting for them to return.'
                  : `Their seat is reserved for ${Math.round(view.limits.reconnectGraceMs / 1000)} seconds.`}
              </span>
              {p.graceExpired && view.you.isHost && view.settings.allowBots && (
                <button type="button" className="small" disabled={conn.pending} onClick={() => run(conn.send({ type: 'replaceWithBot', playerId: p.playerId }))}>
                  Replace with bot
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {showGameOver && (
        <GameOver
          result={game.result!}
          name={name}
          me={me}
          isHost={view.you.isHost}
          pending={conn.pending}
          scores={game.scores}
          history={game.history}
          onReturnToLobby={() => run(conn.send({ type: 'returnToLobby' }))}
          onHome={onHome}
        />
      )}
      {showResults && (
        <RoundResults
          result={game.lastRoundResult!}
          name={name}
          me={me}
          quick={quick}
          nextRound={view.nextRound}
          canReady={!!view.nextRound}
          pending={conn.pending}
          onReady={() => run(conn.send({ type: 'readyNextRound' }))}
        />
      )}

      <div className="table-layout">
        <div className="felt">
          <div className="opponents">
            {opponents.map((seat) => (
              <PlayerLayout
                key={seat.playerId}
                seat={seat}
                participant={participants.get(seat.playerId)}
                score={scores.get(seat.playerId)}
                isMe={false}
                isActive={round.activePlayer === seat.playerId}
                calledCabo={round.caboCaller === seat.playerId}
                size="mini"
                slotState={slotState}
                onSelect={onSelect}
                showRoundWins={quick}
              />
            ))}
          </div>

          <div className="center-row">
            <div className="pile">
              <button
                type="button"
                className={`slot ${legal.drawFromDeck && !conn.pending ? 'targetable' : ''}`}
                aria-label={`Draw pile, ${round.drawPileCount} cards${legal.drawFromDeck ? '. Draw a card' : ''}`}
                disabled={!legal.drawFromDeck || conn.pending}
                onClick={() => act({ type: 'drawFromDeck' })}
                data-testid="draw-pile"
              >
                <span className="pile-stack has-more">
                  <CardBack />
                </span>
              </button>
              <span>Draw · {round.drawPileCount}</span>
            </div>
            <div className="pile">
              <button
                type="button"
                className={`slot ${legal.takeDiscard && !conn.pending ? 'targetable' : ''}`}
                aria-label={round.discardTop === null ? 'Discard pile, empty' : `Discard pile, top card ${round.discardTop}${legal.takeDiscard ? '. Take it' : ''}`}
                disabled={!legal.takeDiscard || conn.pending}
                onClick={() => act({ type: 'takeDiscard' })}
                data-testid="discard-pile"
              >
                {round.discardTop === null ? <span className="card card-empty">empty</span> : <CardFace value={round.discardTop} />}
              </button>
              <span>Discard · {round.discardCount}</span>
            </div>
            {step?.kind === 'holding' && (
              <div className="held" data-testid="held-card">
                {holdingVisible !== undefined ? <CardFace value={holdingVisible} size="large" /> : <CardBack size="large" />}
                <span>{heldBy === me ? 'Your card' : `${name(heldBy)} holds`}</span>
              </div>
            )}
          </div>

          <p className={`status-line ${round.activePlayer === me ? 'yours' : ''}`} data-testid="status-line">
            {statusText(game, view, name)}
          </p>

          {mySeat && (
            <div className="my-area">
              <PlayerLayout
                seat={mySeat}
                participant={participants.get(me)}
                score={scores.get(me)}
                isMe
                isActive={round.activePlayer === me}
                calledCabo={round.caboCaller === me}
                size="normal"
                slotState={slotState}
                onSelect={onSelect}
                showRoundWins={quick}
              />
            </div>
          )}

          {game.phase === 'round' && <ActionPanel game={game} mode={mode} setMode={setMode} pending={conn.pending} act={act} name={name} />}
        </div>

        <aside className="side" aria-label="Scores and recent moves">
          <section className="panel">
            <h2 className="small" style={{ fontSize: '1rem' }}>
              Scores
            </h2>
            <ScoreTable scores={game.scores} name={name} me={me} quick={quick} history={game.history} />
          </section>
          <section className="panel">
            <h2 style={{ fontSize: '1rem' }}>Recent moves</h2>
            {activity.length === 0 ? (
              <p className="muted small">Moves will appear here.</p>
            ) : (
              <ul className="activity" data-testid="activity">
                {activity.map((line, i) => (
                  <li key={`${conn.events.length}-${i}`}>{line}</li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

interface ActionPanelProps {
  game: GameView;
  mode: Mode;
  setMode: (m: Mode) => void;
  pending: boolean;
  act: (action: Parameters<RoomConnection['game']>[0]) => Promise<boolean>;
  name: NameLookup;
}

function ActionPanel({ game, mode, setMode, pending, act, name }: ActionPanelProps) {
  const legal = game.legal;
  const round = game.round;
  const step = round.step;
  const me = game.viewer;
  let prompt: string;
  const buttons: Array<{ label: string; onClick: () => void; kind?: 'primary' | 'danger' | 'ghost'; disabled?: boolean; testId: string }> = [];

  if (legal.inspect && mode.kind === 'inspect') {
    prompt = mode.slots.length < 2 ? `Choose ${2 - mode.slots.length} more of your cards to look at. Only you will see them.` : 'Ready to look at these two cards.';
    buttons.push({ label: 'Look at these cards', kind: 'primary', disabled: mode.slots.length !== 2, testId: 'confirm-inspect', onClick: () => act({ type: 'inspect', slots: mode.slots }) });
  } else if (legal.finishInspection) {
    prompt = 'Memorise your two cards. They go face down again when you continue.';
    buttons.push({ label: 'I’ve memorised them', kind: 'primary', testId: 'finish-inspect', onClick: () => act({ type: 'finishInspection' }) });
  } else if (round.phase === 'initialInspection') {
    prompt = 'Waiting for the other players to look at their cards…';
  } else if (legal.acknowledgeReveal && step?.kind === 'viewing') {
    const whose = step.target.playerId === me ? 'your' : `${name(step.target.playerId)}’s`;
    prompt = `${step.ability === 'peek' ? 'Peek' : 'Spy'}: ${whose} ${SLOT_LABELS[step.target.slot]} card is a ${step.value ?? '?'}. Remember it!`;
    buttons.push({ label: 'Done — hide it', kind: 'primary', testId: 'ack-reveal', onClick: () => act({ type: 'acknowledgeReveal' }) });
  } else if (legal.drawFromDeck) {
    if (mode.kind === 'confirmCabo') {
      prompt = 'Call Cabo? Everyone else gets one more turn, then the round ends. If you do not have the lowest total, you get a 5-point penalty.';
      buttons.push({ label: 'Yes, call Cabo', kind: 'danger', testId: 'confirm-cabo', onClick: () => act({ type: 'callCabo' }) });
      buttons.push({ label: 'Cancel', kind: 'ghost', testId: 'cancel', onClick: () => setMode({ kind: 'idle' }) });
    } else {
      prompt = 'Your turn: draw from the pile, take the top discard, or call Cabo.';
      buttons.push({ label: 'Draw a card', kind: 'primary', testId: 'draw', onClick: () => act({ type: 'drawFromDeck' }) });
      if (legal.takeDiscard && round.discardTop !== null) {
        buttons.push({ label: `Take the ${round.discardTop}`, testId: 'take-discard', onClick: () => act({ type: 'takeDiscard' }) });
      }
      if (legal.callCabo) buttons.push({ label: 'Call Cabo', kind: 'danger', testId: 'call-cabo', onClick: () => setMode({ kind: 'confirmCabo' }) });
    }
  } else if (step?.kind === 'holding' && legal.replaceSlots.length > 0) {
    const held = step.value;
    const fromDiscard = step.source === 'discard';
    if (mode.kind === 'peek') {
      prompt = 'Peek: tap one of your cards to look at it.';
      buttons.push({ label: 'Cancel', kind: 'ghost', testId: 'cancel', onClick: () => setMode({ kind: 'hold', slots: [] }) });
    } else if (mode.kind === 'spy') {
      prompt = 'Spy: tap another player’s card to look at it.';
      buttons.push({ label: 'Cancel', kind: 'ghost', testId: 'cancel', onClick: () => setMode({ kind: 'hold', slots: [] }) });
    } else if (mode.kind === 'swap') {
      prompt =
        mode.own === null
          ? 'Swap: tap one of your cards, then another player’s card. Neither is revealed.'
          : mode.other === null
            ? 'Now tap another player’s card to swap with.'
            : `Swap your ${SLOT_LABELS[mode.own]} card with ${name(mode.other.playerId)}’s ${SLOT_LABELS[mode.other.slot]} card?`;
      buttons.push({
        label: 'Swap these cards',
        kind: 'primary',
        testId: 'confirm-swap',
        disabled: mode.own === null || mode.other === null,
        onClick: () => mode.own !== null && mode.other && act({ type: 'useSwap', ownSlot: mode.own, target: mode.other }),
      });
      buttons.push({ label: 'Cancel', kind: 'ghost', testId: 'cancel', onClick: () => setMode({ kind: 'hold', slots: [] }) });
    } else {
      const selected = mode.kind === 'hold' ? mode.slots : [];
      const what = fromDiscard ? `You took the ${held}.` : `You drew a ${held}.`;
      prompt =
        selected.length === 0
          ? `${what} Tap one of your cards to replace it, or tap 2–4 cards you think match.${fromDiscard ? '' : ' You can also discard it.'}`
          : selected.length === 1
            ? `Replace your ${SLOT_LABELS[selected[0]!]} card with the ${held}?`
            : `Match ${selected.length} cards? If they are all equal they are discarded and the ${held} takes the place of card 1. If not, they are shown to everyone and your ${held} is discarded.`;
      if (selected.length <= 1) {
        buttons.push({ label: 'Replace card', kind: 'primary', testId: 'replace', disabled: selected.length !== 1, onClick: () => act({ type: 'replace', slot: selected[0]! }) });
      } else {
        buttons.push({ label: `Match ${selected.length} cards`, kind: 'primary', testId: 'match', disabled: !legal.match, onClick: () => act({ type: 'match', slots: selected }) });
      }
      if (legal.ability) {
        const ability = legal.ability;
        buttons.push({
          label: `Use ${ABILITY_NAME[ability]}`,
          testId: `use-${ability}`,
          onClick: () => setMode(ability === 'swap' ? { kind: 'swap', own: null, other: null } : { kind: ability }),
        });
      }
      if (legal.discardDrawn) buttons.push({ label: `Discard the ${held}`, kind: 'ghost', testId: 'discard', onClick: () => act({ type: 'discardDrawn' }) });
    }
  } else {
    const active = round.activePlayer;
    prompt = active ? `Waiting for ${name(active)}…` : 'Waiting…';
  }

  return (
    <div className="action-panel" data-testid="action-panel">
      <p className="prompt" data-testid="prompt">
        {prompt}
      </p>
      {buttons.length > 0 && (
        <div className="action-buttons">
          {buttons.map((b) => (
            <button key={b.testId} type="button" className={b.kind ?? ''} disabled={pending || b.disabled} onClick={b.onClick} data-testid={b.testId}>
              {b.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
