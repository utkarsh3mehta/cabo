import { randomUUID } from 'node:crypto';
import { createSeededRng } from '@cabo/game-engine';
import {
  SOCKET_PATH,
  type CommandAck,
  type GameAction,
  type RoomCommand,
  type RoomView,
  type SessionResponse,
  type VisibleEvent,
} from '@cabo/shared';
import { io, type Socket } from 'socket.io-client';
import { buildServer, type CaboServer } from '../src/app.js';
import { loadConfig, type ServerConfig } from '../src/config.js';

export interface TestServer {
  server: CaboServer;
  url: string;
  close(): Promise<void>;
}

export async function startTestServer(overrides: Partial<ServerConfig> = {}, seed = 'test'): Promise<TestServer> {
  const config = loadConfig(
    {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      HOST: '127.0.0.1',
      PORT: '0',
      BOT_DELAY_MIN_MS: '0',
      BOT_DELAY_MAX_MS: '5',
      RECONNECT_GRACE_MS: '300',
      WEB_DIST_DIR: '/nonexistent-web-dist',
    },
    overrides,
  );
  const server = await buildServer(config, { gameRng: createSeededRng(`game-${seed}`), botRng: createSeededRng(`bot-${seed}`) });
  const url = await server.listen();
  return { server, url, close: () => server.close() };
}

export async function post<T>(base: string, path: string, body: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

export async function get<T>(base: string, path: string): Promise<{ status: number; body: T }> {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: (await res.json()) as T };
}

export async function createRoom(base: string, body: Record<string, unknown>): Promise<SessionResponse> {
  const r = await post<SessionResponse>(base, '/api/rooms', body);
  if (r.status !== 201) throw new Error(`create failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

export async function joinRoom(base: string, code: string, name: string): Promise<SessionResponse> {
  const r = await post<SessionResponse>(base, `/api/rooms/${code}/join`, { name });
  if (r.status !== 201) throw new Error(`join failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

export class TestClient {
  socket!: Socket;
  readonly snapshots: RoomView[] = [];
  readonly events: VisibleEvent[] = [];
  readonly ended: Array<{ reason: string }> = [];
  private listeners = new Set<() => void>();

  constructor(
    readonly url: string,
    readonly session: SessionResponse,
  ) {}

  get playerId(): string {
    return this.session.playerId;
  }

  latest(): RoomView {
    const v = this.snapshots[this.snapshots.length - 1];
    if (!v) throw new Error('no snapshot yet');
    return v;
  }

  connect(): Promise<void> {
    this.socket = io(this.url, {
      path: SOCKET_PATH,
      auth: { token: this.session.token },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    this.socket.on('room:snapshot', (v: RoomView) => {
      const last = this.snapshots[this.snapshots.length - 1];
      if (!last || v.version >= last.version) this.snapshots.push(v);
      this.notify();
    });
    this.socket.on('game:events', (e: VisibleEvent[]) => {
      this.events.push(...e);
      this.notify();
    });
    this.socket.on('session:ended', (p: { reason: string }) => {
      this.ended.push(p);
      this.notify();
    });
    return new Promise<void>((resolve, reject) => {
      this.socket.once('connect', () => resolve());
      this.socket.once('connect_error', (err) => reject(err));
    }).then(async () => {
      await this.waitFor(() => true);
    });
  }

  disconnect(): void {
    this.socket.disconnect();
  }

  private notify() {
    for (const l of [...this.listeners]) l();
  }

  /** Resolves with the latest snapshot once `predicate` holds. */
  waitFor(predicate: (v: RoomView) => boolean, timeoutMs = 5000, label = 'condition'): Promise<RoomView> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const v = this.snapshots[this.snapshots.length - 1];
        if (v && predicate(v)) {
          cleanup();
          resolve(v);
          return true;
        }
        return false;
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`timed out waiting for ${label}`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.listeners.delete(listener);
      };
      const listener = () => void check();
      this.listeners.add(listener);
      check();
    });
  }

  waitForChange(timeoutMs = 3000): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        resolve();
      }, timeoutMs);
      const listener = () => {
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve();
      };
      this.listeners.add(listener);
    });
  }

  send(command: RoomCommand, actionId: string = randomUUID()): Promise<CommandAck> {
    return this.raw({ actionId, command });
  }

  raw(payload: unknown): Promise<CommandAck> {
    return new Promise((resolve) => this.socket.emit('room:command', payload, (ack: CommandAck) => resolve(ack)));
  }

  async game(action: GameAction, expectedVersion?: number): Promise<CommandAck> {
    const command: RoomCommand = expectedVersion === undefined ? { type: 'game', action } : { type: 'game', action, expectedVersion };
    const ack = await this.send(command);
    if (ack.ok) await this.waitFor((v) => v.version >= ack.version, 3000, `version ${ack.version}`);
    return ack;
  }
}

export async function connectClient(url: string, session: SessionResponse): Promise<TestClient> {
  const c = new TestClient(url, session);
  await c.connect();
  return c;
}

export function expectOk(ack: CommandAck): void {
  if (!ack.ok) throw new Error(`expected ok, got ${ack.error.code}`);
}

/**
 * Plays every connected client with a simple policy until the game finishes:
 * inspect two cards, draw and discard (or replace slot 0 with a taken card),
 * and call Cabo after a few turns.
 */
export async function driveToFinish(clients: TestClient[], caboAfterTurns = 2, timeoutMs = 25_000): Promise<RoomView> {
  const deadline = Date.now() + timeoutMs;
  const turns = new Map<string, number>();
  while (Date.now() < deadline) {
    let acted = false;
    for (const c of clients) {
      const v = c.latest();
      if (v.phase === 'finished') return v;
      const g = v.game;
      if (!g) continue;
      const legal = g.legal;
      let action: GameAction | null = null;
      if (v.nextRound?.waitingFor.includes(c.playerId)) {
        expectOk(await c.send({ type: 'readyNextRound' }));
        acted = true;
        continue;
      }
      if (legal.inspect) action = { type: 'inspect', slots: [0, 1] };
      else if (legal.finishInspection) action = { type: 'finishInspection' };
      else if (legal.acknowledgeReveal) action = { type: 'acknowledgeReveal' };
      else if (legal.drawFromDeck) {
        const key = `${g.round.number}:${c.playerId}`;
        const t = (turns.get(key) ?? 0) + 1;
        turns.set(key, t);
        action = legal.callCabo && t > caboAfterTurns ? { type: 'callCabo' } : { type: 'drawFromDeck' };
      } else if (legal.discardDrawn) action = { type: 'discardDrawn' };
      else if (legal.replaceSlots.length > 0) action = { type: 'replace', slot: legal.replaceSlots[0]! };
      if (action) {
        const ack = await c.game(action);
        if (!ack.ok && ack.error.code !== 'STALE_VERSION') throw new Error(`${action.type} rejected: ${ack.error.code}`);
        acted = true;
      }
    }
    if (!acted) await Promise.race(clients.map((c) => c.waitForChange(1000)));
  }
  throw new Error('game did not finish in time');
}
