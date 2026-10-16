import { normalizeDisplayName, normalizeRoomCode, type RoomInfoResponse, type SessionResponse } from '@cabo/shared/client';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { Lobby } from '../components/Lobby';
import { useToast } from '../components/Toasts';
import { GameTable } from '../game/GameTable';
import { ApiError, getRoomInfo, joinRoom } from '../lib/api';
import { forgetSession, loadName, loadSession, saveName, saveSession } from '../lib/sessions';
import { useRoomConnection } from '../lib/useRoomConnection';

function JoinForm({ code, onJoined }: { code: string; onJoined: (s: SessionResponse) => void }) {
  const [info, setInfo] = useState<RoomInfoResponse | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [name, setName] = useState(loadName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getRoomInfo(code)
      .then(setInfo)
      .catch((err) => setLookupError(err instanceof ApiError ? err.message : 'Could not look up this room.'));
  }, [code]);

  const joinable = info?.joinable ?? false;

  return (
    <main className="page narrow" id="main">
      <section className="panel stack" aria-labelledby="join-title" data-testid="join-form">
        <h1 id="join-title" style={{ fontSize: '1.5rem' }}>
          Join room <span className="code-display" style={{ fontSize: '1.5rem' }}>{code}</span>
        </h1>
        {lookupError && (
          <div className="notice error" role="alert">
            {lookupError} <Link to="/">Back to home</Link>
          </div>
        )}
        {info && !joinable && (
          <div className="notice error" role="alert" data-testid="not-joinable">
            {info.phase !== 'lobby' ? 'This game has already started, so new players cannot join.' : 'This room is full.'} <Link to="/">Back to home</Link>
          </div>
        )}
        {info && joinable && (
          <p className="muted">
            {info.seatsTaken} of {info.maxSeats} seats taken. Choose a display name to join.
          </p>
        )}
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const check = normalizeDisplayName(name);
            if (!check.ok) return setError(check.reason);
            setBusy(true);
            setError(null);
            try {
              saveName(check.name);
              const session = await joinRoom(code, check.name);
              saveSession(session);
              onJoined(session);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Could not join the room.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="field">
            <label htmlFor="join-name">Your display name</label>
            <input
              id="join-name"
              type="text"
              autoComplete="nickname"
              value={name}
              maxLength={40}
              aria-invalid={!!error}
              aria-describedby={error ? 'join-name-error' : undefined}
              onChange={(e) => setName(e.target.value)}
              data-testid="join-name"
            />
            {error && (
              <span id="join-name-error" className="field-error" role="alert">
                {error}
              </span>
            )}
          </div>
          <button type="submit" className="primary" disabled={busy || !joinable} data-testid="join-submit">
            {busy ? 'Joining…' : 'Join game'}
          </button>
        </form>
      </section>
    </main>
  );
}

function Ended({ title, message }: { title: string; message: string }) {
  return (
    <main className="page narrow" id="main">
      <section className="panel stack" role="alert" data-testid="session-ended">
        <h1 style={{ fontSize: '1.5rem' }}>{title}</h1>
        <p>{message}</p>
        <Link className="button primary" to="/">
          Back to home
        </Link>
      </section>
    </main>
  );
}

function ConnectedRoom({ session }: { session: SessionResponse }) {
  const conn = useRoomConnection(session);
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const autoStart = useRef((location.state as { autoStart?: boolean } | null)?.autoStart === true);
  const { view } = conn;

  // Solo games start as soon as the lobby with the bots is visible.
  useEffect(() => {
    if (!autoStart.current || !view || view.phase !== 'lobby' || !view.you.isHost) return;
    autoStart.current = false;
    void conn.send({ type: 'startGame' }).then((ack) => !ack.ok && toast(ack.error.message));
  }, [view, conn, toast]);

  useEffect(() => {
    if (conn.ended === 'left') {
      forgetSession(session.roomCode);
      navigate('/');
    } else if (conn.fatal || conn.ended === 'roomClosed' || conn.ended === 'seatTakenOver') {
      forgetSession(session.roomCode);
    }
  }, [conn.ended, conn.fatal, navigate, session.roomCode]);

  const leave = async () => {
    const inGame = view?.phase === 'playing';
    const ok = window.confirm(inGame ? 'Leave this game? You will not be able to return, and the host can hand your seat to a bot.' : 'Leave this room?');
    if (!ok) return;
    const ack = await conn.send({ type: 'leave' });
    if (!ack.ok) toast(ack.error.message);
    forgetSession(session.roomCode);
    navigate('/');
  };

  if (conn.ended === 'replacedByNewConnection') {
    return <Ended title="Opened elsewhere" message="This seat was opened in another tab or device, so this page stopped updating. Close this tab, or reload it to take the seat back here." />;
  }
  if (conn.ended === 'seatTakenOver' || conn.fatal?.code === 'SEAT_TAKEN_OVER') {
    return <Ended title="Your seat was handed to a bot" message="You were disconnected for too long and the host let a bot finish the game in your seat. The seat is no longer yours for this game." />;
  }
  if (conn.ended === 'roomClosed' || conn.fatal?.code === 'ROOM_NOT_FOUND') {
    return <Ended title="Room closed" message="This room no longer exists. Rooms close after a period of inactivity or when the server restarts." />;
  }
  if (conn.fatal) {
    return <Ended title="Cannot rejoin" message={conn.fatal.message} />;
  }
  if (!view) {
    return (
      <main className="page narrow" id="main">
        <p role="status" className="muted">
          {conn.status === 'reconnecting' ? 'Reconnecting…' : 'Connecting to the room…'}
        </p>
      </main>
    );
  }
  if (view.phase === 'lobby' || !view.game) {
    return <Lobby view={view} conn={conn} onError={toast} onLeave={leave} />;
  }
  return (
    <main id="main" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <GameTable conn={conn} view={view} game={view.game} onError={toast} onHome={() => navigate('/')} />
      {view.phase === 'playing' && (
        <div style={{ textAlign: 'center', paddingBottom: 12 }}>
          <button type="button" className="small ghost" onClick={leave}>
            Leave game
          </button>
        </div>
      )}
    </main>
  );
}

export function RoomPage() {
  const params = useParams();
  const code = normalizeRoomCode(params.code ?? '');
  const [session, setSession] = useState<SessionResponse | null>(() => (code ? loadSession(code) : null));

  useEffect(() => {
    setSession(code ? loadSession(code) : null);
  }, [code]);

  if (!code) return <Ended title="Invalid invitation" message="That link does not contain a valid room code." />;
  if (!session) return <JoinForm code={code} onJoined={setSession} />;
  return <ConnectedRoom key={session.token} session={session} />;
}
