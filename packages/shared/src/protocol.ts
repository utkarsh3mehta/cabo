import { z } from 'zod';
import { gameActionSchema, playerIdSchema } from './actions.js';
import { ACTION_ID_MAX_LENGTH, MAX_SOLO_BOTS, NAME_MAX_LENGTH } from './limits.js';

export * from './transport.js';

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

export const gameModeSchema = z.enum(['full', 'quick']);

// Names are length-bounded here and fully normalised by normalizeDisplayName.
const rawNameSchema = z.string().min(1).max(NAME_MAX_LENGTH * 4);

export const createRoomRequestSchema = z.strictObject({
  name: rawNameSchema,
  mode: gameModeSchema.default('full'),
  allowBots: z.boolean().default(true),
  /** When set, the room is a solo game: this many bots are seated immediately. */
  botCount: z.int().min(1).max(MAX_SOLO_BOTS).optional(),
});
export type CreateRoomRequest = z.input<typeof createRoomRequestSchema>;

export const joinRoomRequestSchema = z.strictObject({
  name: rawNameSchema,
});
export type JoinRoomRequest = z.infer<typeof joinRoomRequestSchema>;

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------

export const roomCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('setName'), name: rawNameSchema }),
  z
    .strictObject({
      type: z.literal('updateSettings'),
      mode: gameModeSchema.optional(),
      allowBots: z.boolean().optional(),
    })
    .refine((v) => v.mode !== undefined || v.allowBots !== undefined, { message: 'Nothing to update' }),
  z.strictObject({ type: z.literal('addBot') }),
  z.strictObject({ type: z.literal('removeBot'), playerId: playerIdSchema }),
  z.strictObject({ type: z.literal('startGame') }),
  z.strictObject({
    type: z.literal('game'),
    action: gameActionSchema,
    expectedVersion: z.int().min(0).optional(),
  }),
  z.strictObject({ type: z.literal('readyNextRound') }),
  z.strictObject({ type: z.literal('replaceWithBot'), playerId: playerIdSchema }),
  z.strictObject({ type: z.literal('returnToLobby') }),
  z.strictObject({ type: z.literal('leave') }),
]);
export type RoomCommand = z.infer<typeof roomCommandSchema>;
export type RoomCommandType = RoomCommand['type'];

export const commandEnvelopeSchema = z.strictObject({
  actionId: z
    .string()
    .min(8)
    .max(ACTION_ID_MAX_LENGTH)
    .regex(/^[A-Za-z0-9_-]+$/),
  command: roomCommandSchema,
});
export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;

export const socketAuthSchema = z.strictObject({
  token: z
    .string()
    .min(20)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
});
