import { describe, expect, it } from 'vitest';
import {
  CARD_INVENTORY,
  CARD_VALUES,
  DECK_SIZE,
  abilityForValue,
  commandEnvelopeSchema,
  createRoomRequestSchema,
  gameActionSchema,
  normalizeDisplayName,
  normalizeRoomCode,
} from '../src/index.js';

describe('card inventory', () => {
  it('has 52 cards: two 0s, four of each 1–12, two 13s', () => {
    const total = CARD_VALUES.reduce<number>((sum, v) => sum + CARD_INVENTORY[v], 0);
    expect(total).toBe(DECK_SIZE);
    expect(CARD_INVENTORY[0]).toBe(2);
    expect(CARD_INVENTORY[13]).toBe(2);
    for (let v = 1; v <= 12; v++) expect(CARD_INVENTORY[v as 1]).toBe(4);
  });

  it('maps abilities 7–8 peek, 9–10 spy, 11–12 swap and nothing else', () => {
    const map = Object.fromEntries(CARD_VALUES.map((v) => [v, abilityForValue(v)]));
    expect(map).toEqual({
      0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null,
      7: 'peek', 8: 'peek', 9: 'spy', 10: 'spy', 11: 'swap', 12: 'swap', 13: null,
    });
  });
});

describe('display names', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeDisplayName('  Ada   Lovelace ')).toEqual({ ok: true, name: 'Ada Lovelace' });
  });
  it('rejects empty, too long, non-string and control characters', () => {
    expect(normalizeDisplayName('   ').ok).toBe(false);
    expect(normalizeDisplayName('x'.repeat(21)).ok).toBe(false);
    expect(normalizeDisplayName(42).ok).toBe(false);
    expect(normalizeDisplayName('bad\u0000name').ok).toBe(false);
    expect(normalizeDisplayName(`bidi${String.fromCodePoint(0x202e)}emanl`).ok).toBe(false);
  });
  it('counts characters, not UTF-16 units', () => {
    expect(normalizeDisplayName('🃏'.repeat(20)).ok).toBe(true);
  });
});

describe('room codes', () => {
  it('normalises case and separators', () => {
    expect(normalizeRoomCode('abc-def')).toBe('ABCDEF');
    expect(normalizeRoomCode(' k7m 2p9 ')).toBe('K7M2P9');
  });
  it('rejects ambiguous characters and wrong lengths', () => {
    expect(normalizeRoomCode('ABCDE')).toBeNull();
    expect(normalizeRoomCode('ABCDE0')).toBeNull();
    expect(normalizeRoomCode('ABCDEI')).toBeNull();
    expect(normalizeRoomCode(null)).toBeNull();
  });
});

describe('schemas', () => {
  it('accepts valid game actions', () => {
    expect(gameActionSchema.safeParse({ type: 'match', slots: [0, 3] }).success).toBe(true);
    expect(gameActionSchema.safeParse({ type: 'useSwap', ownSlot: 1, target: { playerId: 'p_x', slot: 2 } }).success).toBe(true);
  });
  it('rejects unknown keys, duplicate slots and out-of-range slots', () => {
    expect(gameActionSchema.safeParse({ type: 'drawFromDeck', playerId: 'someone' }).success).toBe(false);
    expect(gameActionSchema.safeParse({ type: 'match', slots: [1, 1] }).success).toBe(false);
    expect(gameActionSchema.safeParse({ type: 'replace', slot: 4 }).success).toBe(false);
    expect(gameActionSchema.safeParse({ type: 'inspect', slots: [0] }).success).toBe(false);
    expect(gameActionSchema.safeParse({ type: 'peekAtEverything' }).success).toBe(false);
  });
  it('validates command envelopes', () => {
    const ok = commandEnvelopeSchema.safeParse({ actionId: 'abcdefgh-1234', command: { type: 'game', action: { type: 'callCabo' } } });
    expect(ok.success).toBe(true);
    const bad = commandEnvelopeSchema.safeParse({ actionId: 'x', command: { type: 'startGame' } });
    expect(bad.success).toBe(false);
  });
  it('applies defaults to room creation', () => {
    const parsed = createRoomRequestSchema.parse({ name: 'Ada' });
    expect(parsed).toEqual({ name: 'Ada', mode: 'full', allowBots: true });
    expect(createRoomRequestSchema.safeParse({ name: 'Ada', botCount: 5 }).success).toBe(false);
  });
});
