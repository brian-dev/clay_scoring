import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Band } from '../components/Brand.tsx';
import { useSquadCard } from './useStandings.ts';

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

const progressText = (p: string) => {
  const m = p.match(/^thru (\d+)$/);
  if (!m) return p;
  const n = Number(m[1]);
  return `Thru ${n} station${n === 1 ? '' : 's'}`;
};

/** Public squad scorecard opened from the QR code on a squad card (/me/<token>). */
export function SquadPage() {
  const { token = '' } = useParams();
  const { data, error } = useSquadCard(token);
  const [pick, setPick] = useState(0);
  const shooter = data?.shooters[pick];

  return (
    <div className="board">
      <Band label={data ? `Squad ${data.squadNumber}` : 'My scorecard'} right={<span className="live">LIVE</span>} />
      <main className="page stack">
        {error && <div className="note">{error}</div>}
        {!data && !error && <p className="muted">Loading scorecard…</p>}
        {data && (
          <>
            <div className="tabs sub">
              {data.shooters.map((s, i) => (
                <button key={s.shooterId} className={pick === i ? 'on' : ''} onClick={() => setPick(i)}>
                  {s.name}
                </button>
              ))}
            </div>
            {shooter && (
              <>
                <div className="ticket">
                  <span className="rye">{shooter.total}</span>
                  <span className="t">
                    {progressText(shooter.progress)}
                    <br />
                    {shooter.overallRank && <><b>{ordinal(shooter.overallRank)}</b> overall<br /></>}
                    {shooter.divisionRank && shooter.division && <><b>{ordinal(shooter.divisionRank)}</b> {shooter.division}</>}
                  </span>
                </div>
                <div className="list">
                  {shooter.stations.map((st) => (
                    <div className="strow" key={st.number}>
                      <span className="mono num">{String(st.number).padStart(2, '0')}</span>
                      <span className="nm">{st.name}</span>
                      <span className="cdots" aria-label={`${st.hits} of ${st.targetCount}`}>
                        {st.targets.map((t, i) => (
                          <i key={i} className={t === 'H' ? 'h' : t === 'M' ? 'm' : 'e'} />
                        ))}
                      </span>
                      <span className="mono r">{st.targets.some((t) => t !== null) ? st.hits : '–'}</span>
                    </div>
                  ))}
                </div>
                <p className="muted small">
                  <i className="keydot h" /> Broken &nbsp; <i className="keydot m" /> Lost &nbsp; <i className="keydot e" /> Not yet thrown
                </p>
              </>
            )}
          </>
        )}
        <Link to="/board" className="btn btn-line btn-sm">Full leaderboard</Link>
      </main>
    </div>
  );
}
