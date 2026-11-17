import type { ReactNode } from 'react';

export function Sabers() {
  return (
    <svg viewBox="0 0 64 44" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <path d="M8 6 C 22 18, 36 28, 52 36" />
        <path d="M56 6 C 42 18, 28 28, 12 36" />
      </g>
      <g fill="currentColor">
        <rect x="47" y="31" width="10" height="4" rx="1" transform="rotate(30 52 33)" />
        <rect x="7" y="31" width="10" height="4" rx="1" transform="rotate(-30 12 33)" />
        <circle cx="56" cy="39" r="3" />
        <circle cx="8" cy="39" r="3" />
      </g>
    </svg>
  );
}

export function Band({ label, right }: { label: string; right?: ReactNode }) {
  return (
    <header className="band">
      <div className="mark">
        <Sabers />
        <span className="rye">Slayin' Clays</span>
      </div>
      <div className="sub">
        <span className="lab">{label}</span>
        {right}
      </div>
    </header>
  );
}
