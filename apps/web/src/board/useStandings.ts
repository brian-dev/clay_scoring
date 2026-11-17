import type { SquadFile, StandingsFile } from '@slayin/core';
import { useEffect, useRef, useState } from 'react';
import { isDemo, standingsUrl } from '../lib/env.ts';
import { demoSquadIdForToken, demoStandings } from './demoStandings.ts';

/**
 * Polls a cached standings file — never a live connection — so any number of phones
 * stay inside the free tier. Polls only while the page is visible, and lets the
 * browser revalidate with ETags so unchanged files cost almost nothing.
 */
export function usePolledJson<T>(url: string | null, intervalMs: number, demo: (tick: number) => T | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const tick = useRef(0);
  const slow = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const load = async () => {
      if (document.visibilityState !== 'visible') return;
      if (isDemo || !url) {
        tick.current++;
        setData(demo(tick.current));
        setUpdatedAt(Date.now());
        return;
      }
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.status === 404) {
          setError('Standings will appear once the first station is confirmed.');
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        // Server asks clients to slow down when traffic is high (see the free-tier plan).
        slow.current = res.headers.get('x-poll-slow') === '1';
        setData((await res.json()) as T);
        setUpdatedAt(Date.now());
        setError(null);
      } catch {
        setError('Can’t reach the leaderboard right now. Retrying…');
      }
    };

    const loop = async () => {
      await load();
      if (stopped) return;
      timer = setTimeout(loop, slow.current ? Math.max(intervalMs, 60_000) : intervalMs);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        if (timer) clearTimeout(timer);
        void loop();
      }
    };

    void loop();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [url, intervalMs, demo]);

  return { data, error, updatedAt };
}

const demoBoard = (tick: number) => demoStandings(tick).standings;

export function useStandings(intervalMs = 30_000) {
  return usePolledJson<StandingsFile>(standingsUrl('standings.json'), intervalMs, demoBoard);
}

export function useSquadCard(token: string, intervalMs = 30_000) {
  const demo = (tick: number) => {
    const id = demoSquadIdForToken(token);
    return id ? demoStandings(tick).squads.get(id) ?? null : null;
  };
  return usePolledJson<SquadFile>(standingsUrl(`squads/${encodeURIComponent(token)}.json`), intervalMs, useRef(demo).current);
}
