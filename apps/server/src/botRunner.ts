import { BotMemory, type BotRng } from '@cabo/bots';
import { eventsVisibleTo, type PlayerId, type RoutedEvent, type VisibleEvent } from '@cabo/shared';

export interface BotRunnerDeps {
  rng: BotRng;
  delayMinMs: number;
  delayMaxMs: number;
  /** Called when a bot's timer fires; the room decides and applies the move. */
  act: (botId: PlayerId) => void;
}

/**
 * Owns each bot's memory and its pending action timer. A bot is scheduled only
 * after a transition has been committed and broadcast, and it decides from the
 * state as it is when the timer fires.
 */
export class BotRunner {
  private readonly memories = new Map<PlayerId, BotMemory>();
  private readonly timers = new Map<PlayerId, ReturnType<typeof setTimeout>>();

  constructor(private readonly deps: BotRunnerDeps) {}

  /** Starts fresh memories for a new game. */
  reset(botIds: Iterable<PlayerId>): void {
    this.cancelAll();
    this.memories.clear();
    for (const id of botIds) this.memories.set(id, new BotMemory(id));
  }

  /** Adds a bot mid-game, replaying the events its seat was entitled to see this round. */
  add(botId: PlayerId, replay: readonly VisibleEvent[] = []): void {
    const memory = new BotMemory(botId);
    for (const e of replay) memory.observe(e);
    this.memories.set(botId, memory);
  }

  remove(botId: PlayerId): void {
    this.memories.delete(botId);
    const t = this.timers.get(botId);
    if (t) clearTimeout(t);
    this.timers.delete(botId);
  }

  has(botId: PlayerId): boolean {
    return this.memories.has(botId);
  }

  memory(botId: PlayerId): BotMemory | undefined {
    return this.memories.get(botId);
  }

  observe(events: readonly RoutedEvent[]): void {
    if (events.length === 0) return;
    for (const [id, memory] of this.memories) {
      for (const e of eventsVisibleTo(events, id)) memory.observe(e);
    }
  }

  schedule(playersToAct: readonly PlayerId[]): void {
    for (const id of playersToAct) {
      if (!this.memories.has(id) || this.timers.has(id)) continue;
      const span = Math.max(0, this.deps.delayMaxMs - this.deps.delayMinMs);
      const delay = this.deps.delayMinMs + (span > 0 ? this.deps.rng.int(span + 1) : 0);
      const timer = setTimeout(() => {
        this.timers.delete(id);
        this.deps.act(id);
      }, delay);
      timer.unref?.();
      this.timers.set(id, timer);
    }
  }

  cancelAll(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
