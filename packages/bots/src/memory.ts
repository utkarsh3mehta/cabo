import { SLOT_INDICES, type CardValue, type GameView, type PlayerId, type SlotIndex, type VisibleEvent } from '@cabo/shared';

const key = (playerId: PlayerId, slot: SlotIndex) => `${playerId}:${slot}`;

/**
 * What a bot remembers about face-down cards, keyed by table position.
 *
 * It is built only from events routed to the bot's seat and from the bot's own
 * player view — the same information a human in that seat receives. Unknown
 * cards are simply absent; nothing here can read the real hidden state.
 */
export class BotMemory {
  private readonly known = new Map<string, CardValue>();
  /** The value of the card this bot currently holds, if it drew or took one. */
  private held: CardValue | null = null;
  /** Number of turns this bot has started in the current round. */
  turnsThisRound = 0;

  constructor(readonly self: PlayerId) {}

  get(playerId: PlayerId, slot: SlotIndex): CardValue | undefined {
    return this.known.get(key(playerId, slot));
  }

  knownCount(): number {
    return this.known.size;
  }

  private set(playerId: PlayerId, slot: SlotIndex, value: CardValue | null | undefined): void {
    if (value === null || value === undefined) this.known.delete(key(playerId, slot));
    else this.known.set(key(playerId, slot), value);
  }

  private clear(): void {
    this.known.clear();
    this.held = null;
    this.turnsThisRound = 0;
  }

  observe(event: VisibleEvent): void {
    switch (event.type) {
      case 'roundStarted':
      case 'roundEnded':
        this.clear();
        break;
      case 'initialPeek':
        for (const c of event.cards) this.set(this.self, c.slot, c.value);
        break;
      case 'turnStarted':
        if (event.player === this.self) this.turnsThisRound++;
        break;
      case 'drawnCard':
        this.held = event.value;
        break;
      case 'tookDiscard':
        if (event.player === this.self) this.held = event.value;
        break;
      case 'replaced': {
        const placed = event.player === this.self ? this.held : event.placedValue;
        this.set(event.player, event.slot, placed);
        if (event.player === this.self) this.held = null;
        break;
      }
      case 'discardedDrawn':
        if (event.player === this.self) this.held = null;
        break;
      case 'revealed':
        this.set(event.target.playerId, event.target.slot, event.value);
        break;
      case 'swapped': {
        const a = this.get(event.own.playerId, event.own.slot);
        const b = this.get(event.other.playerId, event.other.slot);
        this.set(event.own.playerId, event.own.slot, b);
        this.set(event.other.playerId, event.other.slot, a);
        break;
      }
      case 'matchSucceeded': {
        for (const slot of event.slots) this.set(event.player, slot, null);
        const placed = event.player === this.self ? this.held : event.placedValue;
        this.set(event.player, event.keptSlot, placed);
        if (event.player === this.self) this.held = null;
        break;
      }
      case 'matchFailed':
        // Everyone saw these cards before they went back face down.
        for (const r of event.revealed) this.set(event.player, r.slot, r.value);
        if (event.player === this.self) this.held = null;
        break;
      default:
        break;
    }
  }

  /** Reconciles memory with the bot's current view (empty slots, visible values). */
  syncWithView(view: GameView): void {
    for (const seat of view.round.table) {
      for (const slot of SLOT_INDICES) {
        const s = seat.slots[slot];
        if (!s?.occupied) this.set(seat.playerId, slot, null);
        else if (s.value !== undefined) this.set(seat.playerId, slot, s.value);
      }
    }
    const step = view.round.step;
    if (step?.kind === 'holding' && view.round.activePlayer === this.self && step.value !== undefined) {
      this.held = step.value;
    }
  }
}
