import { BOT_NAMES, decideAction, fallbackAction, type BotRng } from '@cabo/bots';
import {
  applyAction,
  createGame,
  getPlayerView,
  playersToAct,
  startNextRound,
  type GameState,
  type Rng,
} from '@cabo/game-engine';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  NAME_MAX_LENGTH,
  eventsVisibleTo,
  normalizeDisplayName,
  safeError,
  type CommandAck,
  type CommandEnvelope,
  type ErrorCode,
  type GameAction,
  type ParticipantKind,
  type ParticipantView,
  type PlayerId,
  type RoomCommand,
  type RoomInfoResponse,
  type RoomPhase,
  type RoomSettings,
  type RoomView,
  type RoutedEvent,
  type SessionEndReason,
  type VisibleEvent,
} from '@cabo/shared';
import { BotRunner } from './botRunner.js';
import type { SessionStore } from './security.js';

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
}

/** Delivers personalised data to a seat's connection(s). Implemented by the socket layer. */
export interface RoomTransport {
  snapshot(roomCode: string, playerId: PlayerId, view: RoomView): void;
  events(roomCode: string, playerId: PlayerId, events: VisibleEvent[]): void;
  /** Ends the seat's connections, or only `socketId` when given. */
  endSession(roomCode: string, playerId: PlayerId, reason: SessionEndReason, socketId?: string): void;
}

export interface RoomDeps {
  graceMs: number;
  botDelayMinMs: number;
  botDelayMaxMs: number;
  gameRng: Rng;
  botRng: BotRng;
  transport: RoomTransport;
  sessions: SessionStore;
  logger: Logger;
  now: () => number;
  generatePlayerId: () => PlayerId;
  /** Called when the last human leaves so the manager can delete the room. */
  onEmpty: (code: string) => void;
}

export interface Participant {
  id: PlayerId;
  name: string;
  kind: ParticipantKind;
  connected: boolean;
  disconnectedAt: number | null;
  takenOverByBot: boolean;
  /** Set when a human explicitly leaves a game in progress; their token is revoked. */
  left: boolean;
  socketId: string | null;
}

export class RoomError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = 'RoomError';
  }
}

const fail = (code: ErrorCode): never => {
  throw new RoomError(code);
};

const ACTION_CACHE_SIZE = 64;
const MAX_ROUND_EVENTS = 10_000;

export class Room {
  readonly createdAt: number;
  lastActivityAt: number;
  /** Last time a human connected, disconnected or sent a command; drives the idle TTL. */
  lastHumanActivityAt: number;
  finishedAt: number | null = null;
  phase: RoomPhase = 'lobby';
  settings: RoomSettings;
  hostId: PlayerId;
  participants: Participant[] = [];
  game: GameState | null = null;
  version = 0;
  disposed = false;

  private readonly nextRoundReady = new Set<PlayerId>();
  private roundEvents: RoutedEvent[] = [];
  private readonly actionCache = new Map<PlayerId, Map<string, CommandAck>>();
  private readonly graceTimers = new Map<PlayerId, ReturnType<typeof setTimeout>>();
  private readonly bots: BotRunner;

  constructor(
    readonly code: string,
    settings: RoomSettings,
    hostName: string,
    private readonly deps: RoomDeps,
  ) {
    this.createdAt = deps.now();
    this.lastActivityAt = this.createdAt;
    this.lastHumanActivityAt = this.createdAt;
    this.settings = { ...settings };
    const host = this.addParticipant(hostName, 'human');
    this.hostId = host.id;
    this.bots = new BotRunner({
      rng: deps.botRng,
      delayMinMs: deps.botDelayMinMs,
      delayMaxMs: deps.botDelayMaxMs,
      act: (botId) => this.runBot(botId),
    });
  }

  // -------------------------------------------------------------------------
  // Participants
  // -------------------------------------------------------------------------

  participant(id: PlayerId): Participant | undefined {
    return this.participants.find((p) => p.id === id);
  }

  private activeHumans(): Participant[] {
    return this.participants.filter((p) => p.kind === 'human' && !p.takenOverByBot);
  }

  connectedHumanCount(): number {
    return this.activeHumans().filter((p) => p.connected).length;
  }

