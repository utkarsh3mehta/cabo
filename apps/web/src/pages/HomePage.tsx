import { MAX_SOLO_BOTS, normalizeDisplayName, normalizeRoomCode, type GameMode } from '@cabo/shared/client';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError, createRoom, joinRoom } from '../lib/api';
import { loadName, recentSessions, saveName, saveSession } from '../lib/sessions';

function ModePicker({ value, onChange, idPrefix }: { value: GameMode; onChange: (m: GameMode) => void; idPrefix: string }) {
  return (
    <div className="field">
      <span id={`${idPrefix}-mode`} className="small" style={{ fontWeight: 600 }}>
        Game length
      </span>
      <div className="segmented" role="group" aria-labelledby={`${idPrefix}-mode`}>
        <button type="button" aria-pressed={value === 'full'} onClick={() => onChange('full')} data-testid={`${idPrefix}-mode-full`}>
          Full (to 100)
        </button>
        <button type="button" aria-pressed={value === 'quick'} onClick={() => onChange('quick')} data-testid={`${idPrefix}-mode-quick`}>
          Quick (3 rounds)
        </button>
      </div>
    </div>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const [name, setName] = useState(loadName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bots, setBots] = useState(2);
  const [soloMode, setSoloMode] = useState<GameMode>('quick');
  const [roomMode, setRoomMode] = useState<GameMode>('full');
  const [allowBots, setAllowBots] = useState(true);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const recent = recentSessions().slice(0, 3);

  function checkedName(): string | null {
    const check = normalizeDisplayName(name);
    if (!check.ok) {
      setNameError(check.reason);
      document.getElementById('home-name')?.focus();
      return null;
    }
    setNameError(null);
    saveName(check.name);
    return check.name;
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  const startSolo = () => {
    const n = checkedName();
    if (!n) return;
    void run('solo', async () => {
      const session = await createRoom({ name: n, mode: soloMode, allowBots: true, botCount: bots });
      saveSession(session);
      navigate(`/r/${session.roomCode}`, { state: { autoStart: true } });
    });
  };

  const create = () => {
    const n = checkedName();
    if (!n) return;
    void run('create', async () => {
      const session = await createRoom({ name: n, mode: roomMode, allowBots });
      saveSession(session);
      navigate(`/r/${session.roomCode}`);
    });
  };

  const join = () => {
    const normalized = normalizeRoomCode(code);
    if (!normalized) {
      setCodeError('Enter the 6-character room code, for example K7M2P9.');
      return;
    }
    setCodeError(null);
    const n = checkedName();
    if (!n) return;
    void run('join', async () => {
      const session = await joinRoom(normalized, n);
      saveSession(session);
      navigate(`/r/${session.roomCode}`);
    });
  };

  return (
    <main className="page" id="main">
      <div className="hero">
        <h1>Cabo Online</h1>
        <p>
          A quick memory card game. Everyone starts with four face-down cards and only peeks at two. Swap, spy and match your way to the lowest total,
          then call <strong>Cabo</strong> when you think you are lowest. <Link to="/rules">Read the rules</Link>.
        </p>
      </div>

      {error && (
        <div className="notice error" role="alert" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="field" style={{ maxWidth: 360 }}>
          <label htmlFor="home-name">Your display name</label>
          <input
            id="home-name"
            type="text"
            autoComplete="nickname"
            placeholder="e.g. Sam"
            value={name}
            maxLength={40}
            aria-invalid={!!nameError}
            aria-describedby={nameError ? 'home-name-error' : undefined}
            onChange={(e) => setName(e.target.value)}
            data-testid="name-input"
          />
          {nameError && (
            <span id="home-name-error" className="field-error">
              {nameError}
            </span>
          )}
        </div>
      </section>

      <div className="grid-2">
        <section className="panel stack" aria-labelledby="solo-title">
          <h2 id="solo-title">Play with bots</h2>
          <p className="muted small">A solo game against easy computer players.</p>
          <div className="field">
            <span id="bots-label" className="small" style={{ fontWeight: 600 }}>
              Number of bots
            </span>
            <div className="segmented" role="group" aria-labelledby="bots-label">
              {Array.from({ length: MAX_SOLO_BOTS }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" aria-pressed={bots === n} onClick={() => setBots(n)} data-testid={`bots-${n}`}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <ModePicker value={soloMode} onChange={setSoloMode} idPrefix="solo" />
          <button type="button" className="primary" onClick={startSolo} disabled={busy !== null} data-testid="start-solo">
            {busy === 'solo' ? 'Starting…' : 'Start solo game'}
          </button>
        </section>

        <section className="panel stack" aria-labelledby="create-title">
          <h2 id="create-title">Create a private room</h2>
          <p className="muted small">Get a code and an invitation link to share with friends.</p>
          <ModePicker value={roomMode} onChange={setRoomMode} idPrefix="room" />
          <label className="checkbox">
            <input type="checkbox" checked={allowBots} onChange={(e) => setAllowBots(e.target.checked)} />
            Allow bots in this room
          </label>
          <button type="button" className="primary" onClick={create} disabled={busy !== null} data-testid="create-room">
            {busy === 'create' ? 'Creating…' : 'Create room'}
          </button>
        </section>

        <section className="panel stack" aria-labelledby="join-title">
          <h2 id="join-title">Join a room</h2>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              join();
            }}
          >
            <div className="field">
              <label htmlFor="join-code">Room code</label>
              <input
                id="join-code"
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                placeholder="K7M2P9"
                value={code}
                maxLength={12}
                aria-invalid={!!codeError}
                aria-describedby={codeError ? 'join-code-error' : undefined}
                onChange={(e) => setCode(e.target.value)}
                data-testid="join-code"
              />
              {codeError && (
                <span id="join-code-error" className="field-error">
                  {codeError}
                </span>
              )}
            </div>
            <button type="submit" disabled={busy !== null} data-testid="join-room">
              {busy === 'join' ? 'Joining…' : 'Join room'}
            </button>
          </form>
          {recent.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="muted small">Rejoin a recent room on this device:</span>
              <div className="row">
                {recent.map((s) => (
                  <Link key={s.roomCode} className="button small" to={`/r/${s.roomCode}`}>
                    {s.roomCode}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
