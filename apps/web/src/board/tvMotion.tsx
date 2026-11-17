import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * FLIP animation: when rows re-order, each row slides from its old position to its
 * new one. Rows are identified by data-flip-key. Rows new to the list slide in.
 */
export function useFlip(container: RefObject<HTMLElement | null>, version: unknown) {
  const last = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const rows = Array.from(el.querySelectorAll<HTMLElement>('[data-flip-key]'));
    const reduce = prefersReducedMotion();
    const next = new Map<string, number>();
    const firstRun = last.current.size === 0;
    rows.forEach((row, i) => {
      const key = row.dataset.flipKey!;
      const top = row.getBoundingClientRect().top;
      next.set(key, top);
      if (reduce || typeof row.animate !== 'function') return;
      const prev = last.current.get(key);
      if (firstRun) {
        row.animate(
          [{ opacity: 0, transform: 'translateX(-24px)' }, { opacity: 1, transform: 'none' }],
          { duration: 500, delay: i * 60, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' },
        );
      } else if (prev === undefined) {
        row.animate([{ opacity: 0, transform: 'translateX(40px)' }, { opacity: 1, transform: 'none' }], { duration: 650, easing: 'cubic-bezier(.2,.8,.2,1)' });
      } else if (Math.abs(prev - top) > 1) {
        row.animate([{ transform: `translateY(${prev - top}px)` }, { transform: 'none' }], { duration: 900, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    });
    last.current = next;
  }, [container, version]);
}

/** A number that counts up to its new value and pops when it changes. */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const [bump, setBump] = useState(false);
  const from = useRef(value);

  useEffect(() => {
    if (value === from.current) return;
    if (prefersReducedMotion()) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    const duration = 900;
    let raf = 0;
    setBump(true);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setShown(Math.round(a + (value - a) * eased));
      if (t < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    const off = setTimeout(() => setBump(false), 1200);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(off);
      from.current = value;
    };
  }, [value]);

  return <span className={`${className ?? ''}${bump ? ' bump' : ''}`}>{shown}</span>;
}

/** Clay shards bursting outward (used for a new leader). */
export function ClayBurst() {
  return (
    <svg className="burst" viewBox="-60 -60 120 120" aria-hidden="true">
      <g className="shards" fill="#d4581c">
        <path className="s1" d="M-14 -2 l10 -8 l6 9 z" />
        <path className="s2" d="M5 -8 l13 3 l-8 8 z" />
        <path className="s3" d="M-5 8 l9 -3 l3 10 z" />
        <path className="s4" d="M14 8 l8 4 l-6 5 z" />
        <circle className="s5" cx="-4" cy="-4" r="2.4" />
        <circle className="s6" cx="4" cy="-3" r="2" />
        <circle className="s7" cx="-3" cy="4" r="1.8" />
        <circle className="s8" cx="3" cy="4" r="1.6" />
      </g>
    </svg>
  );
}

/** The header sky: drifting clouds, and a clay that flies across and bursts every few seconds. */
export function TvSky() {
  return (
    <svg className="scene" viewBox="0 0 700 64" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="tvsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9cc8e2" /><stop offset="1" stopColor="#d9ebf4" /></linearGradient>
        <linearGradient id="tvfield" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c9a54a" /><stop offset="1" stopColor="#8f6f22" /></linearGradient>
        <path id="tvflight" d="M-20 50 C 140 0, 320 -6, 520 14" />
      </defs>
      <rect width="700" height="64" fill="url(#tvsky)" />
      <circle className="sun-glow" cx="470" cy="22" r="20" fill="#f6c45e" opacity="0.25" />
      <circle cx="470" cy="22" r="13" fill="#f6c45e" />
      <g className="clouds" fill="#ffffff" opacity="0.85">
        <g className="cloud c1"><ellipse cx="0" cy="16" rx="34" ry="7" /><ellipse cx="-10" cy="11" rx="16" ry="8" /><ellipse cx="11" cy="10" rx="14" ry="7" /></g>
        <g className="cloud c2"><ellipse cx="0" cy="28" rx="26" ry="5" /><ellipse cx="7" cy="24" rx="12" ry="6" /></g>
        <g className="cloud c3"><ellipse cx="0" cy="10" rx="40" ry="6" /><ellipse cx="-9" cy="5" rx="18" ry="7" /></g>
      </g>
      <g className="flying">
        <g>
          <ellipse rx="8" ry="2.6" fill="#a8461a" />
          <ellipse rx="8" ry="2.1" cy="-0.5" fill="#d4581c" />
          <animateMotion dur="9s" repeatCount="indefinite" keyPoints="0;1;1" keyTimes="0;0.45;1" calcMode="linear">
            <mpath href="#tvflight" />
          </animateMotion>
          <animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.44;0.45;1" dur="9s" repeatCount="indefinite" />
        </g>
        <g transform="translate(520 14)">
          <g fill="#d4581c" opacity="0">
            <path d="M-6 -1 l4 -3 l2 4 z" /><path d="M2 -3 l5 1 l-3 3 z" /><path d="M-2 3 l4 -1 l1 4 z" /><circle cx="-8" cy="-5" r="1" /><circle cx="9" cy="-6" r="0.9" />
            <animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.45;0.47;0.6;1" dur="9s" repeatCount="indefinite" />
            <animateTransform attributeName="transform" type="scale" values="0.5;0.5;1;2.2;2.2" keyTimes="0;0.45;0.47;0.6;1" dur="9s" repeatCount="indefinite" />
          </g>
        </g>
      </g>
      <path d="M0 50 Q30 44 60 48 Q100 41 140 47 L260 47 Q300 42 340 46 Q380 43 420 47 L560 47 Q600 41 640 46 Q670 43 700 46 L700 52 L0 52 Z" fill="#5b6a3c" />
      <rect y="51" width="700" height="13" fill="url(#tvfield)" />
    </svg>
  );
}