  private uniqueName(name: string, excludeId?: PlayerId): string {
    const taken = (n: string) =>
      this.participants.some((p) => p.id !== excludeId && p.name.toLocaleLowerCase() === n.toLocaleLowerCase());
    if (!taken(name)) return name;
    for (let i = 2; i < 100; i++) {
      const suffix = ` ${i}`;
      const base = [...name].slice(0, NAME_MAX_LENGTH - suffix.length).join('');
      if (!taken(base + suffix)) return base + suffix;
    }
    return name;
  }

  private addParticipant(name: string, kind: ParticipantKind): Participant {
    const p: Participant = {
      id: this.deps.generatePlayerId(),
      name: this.uniqueName(name),
      kind,
      connected: kind === 'bot',
      disconnectedAt: kind === 'human' ? this.deps.now() : null,
      takenOverByBot: false,
      left: false,
      socketId: null,
    };
    this.participants.push(p);
    return p;
  }

  /** Seats a new guest. Only possible in the lobby with a free seat. */
  addHuman(rawName: string): Participant {
    if (this.phase !== 'lobby') fail('GAME_IN_PROGRESS');
    if (this.participants.length >= MAX_PLAYERS) fail('ROOM_FULL');
    const name = normalizeDisplayName(rawName);
    if (!name.ok) return fail('INVALID_NAME');
    const p = this.addParticipant(name.name, 'human');
    this.commit();
    return p;
  }

