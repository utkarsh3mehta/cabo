import { createHash, randomBytes, randomInt } from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, type PlayerId } from '@cabo/shared';
import type { Rng } from '@cabo/game-engine';

/** Cryptographically secure randomness for dealing and reshuffling. */
export const cryptoRng: Rng = {
  int(maxExclusive: number): number {
    return randomInt(maxExclusive);
  },
};

export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return code;
}

export function generatePlayerId(): PlayerId {
  return `p_${randomBytes(9).toString('base64url')}`;
}

/** 256-bit bearer credential for reconnecting to a seat. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface SessionBinding {
  roomCode: string;
  playerId: PlayerId;
}

/**
 * Maps session tokens to seats. Only SHA-256 hashes of tokens are stored, so
 * a memory dump or accidental log of this structure does not expose them.
 * Accounts could later be added by issuing bindings from an authenticated
 * identity instead of a guest token, without touching rooms or the engine.
 */
export class SessionStore {
  private readonly byHash = new Map<string, SessionBinding>();
  private readonly hashesBySeat = new Map<string, Set<string>>();

  private seatKey(roomCode: string, playerId: PlayerId) {
    return `${roomCode}:${playerId}`;
  }

  issue(roomCode: string, playerId: PlayerId): string {
    const token = generateSessionToken();
    const hash = hashToken(token);
    this.byHash.set(hash, { roomCode, playerId });
    const key = this.seatKey(roomCode, playerId);
    const set = this.hashesBySeat.get(key) ?? new Set<string>();
    set.add(hash);
    this.hashesBySeat.set(key, set);
    return token;
  }

  resolve(token: string): SessionBinding | null {
    return this.byHash.get(hashToken(token)) ?? null;
  }

  revokeSeat(roomCode: string, playerId: PlayerId): void {
    const key = this.seatKey(roomCode, playerId);
    for (const hash of this.hashesBySeat.get(key) ?? []) this.byHash.delete(hash);
    this.hashesBySeat.delete(key);
  }

  revokeRoom(roomCode: string, playerIds: Iterable<PlayerId>): void {
    for (const p of playerIds) this.revokeSeat(roomCode, p);
  }

  get size(): number {
    return this.byHash.size;
  }
}
