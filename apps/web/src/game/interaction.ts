import type { GameView, PlayerId, SlotIndex, SlotRef } from '@cabo/shared/client';
import { useEffect, useState } from 'react';

/** Client-side selection state for multi-step moves. Purely presentational. */
export type Mode =
  | { kind: 'idle' }
  | { kind: 'inspect'; slots: SlotIndex[] }
  | { kind: 'hold'; slots: SlotIndex[] }
  | { kind: 'peek' }
  | { kind: 'spy' }
  | { kind: 'swap'; own: SlotIndex | null; other: SlotRef | null }
  | { kind: 'confirmCabo' };

export function defaultMode(game: GameView | null): Mode {
  if (!game || game.phase !== 'round') return { kind: 'idle' };
  if (game.legal.inspect) return { kind: 'inspect', slots: [] };
  if (game.legal.replaceSlots.length > 0) return { kind: 'hold', slots: [] };
  return { kind: 'idle' };
}

/** A key that changes whenever the server moves the player into a new decision point. */
function decisionKey(game: GameView | null): string {
  if (!game) return 'none';
  const r = game.round;
  return [game.phase, r.number, r.phase, r.activePlayer, r.step?.kind, game.legal.inspect, game.legal.finishInspection, game.legal.drawFromDeck].join('|');
}

export function useInteraction(game: GameView | null) {
  const [mode, setMode] = useState<Mode>(() => defaultMode(game));
  const key = decisionKey(game);
  useEffect(() => {
    setMode(defaultMode(game));
    // Only reset when the decision point changes, not on every snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const me = game?.viewer;

  function toggle(list: SlotIndex[], slot: SlotIndex, max: number): SlotIndex[] {
    if (list.includes(slot)) return list.filter((s) => s !== slot);
    if (list.length >= max) return list;
    return [...list, slot];
  }

  function select(owner: PlayerId, slot: SlotIndex): { peek?: SlotIndex; spy?: SlotRef } | void {
    switch (mode.kind) {
      case 'inspect':
        if (owner === me) setMode({ kind: 'inspect', slots: toggle(mode.slots, slot, 2) });
        return;
      case 'hold':
        if (owner === me) setMode({ kind: 'hold', slots: toggle(mode.slots, slot, 4) });
        return;
      case 'peek':
        if (owner === me) return { peek: slot };
        return;
      case 'spy':
        if (owner !== me) return { spy: { playerId: owner, slot } };
        return;
      case 'swap':
        if (owner === me) setMode({ ...mode, own: mode.own === slot ? null : slot });
        else {
          const same = mode.other?.playerId === owner && mode.other.slot === slot;
          setMode({ ...mode, other: same ? null : { playerId: owner, slot } });
        }
        return;
      default:
        return;
    }
  }

  return { mode, setMode, select };
}