  private addBotSeat(): Participant {
    if (!this.settings.allowBots) fail('BOTS_NOT_ALLOWED');
    if (this.participants.length >= MAX_PLAYERS) fail('ROOM_FULL');
    const used = new Set(this.participants.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.participants.length + 1}`;
    return this.addParticipant(name, 'bot');
  }

  /** Used for solo games: seats bots without a host command. */
  seatBots(count: number): void {
    for (let i = 0; i < count; i++) this.addBotSeat();
    this.commit();
  }

  private removeParticipant(id: PlayerId): void {
    this.participants = this.participants.filter((p) => p.id !== id);
    this.actionCache.delete(id);
    this.nextRoundReady.delete(id);
    this.clearGraceTimer(id);
    this.bots.remove(id);
  }

  // -------------------------------------------------------------------------
  // Connections
  // -------------------------------------------------------------------------

  attach(playerId: PlayerId, socketId: string): void {
    const p = this.participant(playerId);
    if (!p || p.kind !== 'human' || p.takenOverByBot) return;
    if (p.socketId && p.socketId !== socketId) {
      this.deps.transport.endSession(this.code, playerId, 'replacedByNewConnection', p.socketId);
    }
    this.lastHumanActivityAt = this.deps.now();
    p.socketId = socketId;
    p.connected = true;
    p.disconnectedAt = null;
    this.clearGraceTimer(playerId);
    const host = this.participant(this.hostId);
    const hostUsable = host && host.kind === 'human' && !host.takenOverByBot;
    const hostGone = !hostUsable || (!host.connected && this.graceExpired(host));
    if (hostGone) this.hostId = playerId;
    this.commit();
  }

  detach(playerId: PlayerId, socketId: string): void {
    const p = this.participant(playerId);
    if (!p || p.socketId !== socketId) return;
    this.lastHumanActivityAt = this.deps.now();
    p.socketId = null;
    p.connected = false;
    p.disconnectedAt = this.deps.now();
    this.scheduleGraceTimer(playerId);
    this.commit();
  }

  private graceExpired(p: Participant): boolean {
    return !p.connected && p.disconnectedAt !== null && this.deps.now() - p.disconnectedAt >= this.deps.graceMs;
  }

  private scheduleGraceTimer(playerId: PlayerId): void {
    this.clearGraceTimer(playerId);
    const timer = setTimeout(() => {
      this.graceTimers.delete(playerId);
      if (this.disposed) return;
      this.ensureHost();
      this.commit();
    }, this.deps.graceMs + 5);
    timer.unref?.();
    this.graceTimers.set(playerId, timer);
  }

  private clearGraceTimer(playerId: PlayerId): void {
    const t = this.graceTimers.get(playerId);
    if (t) clearTimeout(t);
    this.graceTimers.delete(playerId);
  }

  /**
   * Host policy (ARCHITECTURE.md §5.4): a disconnected host keeps the role
   * during the grace period; afterwards it passes to the connected human with
   * the lowest seat.
   */
  private ensureHost(): void {
    const host = this.participant(this.hostId);
    const hostUsable = !!host && host.kind === 'human' && !host.takenOverByBot;
    if (hostUsable && (host.connected || !this.graceExpired(host))) return;
    const candidate = this.activeHumans().find((p) => p.connected && p.id !== this.hostId);
    if (candidate) {
      this.hostId = candidate.id;
      return;
    }
    if (!hostUsable) {
      const anyHuman = this.activeHumans()[0];
      if (anyHuman) this.hostId = anyHuman.id;
    }
  }

  // -------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------

  viewFor(playerId: PlayerId): RoomView {
    const participants: ParticipantView[] = this.participants.map((p, seat) => ({
      playerId: p.id,
      name: p.name,
      kind: p.kind,
      seat,
      connected: p.connected,
      isHost: p.id === this.hostId,
      graceExpired: p.kind === 'human' && this.graceExpired(p),
      takenOverByBot: p.takenOverByBot,
    }));
    const game = this.game ? getPlayerView(this.game, playerId) : null;
    let nextRound: RoomView['nextRound'] = null;
    if (this.game?.phase === 'roundComplete') {
      nextRound = { ready: [...this.nextRoundReady], waitingFor: this.waitingForNextRound() };
    }
    return {
      code: this.code,
      version: this.version,
      phase: this.phase,
      you: { playerId, isHost: playerId === this.hostId },
      settings: { ...this.settings },
      participants,
      game,
      nextRound,
      limits: { minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, reconnectGraceMs: this.deps.graceMs },
    };
  }

  info(): RoomInfoResponse {
    return {
      code: this.code,
      phase: this.phase,
      seatsTaken: this.participants.length,
      maxSeats: MAX_PLAYERS,
      joinable: this.phase === 'lobby' && this.participants.length < MAX_PLAYERS,
    };
  }

  sendSnapshot(playerId: PlayerId): void {
    this.deps.transport.snapshot(this.code, playerId, this.viewFor(playerId));
  }

  // -------------------------------------------------------------------------
  // Commit and broadcast
  // -------------------------------------------------------------------------

  private commit(events: RoutedEvent[] = []): void {
    if (this.disposed) return;
    this.version++;
    this.lastActivityAt = this.deps.now();
    if (events.some((e) => e.event.type === 'roundStarted')) this.roundEvents = [];
    if (this.roundEvents.length + events.length <= MAX_ROUND_EVENTS) this.roundEvents.push(...events);
    this.bots.observe(events);
    for (const p of this.activeHumans()) {
      if (!p.connected) continue;
      this.deps.transport.snapshot(this.code, p.id, this.viewFor(p.id));
      if (events.length > 0) {
        const visible = eventsVisibleTo(events, p.id);
        if (visible.length > 0) this.deps.transport.events(this.code, p.id, visible);
      }
    }
    this.afterCommit();
  }

  private afterCommit(): void {
    if (this.phase !== 'playing' || !this.game) return;
    if (this.game.phase === 'roundComplete' && this.waitingForNextRound().length === 0) {
      this.startNextRoundNow();
      return;
    }
    this.bots.schedule(playersToAct(this.game));
  }

  private waitingForNextRound(): PlayerId[] {
    return this.activeHumans()
      .filter((p) => p.connected && !this.nextRoundReady.has(p.id))
      .map((p) => p.id);
  }

  private startNextRoundNow(): void {
    if (!this.game) return;
    const result = startNextRound(this.game, { rng: this.deps.gameRng });
    if (!result.ok) return;
    this.nextRoundReady.clear();
    this.game = result.state;
    this.commit(result.events);
  }

  private applyGameState(state: GameState, events: RoutedEvent[]): void {
    this.game = state;
    if (state.phase === 'gameComplete') {
      this.phase = 'finished';
      this.finishedAt = this.deps.now();
      this.bots.cancelAll();
    }
    this.commit(events);
  }

  // -------------------------------------------------------------------------
  // Bots
  // -------------------------------------------------------------------------

  private runBot(botId: PlayerId): void {
    if (this.disposed || this.phase !== 'playing' || !this.game) return;
    if (!playersToAct(this.game).includes(botId)) return;
    const memory = this.bots.memory(botId);
    if (!memory) return;
    const view = getPlayerView(this.game, botId);
    const chosen = decideAction(view, memory, this.deps.botRng) ?? fallbackAction(view);
    if (!chosen) return;
    let result = applyAction(this.game, botId, chosen, { rng: this.deps.gameRng });
    if (!result.ok) {
      this.deps.logger.warn({ room: this.code, bot: botId, action: chosen.type, code: result.error.code }, 'bot action rejected');
      const fallback = fallbackAction(view);
      if (fallback) result = applyAction(this.game, botId, fallback, { rng: this.deps.gameRng });
    }
    if (!result.ok) {
      this.deps.logger.error({ room: this.code, bot: botId, code: result.error.code }, 'bot could not act');
      return;
    }
    this.applyGameState(result.state, result.events);
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  /** Validated, serialised entry point for every client command. Synchronous, so commands never interleave. */
  handleCommand(playerId: PlayerId, envelope: CommandEnvelope): CommandAck {
    if (this.disposed) return { ok: false, error: safeError('ROOM_NOT_FOUND') };
    const actor = this.participant(playerId);
    if (!actor || actor.kind !== 'human' || actor.takenOverByBot) return { ok: false, error: safeError('INVALID_SESSION') };
    this.lastHumanActivityAt = this.deps.now();

    let cache = this.actionCache.get(playerId);
    const cached = cache?.get(envelope.actionId);
    if (cached) return cached.ok ? { ...cached, duplicate: true } : cached;

    let ack: CommandAck;
    try {
      this.execute(actor, envelope.command);
      ack = { ok: true, version: this.version };
    } catch (err) {
      if (err instanceof RoomError) {
        ack = { ok: false, error: safeError(err.code) };
      } else {
        this.deps.logger.error({ room: this.code, command: envelope.command.type, err: (err as Error)?.message }, 'command failed');
        ack = { ok: false, error: safeError('INTERNAL_ERROR') };
      }
    }
    if (!this.participant(playerId)) return ack; // the actor left; nothing to cache
    if (!cache) {
      cache = new Map();
      this.actionCache.set(playerId, cache);
    }
    cache.set(envelope.actionId, ack);
    if (cache.size > ACTION_CACHE_SIZE) cache.delete(cache.keys().next().value as string);
    return ack;
  }

  private requireHost(actor: Participant): void {
    if (actor.id !== this.hostId) fail('NOT_HOST');
  }

  private requirePhase(phase: RoomPhase): void {
    if (this.phase !== phase) fail('WRONG_ROOM_PHASE');
  }

  private execute(actor: Participant, command: RoomCommand): void {
    switch (command.type) {
      case 'setName': {
        this.requirePhase('lobby');
        const name = normalizeDisplayName(command.name);
        if (!name.ok) fail('INVALID_NAME');
        else actor.name = this.uniqueName(name.name, actor.id);
        this.commit();
        return;
      }
      case 'updateSettings': {
        this.requireHost(actor);
        this.requirePhase('lobby');
        if (command.mode) this.settings.mode = command.mode;
        if (command.allowBots !== undefined) {
          this.settings.allowBots = command.allowBots;
          if (!command.allowBots) for (const p of this.participants.filter((x) => x.kind === 'bot')) this.removeParticipant(p.id);
        }
        this.commit();
        return;
      }
      case 'addBot':
        this.requireHost(actor);
        this.requirePhase('lobby');
        this.addBotSeat();
        this.commit();
        return;
      case 'removeBot': {
        this.requireHost(actor);
        this.requirePhase('lobby');
        const target = this.participant(command.playerId);
        if (!target || target.kind !== 'bot') fail('PLAYER_NOT_FOUND');
        this.removeParticipant(command.playerId);
        this.commit();
        return;
      }
      case 'startGame':
        this.requireHost(actor);
        this.requirePhase('lobby');
        this.startGame();
        return;
      case 'game':
        this.handleGameAction(actor, command.action, command.expectedVersion);
        return;
      case 'readyNextRound':
        this.requirePhase('playing');
        if (this.game?.phase !== 'roundComplete') fail('WRONG_PHASE');
        this.nextRoundReady.add(actor.id);
        this.commit();
        return;
      case 'replaceWithBot':
        this.replaceWithBot(actor, command.playerId);
        return;
      case 'returnToLobby':
        this.requireHost(actor);
        this.requirePhase('finished');
        this.returnToLobby();
        return;
      case 'leave':
        this.leave(actor);
        return;
    }
  }

  private startGame(): void {
    const n = this.participants.length;
    if (n < MIN_PLAYERS) fail('NOT_ENOUGH_PLAYERS');
    if (n > MAX_PLAYERS) fail('TOO_MANY_PLAYERS');
    const { state, events } = createGame(
      { players: this.participants.map((p) => p.id), mode: this.settings.mode },
      { rng: this.deps.gameRng },
    );
    this.game = state;
    this.phase = 'playing';
    this.finishedAt = null;
    this.nextRoundReady.clear();
    this.bots.reset(this.participants.filter((p) => p.kind === 'bot').map((p) => p.id));
    this.deps.logger.info({ room: this.code, players: n, mode: this.settings.mode }, 'game started');
    this.commit(events);
  }

  private handleGameAction(actor: Participant, action: GameAction, expectedVersion: number | undefined): void {
    this.requirePhase('playing');
    if (!this.game) return fail('WRONG_PHASE');
    if (expectedVersion !== undefined && expectedVersion !== this.version) fail('STALE_VERSION');
    const result = applyAction(this.game, actor.id, action, { rng: this.deps.gameRng });
    if (!result.ok) return fail(result.error.code);
    this.applyGameState(result.state, result.events);
  }

  private replaceWithBot(actor: Participant, targetId: PlayerId): void {
    this.requireHost(actor);
    this.requirePhase('playing');
    if (!this.settings.allowBots) fail('BOTS_NOT_ALLOWED');
    const target = this.participant(targetId);
    if (!target) return fail('PLAYER_NOT_FOUND');
    if (target.kind !== 'human' || target.takenOverByBot || target.connected || !this.graceExpired(target)) {
      fail('NOT_REPLACEABLE');
    }
    target.kind = 'bot';
    target.takenOverByBot = true;
    target.connected = true;
    target.socketId = null;
    this.clearGraceTimer(target.id);
    this.nextRoundReady.delete(target.id);
    // The token stays resolvable so a returning player is told SEAT_TAKEN_OVER;
    // the socket layer refuses to attach it to a taken-over seat.
    this.deps.transport.endSession(this.code, target.id, 'seatTakenOver');
    this.bots.add(target.id, eventsVisibleTo(this.roundEvents, target.id));
    this.deps.logger.info({ room: this.code, player: target.id }, 'seat taken over by bot');
    this.ensureHost();
    this.commit();
  }

  private returnToLobby(): void {
    for (const p of this.participants.filter((x) => x.takenOverByBot)) this.removeParticipant(p.id);
    this.phase = 'lobby';
    this.game = null;
    this.finishedAt = null;
    this.roundEvents = [];
    this.nextRoundReady.clear();
    this.bots.reset([]);
    this.ensureHost();
    this.commit();
  }

  private leave(actor: Participant): void {
    this.deps.sessions.revokeSeat(this.code, actor.id);
    this.deps.transport.endSession(this.code, actor.id, 'left');
    if (this.phase === 'playing') {
      // The seat stays in the game and can be handed to a bot by the host straight away.
      actor.left = true;
      actor.connected = false;
      actor.socketId = null;
      actor.disconnectedAt = this.deps.now() - this.deps.graceMs;
      this.nextRoundReady.delete(actor.id);
    } else {
      this.removeParticipant(actor.id);
    }
    if (this.activeHumans().every((p) => p.left)) {
      this.deps.onEmpty(this.code);
      return;
    }
    this.ensureHost();
    this.commit();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  dispose(reason: SessionEndReason = 'roomClosed'): void {
    if (this.disposed) return;
    for (const p of this.activeHumans()) {
      if (p.connected) this.deps.transport.endSession(this.code, p.id, reason);
    }
    this.disposed = true;
    this.bots.cancelAll();
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
    this.deps.sessions.revokeRoom(
      this.code,
      this.participants.map((p) => p.id),
    );
  }
}
