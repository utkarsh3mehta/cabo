import { abilityForValue, type Ability, type CardValue } from '@cabo/shared/client';
import type { ReactNode } from 'react';
import { EyeIcon, SpyIcon, SwapIcon } from './Icons';

export type CardSize = 'mini' | 'normal' | 'large';

const ABILITY_LABEL: Record<Ability, string> = { peek: 'Peek', spy: 'Spy', swap: 'Swap' };
const ABILITY_ICON: Record<Ability, (p: { width?: number }) => ReactNode> = {
  peek: (p) => <EyeIcon {...p} />,
  spy: (p) => <SpyIcon {...p} />,
  swap: (p) => <SwapIcon {...p} />,
};

export function abilityLabel(value: CardValue): string {
  const ability = abilityForValue(value);
  return ability ? `${value} (${ABILITY_LABEL[ability]})` : String(value);
}

const sizeClass = (size: CardSize) => (size === 'normal' ? '' : size);

export function CardFace({ value, size = 'normal' }: { value: CardValue; size?: CardSize }) {
  const ability = abilityForValue(value);
  return (
    <span className={`card card-face ${sizeClass(size)}`} data-value={value}>
      {size !== 'mini' && <span className="corner">{value}</span>}
      <span className="value">{value}</span>
      {ability && (
        <span className={`ability ${ability}`}>
          {ABILITY_ICON[ability]({})}
          <span>{ABILITY_LABEL[ability].toUpperCase()}</span>
        </span>
      )}
    </span>
  );
}

export function CardBack({ size = 'normal' }: { size?: CardSize }) {
  return <span className={`card card-back ${sizeClass(size)}`} />;
}

export function EmptySlot({ size = 'normal' }: { size?: CardSize }) {
  return <span className={`card card-empty ${sizeClass(size)}`}>{size === 'mini' ? '' : 'empty'}</span>;
}
