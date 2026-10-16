import type { ParticipantView, PlayerId, RoomView, SlotIndex, SlotRef, VisibleEvent } from '@cabo/shared/client';

export const SLOT_LABELS: Record<SlotIndex, string> = {
  0: 'top left',
  1: 'top right',
  2: 'bottom left',
  3: 'bottom right',
};

export type NameLookup = (id: PlayerId | null | undefined) => string;

export function nameLookup(view: RoomView | null): NameLookup {
  const byId = new Map<PlayerId, ParticipantView>((view?.participants ?? []).map((p) => [p.playerId, p]));
  const me = view?.you.playerId;
  return (id) => {
    if (!id) return 'Someone';
    if (id === me) return 'You';
    return byId.get(id)?.name ?? 'A player';
  };
}

function possessive(name: string): string {
  if (name === 'You') return 'your';
  return name.endsWith('s') ? `${name}’` : `${name}’s`;
}

/** "their own top left card" when the actor targets themselves, otherwise "Juno’s top left card". */
function cardOf(ref: SlotRef, name: NameLookup, actor?: PlayerId): string {
  if (actor !== undefined && ref.playerId === actor) {
    return `${name(actor) === 'You' ? 'your own' : 'their own'} ${SLOT_LABELS[ref.slot]} card`;
  }
  return `${possessive(name(ref.playerId))} ${SLOT_LABELS[ref.slot]} card`;
}

function ownSlot(player: PlayerId, slot: SlotIndex, name: NameLookup): string {
  return `${name(player) === 'You' ? 'your' : 'their'} ${SLOT_LABELS[slot]} card`;
}

/**
 * Describes a public event in one line. Private values (a drawn card, a peeked
 * card) are deliberately left out so the log never becomes a memory aid.
 */
export function describeEvent(e: VisibleEvent, name: NameLookup): string | null {
  switch (e.type) {
    case 'roundStarted':
      return `Round ${e.round} begins. ${name(e.startingPlayer) === 'You' ? 'You start' : `${name(e.startingPlayer)} starts`}.`;
    case 'turnStarted':
      return null;
    case 'inspectionFinished':
      return null;
    case 'drewFromDeck':
      return `${name(e.player)} drew from the draw pile.`;
    case 'tookDiscard':
      return `${name(e.player)} took the ${e.value} from the discard pile.`;
    case 'replaced':
      return `${name(e.player)} replaced ${ownSlot(e.player, e.slot, name)} and discarded a ${e.discardedValue}.`;
    case 'discardedDrawn':
      return `${name(e.player)} discarded a ${e.value}.`;
    case 'inspected':
      return e.ability === 'peek'
        ? `${name(e.player)} used Peek on ${cardOf(e.target, name, e.player)}.`
        : `${name(e.player)} used Spy on ${cardOf(e.target, name, e.player)}.`;
    case 'swapped':
      return `${name(e.player)} swapped ${ownSlot(e.player, e.own.slot, name)} with ${cardOf(e.other, name)}.`;
    case 'matchSucceeded':
      return `${name(e.player)} matched ${e.slots.length} × ${e.value}.`;
    case 'matchFailed':
      return `${name(e.player)} tried to match ${e.revealed.map((r) => r.value).join(', ')}, which failed. The cards went back face down and the ${e.discardedValue} was discarded.`;
    case 'caboCalled':
      return `${name(e.player)} called Cabo! Everyone else gets one more turn.`;
    case 'deckReshuffled':
      return 'The draw pile ran out: the discard pile was shuffled into a new draw pile.';
    case 'roundEnded':
      return `Round ${e.result.roundNumber} is over.`;
    case 'gameEnded':
      return 'The game is over.';
    case 'initialPeek':
    case 'drawnCard':
    case 'revealed':
    case 'revealEnded':
      return null;
  }
}

/** Slots touched by the most recent completed turn, for a static "changed" marker. */
export function recentlyChangedSlots(events: VisibleEvent[]): Set<string> {
  const changed = new Set<string>();
  let i = events.length - 1;
  // Skip the current turn's start, then collect until the previous turn start.
  while (i >= 0 && events[i]?.type === 'turnStarted') i--;
  for (; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'turnStarted' || e.type === 'roundStarted') break;
    if (e.type === 'replaced') changed.add(`${e.player}:${e.slot}`);
    if (e.type === 'swapped') {
      changed.add(`${e.own.playerId}:${e.own.slot}`);
      changed.add(`${e.other.playerId}:${e.other.slot}`);
    }
    if (e.type === 'matchSucceeded') changed.add(`${e.player}:${e.keptSlot}`);
    if (e.type === 'matchFailed') for (const r of e.revealed) changed.add(`${e.player}:${r.slot}`);
  }
  return changed;
}
