import type { StandingsFile } from '@slayin/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Sabers } from '../components/Brand.tsx';
import { isDemo } from '../lib/env.ts';
import { diffStandings, type Mover, type RowChange } from './movement.ts';
import { AnimatedNumber, ClayBurst, TvSky, useFlip } from './tvMotion.tsx';
import { useStandings } from './useStandings.ts';

const SPONSORS = ((import.meta.env.VITE_SPONSORS as string | undefined) ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const HIGHLIGHT_MS = 8_000;
const LEADER_MS = 7_000;
const MAX_TICKER = 8;

const shortDiv = (d: string | null) => (d ?? '').replace('Intermediate', 'Intermed.').replace(' Male', ' M').replace(' Female', ' F');

/** Full-screen clubhouse TV board with motion: rows slide to new places, scores count up, movers get arrows. */
export function TvPage() {
  const [params] = useSearchParams();
  // Demo only: ?demoInterval=3000 speeds the simulated shoot up for previews.
  const demoInterval = isDemo ? Math.max(1000, Number(params.get('demoInterval')) || 0) : 0;
  const { data, error } = useStandings(demoInterval || 15_000);

  const prev = useRef<StandingsFile | null>(null);
  const [changes, setChanges] = useState<Map<string, RowChange>>(new Map());
  const [ticker, setTicker] = useState<Mover[]>([]);
  const [leader, setLeader] = useState<{ name: string; total: number; key: number } | null>(null);
  const [flashDivs, setFlashDivs] = useState<Set<string>>(new Set());

  // Each new snapshot: work out what moved, then let timers fade the effects out.
  useEffect(() => {
    if (!data) return;
    const before = prev.current;
    const m = diffStandings(before, data);
    prev.current = data;
    if (m.changes.size) setChanges(m.changes);
    if (m.movers.length) setTicker((t) => [...m.movers, ...t].slice(0, MAX_TICKER));
    if (m.newLeader) setLeader({ name: m.newLeader.name, total: m.newLeader.total, key: Date.now() });
    if (before) {
      const was = new Map(before.divisions.map((d) => [d.id, d.rows[0]?.shooterId]));
      const flipped = data.divisions.filter((d) => was.get(d.id) && d.rows[0] && was.get(d.id) !== d.rows[0].shooterId).map((d) => d.id);
      if (flipped.length) setFlashDivs(new Set(flipped));
    }
  }, [data]);

  useEffect(() => {
    if (!changes.size) return;
    const t = setTimeout(() => setChanges(new Map()), HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [changes]);
  useEffect(() => {
    if (!leader) return;
    const t = setTimeout(() => setLeader(null), LEADER_MS);
    return () => clearTimeout(t);
  }, [leader]);
  useEffect(() => {
    if (!flashDivs.size) return;
    const t = setTimeout(() => setFlashDivs(new Set()), 4_000);
    return () => clearTimeout(t);
  }, [flashDivs]);

  const top = useMemo(() => data?.overall.slice(0, 10) ?? [], [data]);
  const listRef = useRef<HTMLElement>(null);
  const teamRef = useRef<HTMLDivElement>(null);
  useFlip(listRef, top.map((r) => r.shooterId).join());
  useFlip(teamRef, data?.teams.slice(0, 3).map((t) => t.teamId).join());

  const tickerItems = ticker.length
    ? ticker.map((m) => ({ key: `${m.kind}-${m.shooterId}-${m.text}`, text: m.text, kind: m.kind }))
    : [
        { key: 'i1', text: data ? `${data.courseTargets} targets · ${data.stationCount} stations` : "Welcome to Slayin' Clays", kind: 'info' as const },
        { key: 'i2', text: 'Follow your own scores: scan the QR code on your squad card', kind: 'info' as const },
        { key: 'i3', text: 'Benefiting the Poth FFA and Poth shooting teams', kind: 'info' as const },
      ];

  return (
    <div className="tv">
      <header className="tv-head">
        <TvSky />
        <div className="ttl">
          <Sabers />
          <span className="rye">Slayin' Clays</span>
          <span className="lab">{data?.final ? 'Final results' : 'Live standings'}</span>
        </div>
        <div className="meta">
          <span className="live pulse">LIVE</span>
          <br />
          {data && <span className="mono">{data.squadsOnCourse} squads on course · {data.squadsFinished} finished</span>}
        </div>
        {leader && (
          <div className="leader-banner" key={leader.key} role="status">
            <ClayBurst />
            <span className="lab">New leader</span>
            <span className="rye">{leader.name}</span>
            <span className="rye score">{leader.total}</span>
            <ClayBurst />
          </div>
        )}
      </header>

      {error && <p className="tv-msg">{error}</p>}
      {data && (
        <div className="tv-body">
          <section ref={listRef}>
            <h4>High overall · Top 10</h4>
            {top.map((r, i) => {
              const c = changes.get(r.shooterId);
              const cls = ['tvr', i === 0 ? 'first' : '', c && c.rankDelta > 0 ? 'up' : '', c && c.rankDelta < 0 ? 'down' : '', c && c.scoreDelta > 0 ? 'scored' : ''].join(' ');
              return (
                <div className={cls} key={r.shooterId} data-flip-key={r.shooterId}>
                  <span className="rk">{r.rank}</span>
                  <span className="nm">
                    {r.name}
                    {c && c.rankDelta > 0 && <span className="delta up">▲{c.rankDelta}</span>}
                    {c && c.rankDelta < 0 && <span className="delta down">▼{-c.rankDelta}</span>}
                    {c?.justFinished && <span className="delta fin">FINAL</span>}
                  </span>
                  <span className="dv">{shortDiv(r.division)}</span>
                  <span className="pr">{r.progress}</span>
                  <AnimatedNumber value={r.total} className="sc" />
                </div>
              );
            })}
          </section>
          <section>
            <h4>Division leaders</h4>
            <div className="dcards">
              {data.divisions.map((d) => (
                <div className={`dc${flashDivs.has(d.id) ? ' flash' : ''}`} key={d.id}>
                  <div className="k">{d.name}</div>
                  {d.rows.slice(0, 2).map((r, i) => (
                    <div className={`rw${i ? ' second' : ''}`} key={r.shooterId}>
                      {i === 0 ? <b>{r.name}</b> : <span>{r.name}</span>}
                      <AnimatedNumber value={r.total} className="rye" />
                    </div>
                  ))}
                  {d.rows.length === 0 && <div className="rw second"><span>—</span></div>}
                </div>
              ))}
            </div>
            <h4 style={{ marginTop: 12 }}>Team awards</h4>
            <div ref={teamRef}>
              {data.teams.slice(0, 3).map((t, i) => (
                <div className={`tm${i === 0 ? ' first' : ''}`} key={t.teamId} data-flip-key={t.teamId}>
                  <span className="rk">{t.rank}</span>
                  <span>{t.name}</span>
                  <AnimatedNumber value={t.total} className="s" />
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      <div className="tv-ticker" aria-label="Latest moves">
        <span className="tlab lab">{ticker.length ? 'On the move' : "Slayin' Clays"}</span>
        <div className="track">
          <div className="belt" key={tickerItems.map((t) => t.key).join('|')}>
            {[0, 1].map((copy) => (
              <span className="run" key={copy} aria-hidden={copy === 1}>
                {tickerItems.map((t) => (
                  <span className={`item ${t.kind}`} key={t.key}>{t.text}</span>
                ))}
              </span>
            ))}
          </div>
        </div>
      </div>

      <footer className="tv-spons">
        <span className="lab">Thank you to our sponsors</span>
        {(SPONSORS.length ? SPONSORS : ['Title sponsor', 'Sponsor logo', 'Sponsor logo', 'Scoring sponsor']).map((s, i) => (
          <span className="slot" key={i}>{s}</span>
        ))}
      </footer>
    </div>
  );
}
