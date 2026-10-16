import type { RoomView, VisibleEvent } from '@cabo/shared/client';
import { describe, expect, it } from 'vitest';
import { describeEvent, nameLookup, recentlyChangedSlots } from '../src/lib/describe';

const view = {
  you: { playerId: 'me', isHost: true },
  participants: [
    { playerId: 'me', name: 'Sam' },
    { playerId: 'p2', name: 'Juno' },
    { playerId: 'p3', name: 'Lis' },
  ],
} as unknown as RoomView;
const name = nameLookup(view);

describe('activity descriptions', () => {
  it('never describe private information', () => {
    const privateEvents: VisibleEvent[] = [
      { type: 'initialPeek', cards: [{ slot: 0, value: 4 }, { slot: 1, value: 9 }] },
      { type: 'drawnCard', value: 7 },
      { type: 'revealed', ability: 'spy', target: { playerId: 'p2', slot: 1 }, value: 12 },
    ];
    for (const e of privateEvents) expect(describeEvent(e, name)).toBeNull();
  });

  it('describe public moves without naming hidden values', () => {
    expect(describeEvent({ type: 'drewFromDeck', player: 'p2' }, name)).toBe('Juno drew from the draw pile.');
    expect(describeEvent({ type: 'inspected', player: 'p2', ability: 'peek', target: { playerId: 'p2', slot: 0 } }, name)).toBe(
      'Juno used Peek on their own top left card.',
    );
    expect(describeEvent({ type: 'inspected', player: 'me', ability: 'spy', target: { playerId: 'p3', slot: 3 } }, name)).toBe(
      'You used Spy on Lis’ bottom right card.',
    );
    expect(describeEvent({ type: 'replaced', player: 'me', slot: 2, source: 'deck', discardedValue: 11, placedValue: null }, name)).toBe(
      'You replaced your bottom left card and discarded a 11.',
    );
    expect(describeEvent({ type: 'swapped', player: 'p2', own: { playerId: 'p2', slot: 1 }, other: { playerId: 'me', slot: 0 } }, name)).toBe(
      'Juno swapped their top right card with your top left card.',
    );
  });
});

describe('recently changed slots', () => {
  it('covers only the last completed turn', () => {
    const events: VisibleEvent[] = [
      { type: 'turnStarted', player: 'p2' },
      { type: 'replaced', player: 'p2', slot: 0, source: 'deck', discardedValue: 3, placedValue: null },
      { type: 'turnStarted', player: 'p3' },
      { type: 'swapped', player: 'p3', own: { playerId: 'p3', slot: 1 }, other: { playerId: 'me', slot: 2 } },
      { type: 'turnStarted', player: 'me' },
    ];
    expect([...recentlyChangedSlots(events)].sort()).toEqual(['me:2', 'p3:1']);
  });
});
