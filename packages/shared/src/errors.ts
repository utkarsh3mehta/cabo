/**
 * Error codes returned to clients. Messages are fixed strings so that no
 * internal detail (and certainly no hidden card) can leak through an error.
 */
export const ERROR_MESSAGES = {
  // Rooms and sessions
  ROOM_NOT_FOUND: 'That room does not exist or has closed.',
  INVALID_ROOM_CODE: 'Room codes are 6 letters or digits.',
  ROOM_FULL: 'That room is full.',
  GAME_IN_PROGRESS: 'That game has already started.',
  INVALID_NAME: 'That display name is not allowed.',
  INVALID_SESSION: 'Your session is not valid for this room.',
  SEAT_TAKEN_OVER: 'Your seat was handed to a bot after you were disconnected. It is no longer yours for this game.',
  SERVER_FULL: 'The server is busy. Please try again later.',
  RATE_LIMITED: 'Too many requests. Please slow down.',
  INVALID_PAYLOAD: 'The request was not understood.',
  // Host and lobby
  NOT_HOST: 'Only the host can do that.',
  NOT_ENOUGH_PLAYERS: 'At least 2 participants are needed to start.',
  TOO_MANY_PLAYERS: 'At most 5 participants can play.',
  BOTS_NOT_ALLOWED: 'Bots are turned off for this room.',
  PLAYER_NOT_FOUND: 'That participant is not in this room.',
  NOT_REPLACEABLE: 'That player cannot be replaced right now.',
  WRONG_ROOM_PHASE: 'That is not possible at this stage of the room.',
  // Game rules
  NOT_YOUR_TURN: 'It is not your turn.',
  WRONG_PHASE: 'That move is not possible right now.',
  ILLEGAL_ACTION: 'That move is not allowed.',
  INVALID_TARGET: 'That card cannot be chosen.',
  ALREADY_DONE: 'You have already done that.',
  STALE_VERSION: 'The table changed before your move arrived. Please try again.',
  // Fallback
  INTERNAL_ERROR: 'Something went wrong on the server.',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export interface SafeError {
  code: ErrorCode;
  message: string;
}

export function safeError(code: ErrorCode): SafeError {
  return { code, message: ERROR_MESSAGES[code] };
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, value);
}
