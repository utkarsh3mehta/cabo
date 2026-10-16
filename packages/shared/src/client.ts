/**
 * Browser entry point: everything the web client needs without pulling the
 * Zod schemas into the bundle. Types are re-exported from the full module.
 */
export * from './cards.js';
export * from './errors.js';
export * from './events.js';
export * from './limits.js';
export * from './transport.js';
export * from './views.js';
export type { CreateRoomRequest, JoinRoomRequest, RoomCommand, RoomCommandType, CommandEnvelope } from './protocol.js';
export type { GameAction, GameActionType, PlayerId, SlotRef } from './actions.js';
