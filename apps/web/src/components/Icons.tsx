import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
};

export const EyeIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const SpyIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="M15 15l6 6" />
  </svg>
);

export const SwapIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4 8h14l-4-4" />
    <path d="M20 16H6l4 4" />
  </svg>
);

export const CrownIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z" />
  </svg>
);

export const BotIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="4" y="8" width="16" height="12" rx="3" />
    <path d="M12 4v4" />
    <circle cx="9" cy="14" r="1.2" fill="currentColor" />
    <circle cx="15" cy="14" r="1.2" fill="currentColor" />
  </svg>
);

export const OfflineIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M2 2l20 20" />
    <path d="M8.5 16.5a5 5 0 0 1 7 0" />
    <path d="M5 13a10 10 0 0 1 5.2-2.8" />
    <path d="M19 13a10 10 0 0 0-2.4-1.7" />
    <path d="M12 20h.01" />
  </svg>
);

export const FlagIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M5 21V4" />
    <path d="M5 4h11l-2 4 2 4H5" />
  </svg>
);

export const CopyIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
  </svg>
);

export const CheckIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M5 12l5 5 9-10" />
  </svg>
);

export const Logo = (p: IconProps) => (
  <svg viewBox="0 0 64 64" aria-hidden focusable={false} {...p}>
    <rect x="10" y="10" width="30" height="42" rx="5" fill="#1a4a4c" stroke="#f2b544" strokeWidth="3" transform="rotate(-10 25 31)" />
    <rect x="22" y="12" width="30" height="42" rx="5" fill="#fbf7ee" stroke="#0c2226" strokeWidth="2" transform="rotate(8 37 33)" />
    <text x="37" y="41" fontFamily="system-ui,sans-serif" fontSize="20" fontWeight="800" fill="#0c2226" textAnchor="middle" transform="rotate(8 37 33)">
      0
    </text>
  </svg>
);
