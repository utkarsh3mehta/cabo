import type { ParticipantView, PlayerId, ScoreView, SlotIndex, SlotView, TableSeatView } from '@cabo/shared/client';
import { SLOT_LABELS } from '../lib/describe';
import { abilityLabel, CardBack, CardFace, EmptySlot, type CardSize } from './Card';
import { BotIcon, CrownIcon, FlagIcon, OfflineIcon } from './Icons';

export interface SlotState {
  selectable: boolean;
  selected: boolean;
  /** Position in a multi-selection (1-based), shown as a tag. */
  order?: number | undefined;
  changed: boolean;
}

interface SlotButtonProps {
  ownerLabel: string;
  slot: SlotView;
  size: CardSize;
  state: SlotState;
  onSelect?: ((slot: SlotIndex) => void) | undefined;
}

export function SlotButton({ ownerLabel, slot, size, state, onSelect }: SlotButtonProps) {
  const position = SLOT_LABELS[slot.index];
  const content = !slot.occupied ? 'empty slot' : slot.value !== undefined ? `showing ${abilityLabel(slot.value)}` : 'face down';
  const extras = [state.selected ? 'selected' : '', state.changed ? 'just changed' : ''].filter(Boolean).join(', ');
  const label = `${ownerLabel} ${position} card, ${content}${extras ? `, ${extras}` : ''}`;
  const classes = ['slot', size === 'mini' ? 'mini' : '', state.selectable ? 'targetable' : '', state.selected ? 'selected' : '', state.changed ? 'changed' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={classes}
      aria-label={label}
      aria-pressed={state.selectable ? state.selected : undefined}
      disabled={!state.selectable}
      onClick={() => onSelect?.(slot.index)}
      data-slot={slot.index}
      data-occupied={slot.occupied}
    >
      {!slot.occupied ? <EmptySlot size={size} /> : slot.value !== undefined ? <CardFace value={slot.value} size={size} /> : <CardBack size={size} />}
      {state.selected && state.order !== undefined && <span className="slot-tag">{state.order}</span>}
      {!state.selected && state.changed && size !== 'mini' && <span className="slot-tag info">new</span>}
    </button>
  );
}

export interface SeatBadgesProps {
  participant: ParticipantView | undefined;
  isActive: boolean;
  calledCabo: boolean;
}

export function SeatBadges({ participant, isActive, calledCabo }: SeatBadgesProps) {
  if (!participant) return null;
  return (
    <>
      {isActive && <span className="badge turn">Turn</span>}
      {calledCabo && (
        <span className="badge cabo">
          <FlagIcon /> Cabo
        </span>
      )}
      {participant.isHost && (
        <span className="badge host" title="Host">
          <CrownIcon /> Host
        </span>
      )}
      {participant.kind === 'bot' && (
        <span className="badge bot" title={participant.takenOverByBot ? 'A bot is playing this seat' : 'Computer player'}>
          <BotIcon /> {participant.takenOverByBot ? 'Bot (replaced)' : 'Bot'}
        </span>
      )}
      {!participant.connected && (
        <span className="badge offline">
          <OfflineIcon /> Offline
        </span>
      )}
    </>
  );
}

interface PlayerLayoutProps {
  seat: TableSeatView;
  participant: ParticipantView | undefined;
  score: ScoreView | undefined;
  isMe: boolean;
  isActive: boolean;
  calledCabo: boolean;
  size: CardSize;
  slotState: (owner: PlayerId, slot: SlotIndex) => SlotState;
  onSelect?: ((owner: PlayerId, slot: SlotIndex) => void) | undefined;
  showRoundWins: boolean;
}

/** One participant's 2×2 layout with name, badges and score. */
export function PlayerLayout({ seat, participant, score, isMe, isActive, calledCabo, size, slotState, onSelect, showRoundWins }: PlayerLayoutProps) {
  const name = participant?.name ?? 'Player';
  const ownerLabel = isMe ? 'Your' : `${name}’s`;
  return (
    <section
      className={`seat ${isActive ? 'active' : ''} ${participant && !participant.connected ? 'offline' : ''}`}
      aria-label={`${isMe ? 'Your cards' : name}${isActive ? ', taking a turn' : ''}`}
      data-player={seat.playerId}
    >
      <div className="seat-head">
        <span className="seat-name">{isMe ? `${name} (you)` : name}</span>
        <SeatBadges participant={participant} isActive={isActive} calledCabo={calledCabo} />
      </div>
      <div className={`hand-grid ${size === 'mini' ? 'mini' : ''}`}>
        {seat.slots.map((slot) => (
          <SlotButton
            key={slot.index}
            ownerLabel={ownerLabel}
            slot={slot}
            size={size}
            state={slotState(seat.playerId, slot.index)}
            onSelect={onSelect ? (s) => onSelect(seat.playerId, s) : undefined}
          />
        ))}
      </div>
      <div className="seat-score" aria-label={`${score?.total ?? 0} points${showRoundWins ? `, ${score?.roundWins ?? 0} round wins` : ''}, ${seat.cardCount} cards`}>
        {score ? `${score.total} pts` : ''}
        {showRoundWins && score ? ` · ${score.roundWins} win${score.roundWins === 1 ? '' : 's'}` : ''}
      </div>
    </section>
  );
}
