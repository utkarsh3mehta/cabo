export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;
export const MAX_SOLO_BOTS = MAX_PLAYERS - 1;

export const NAME_MIN_LENGTH = 1;
export const NAME_MAX_LENGTH = 20;

export const ROOM_CODE_LENGTH = 6;
/** Uppercase letters and digits without the easily confused I, L, O, 0 and 1. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const ACTION_ID_MAX_LENGTH = 64;

/**
 * Control characters, zero-width/format characters and bidirectional
 * overrides are rejected so names cannot hide text or reorder the UI.
 */
function hasForbiddenNameChar(value: string): boolean {
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) return true;
    if (cp >= 0x200b && cp <= 0x200f) return true;
    if (cp >= 0x2028 && cp <= 0x202e) return true;
    if (cp >= 0x2060 && cp <= 0x206f) return true;
    if (cp === 0xfeff) return true;
  }
  return false;
}

export type NameCheck = { ok: true; name: string } | { ok: false; reason: string };

/**
 * Normalises and validates a guest display name. Used on both the client (for
 * immediate feedback) and the server (authoritative).
 */
export function normalizeDisplayName(raw: unknown): NameCheck {
  if (typeof raw !== 'string') return { ok: false, reason: 'Enter a name.' };
  if (raw.length > 200) return { ok: false, reason: `Names can be at most ${NAME_MAX_LENGTH} characters.` };
  if (hasForbiddenNameChar(raw)) return { ok: false, reason: 'Names cannot contain control or invisible characters.' };
  const name = raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const length = [...name].length;
  if (length < NAME_MIN_LENGTH) return { ok: false, reason: 'Enter a name.' };
  if (length > NAME_MAX_LENGTH) return { ok: false, reason: `Names can be at most ${NAME_MAX_LENGTH} characters.` };
  return { ok: true, name };
}

/** Accepts user input such as "abc-def" or " ABCDEF " and returns the canonical code, or null. */
export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 32) return null;
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) {
    if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  }
  return code;
}
