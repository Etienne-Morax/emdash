import type { SVGProps } from 'react';
import type { MachineIconKey } from '@core/primitives/color-coding/api/color-coding';

/**
 * Machine chip icons (24×24, stroke = currentColor so they follow light/dark). The small
 * accent mark uses `--machine-accent`, defaulting to the amber accent.
 */
const ACCENT = 'var(--machine-accent, #FFB04A)';

type IconProps = SVGProps<SVGSVGElement>;

function Frame({ children, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

function Laptop({ digit, ...props }: IconProps & { digit?: string }) {
  return (
    <Frame {...props}>
      <rect x="4.5" y="5" width="15" height="10.5" rx="1.3" />
      <path d="M2.5 17.5h19l-.6 1.3a1 1 0 0 1-.9.7H4a1 1 0 0 1-.9-.7z" />
      <rect x="10.5" y="17.9" width="3" height="0.9" rx="0.45" fill={ACCENT} stroke="none" />
      {digit && (
        <text
          x="12"
          y="13.4"
          textAnchor="middle"
          fontFamily="-apple-system, 'SF Pro Rounded', system-ui, sans-serif"
          fontSize="8"
          fontWeight="800"
          fill="currentColor"
          stroke="none"
        >
          {digit}
        </text>
      )}
    </Frame>
  );
}

function IMac(props: IconProps) {
  return (
    <Frame {...props}>
      <rect x="2.5" y="3.5" width="19" height="13" rx="1.6" />
      <path d="M2.5 13.5h19" />
      <circle cx="12" cy="15" r="0.9" fill={ACCENT} stroke="none" />
      <path d="M10 16.5 9.3 20h5.4L14 16.5M8.3 20.5h7.4" />
    </Frame>
  );
}

function Server(props: IconProps) {
  return (
    <Frame {...props}>
      <path d="M5 6.5 6.8 4.5h10.4L19 6.5" />
      <rect x="4" y="6.5" width="16" height="12" rx="1.8" />
      <rect x="6" y="9" width="12" height="3.4" rx="0.9" />
      <rect x="6" y="13.6" width="12" height="3.4" rx="0.9" />
      <path d="M14.6 10v1.4M15.9 10v1.4M14.6 14.6V16M15.9 14.6V16" />
      <circle cx="17.6" cy="7.9" r="0.7" fill={ACCENT} stroke="none" />
      <path d="M6.5 18.5v1M17.5 18.5v1" />
    </Frame>
  );
}

export function MachineIcon({ icon, ...props }: IconProps & { icon: MachineIconKey }) {
  switch (icon) {
    case 'imac':
      return <IMac {...props} />;
    case 'server':
      return <Server {...props} />;
    case 'laptop-1':
      return <Laptop digit="1" {...props} />;
    case 'laptop-5':
      return <Laptop digit="5" {...props} />;
    default:
      return <Laptop {...props} />;
  }
}
