import { z } from 'zod';
import { INITIAL_PEEK_COUNT, type SlotIndex } from './cards.js';

/** Opaque player identifier issued by the server. Never a display name. */
export type PlayerId = string;

export const playerIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

export const slotIndexSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const slotRefSchema = z.strictObject({
  playerId: playerIdSchema,
  slot: slotIndexSchema,
});

export interface SlotRef {
  playerId: PlayerId;
  slot: SlotIndex;
}

const distinct = (slots: readonly number[]) => new Set(slots).size === slots.length;

/**
 * Every in-game move a participant can submit. The acting player is never part
 * of the payload: the server always uses the identity bound to the connection.
 */
export const gameActionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('inspect'),
    slots: z
      .array(slotIndexSchema)
      .length(INITIAL_PEEK_COUNT)
      .refine(distinct, { message: 'Slots must be different' }),
  }),
  z.strictObject({ type: z.literal('finishInspection') }),
  z.strictObject({ type: z.literal('drawFromDeck') }),
  z.strictObject({ type: z.literal('takeDiscard') }),
  z.strictObject({ type: z.literal('callCabo') }),
  z.strictObject({ type: z.literal('replace'), slot: slotIndexSchema }),
  z.strictObject({
    type: z.literal('match'),
    slots: z.array(slotIndexSchema).min(2).max(4).refine(distinct, { message: 'Slots must be different' }),
  }),
  z.strictObject({ type: z.literal('discardDrawn') }),
  z.strictObject({ type: z.literal('usePeek'), slot: slotIndexSchema }),
  z.strictObject({ type: z.literal('useSpy'), target: slotRefSchema }),
  z.strictObject({ type: z.literal('useSwap'), ownSlot: slotIndexSchema, target: slotRefSchema }),
  z.strictObject({ type: z.literal('acknowledgeReveal') }),
]);

export type GameAction = z.infer<typeof gameActionSchema>;
export type GameActionType = GameAction['type'];
