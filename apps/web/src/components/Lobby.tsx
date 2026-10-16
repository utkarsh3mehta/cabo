import { normalizeDisplayName, type GameMode, type RoomView } from '@cabo/shared/client';
import { useState } from 'react';
import type { RoomConnection } from '../lib/useRoomConnection';
import { CheckIcon, CopyIcon } from './Icons';
import { SeatBadges } from './Seat';

interface LobbyProps {
  view: RoomView;
  conn: RoomConnection;
  onError: (message: string) => void;
  onLeave: () => void;
}

export function inviteUrl(code: string): string {
  return `${window.location.origin}/r/${code}`;
}

function CopyButton({ text, label, testId }: { text: string; label: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="small"
      data-testid={testId}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <CheckIcon width={16} /> : <CopyIcon width={16} />}
      {copied ? 'Copied' : label}
    </button>
  );
}

export function Lobby({ view, conn, onError, onLeave }: LobbyProps) {
  const isHost = view.you.isHost;
  const me = view.participants.find((p) => p.playerId === view.you.playerId);
  const [name, setName] = useState(me?.name ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const url = inviteUrl(view.code);
  const count = view.participants.length;
  const canStart = isHost && count >= view.limits.minPlayers && count <= view.limits.maxPlayers;
  const emptySeats = Math.max(0, view.limits.maxPlayers - count);

  const run = async (p: ReturnType<RoomConnection['send']>) => {
    const ack = await p;
    if (!ack.ok) onError(ack.error.message);
    return ack.ok;
  };

  const setMode = (mode: GameMode) => run(conn.send({ type: 'updateSettings', mode }));

  return (
    <div className="page" data-testid="lobby">
      <div className="grid-2">
        <section className="panel stack" aria-labelledby="invite-title">
          <h1 id="invite-title" style={{ fontSize: '1.4rem' }}>
            Private room
          </h1>
          <div>
            <div className="muted small">Room code</div>
            <div className="code-display" data-testid="room-code" aria-label={`Room code ${view.code.split('').join(' ')}`}>
              {view.code}
            </div>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <div className="muted small">Invitation link</div>
            <div className="invite-url" data-testid="invite-url">
              {url}
            </div>
            <div className="row">
              <CopyButton text={url} label="Copy link" testId="copy-link" />
              <CopyButton text={view.code} label="Copy code" testId="copy-code" />
              {'share' in navigator && (
                <button type="button" className="small" onClick={() => navigator.share?.({ title: 'Join my Cabo game', url }).catch(() => undefined)}>
                  Share…
                </button>
              )}
            </div>
          </div>
          <p className="muted small">Anyone with the link or code can join while the room is in the lobby. Seats fill up to 5 players, bots included.</p>
        </section>

        <section className="panel stack" aria-labelledby="players-title">
          <h2 id="players-title">
            Players ({count}/{view.limits.maxPlayers})
          </h2>
          <ul className="seat-list" data-testid="seat-list">
            {view.participants.map((p) => (
              <li key={p.playerId} data-testid="seat" data-kind={p.kind}>
                <span className="who">
                  <strong>{p.name}</strong>
                  {p.playerId === view.you.playerId && <span className="muted small">(you)</span>}
                  <SeatBadges participant={p} isActive={false} calledCabo={false} />
                  {p.kind === 'human' && p.connected && <span className="badge ok">Online</span>}
                </span>
                {isHost && p.kind === 'bot' && (
                  <button type="button" className="small ghost" disabled={conn.pending} onClick={() => run(conn.send({ type: 'removeBot', playerId: p.playerId }))}>
                    Remove
                  </button>
                )}
              </li>
            ))}
            {Array.from({ length: emptySeats }, (_, i) => (
              <li key={`empty-${i}`} className="empty">
                <span>Empty seat</span>
                {isHost && view.settings.allowBots && i === 0 && (
                  <button type="button" className="small" data-testid="add-bot" disabled={conn.pending} onClick={() => run(conn.send({ type: 'addBot' }))}>
                    Add a bot
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <section className="panel stack" aria-labelledby="settings-title">
          <h2 id="settings-title">Game settings</h2>
          <div className="field">
            <span id="mode-label" className="small" style={{ fontWeight: 600 }}>
              Game length
            </span>
            <div className="segmented" role="group" aria-labelledby="mode-label">
              {(['full', 'quick'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={view.settings.mode === m}
                  disabled={!isHost || conn.pending}
                  data-testid={`mode-${m}`}
                  onClick={() => setMode(m)}
                >
                  {m === 'full' ? 'Full game (to 100)' : 'Quick (best of 3)'}
                </button>
              ))}
            </div>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={view.settings.allowBots}
              disabled={!isHost || conn.pending}
              data-testid="allow-bots"
              onChange={(e) => run(conn.send({ type: 'updateSettings', allowBots: e.target.checked }))}
            />
            Allow bots (fill seats, replace disconnected players)
          </label>
          {!isHost && <p className="muted small">Only the host can change settings.</p>}
        </section>

        <section className="panel stack" aria-labelledby="you-title">
          <h2 id="you-title">You</h2>
          <form
            className="row"
            onSubmit={async (e) => {
              e.preventDefault();
              const check = normalizeDisplayName(name);
              if (!check.ok) return setNameError(check.reason);
              setNameError(null);
              await run(conn.send({ type: 'setName', name: check.name }));
            }}
          >
            <div className="field" style={{ flex: '1 1 180px' }}>
              <label htmlFor="lobby-name">Display name</label>
              <input id="lobby-name" type="text" value={name} maxLength={40} aria-invalid={!!nameError} onChange={(e) => setName(e.target.value)} />
              {nameError && <span className="field-error">{nameError}</span>}
            </div>
            <button type="submit" disabled={conn.pending || name === me?.name}>
              Rename
            </button>
          </form>
          <div className="row" style={{ marginTop: 'auto' }}>
            {isHost ? (
              <button type="button" className="primary" data-testid="start-game" disabled={!canStart || conn.pending} onClick={() => run(conn.send({ type: 'startGame' }))}>
                Start game
              </button>
            ) : (
              <span className="muted" role="status">
                Waiting for the host to start the game…
              </span>
            )}
            <button type="button" className="ghost" onClick={onLeave}>
              Leave room
            </button>
          </div>
          {isHost && !canStart && <p className="muted small">Invite at least one more person{view.settings.allowBots ? ' or add a bot' : ''} to start.</p>}
        </section>
      </div>
    </div>
  );
}
