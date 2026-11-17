import { Sabers } from '../components/Brand.tsx';
import { useStandings } from './useStandings.ts';

const SPONSORS = ((import.meta.env.VITE_SPONSORS as string | undefined) ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Full-screen clubhouse TV board. Polls every 15 seconds. */
export function TvPage() {
  const { data, error } = useStandings(15_000);
  const shortDiv = (d: string | null) => (d ?? '').replace('Intermediate', 'Intermed.').replace(' Male', ' M').replace(' Female', ' F');

  return (
    <div className="tv">
      <header className="tv-head">
        <svg className="scene" viewBox="0 0 700 64" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="tvsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9cc8e2" /><stop offset="1" stopColor="#d9ebf4" /></linearGradient>
            <linearGradient id="tvfield" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c9a54a" /><stop offset="1" stopColor="#8f6f22" /></linearGradient>
          </defs>
          <rect width="700" height="64" fill="url(#tvsky)" />
          <circle cx="470" cy="22" r="13" fill="#f6c45e" />
          <path d="M0 50 Q30 44 60 48 Q100 41 140 47 L260 47 Q300 42 340 46 Q380 43 420 47 L560 47 Q600 41 640 46 Q670 43 700 46 L700 52 L0 52 Z" fill="#5b6a3c" />
          <rect y="51" width="700" height="13" fill="url(#tvfield)" />
        </svg>
        <div className="ttl">
          <Sabers />
          <span className="rye">Slayin' Clays</span>
          <span className="lab">{data?.final ? 'Final results' : 'Live standings'}</span>
        </div>
        <div className="meta">
          <span className="live">LIVE</span>
          <br />
          {data && <span className="mono">{data.squadsOnCourse} squads on course · {data.squadsFinished} finished</span>}
        </div>
      </header>

      {error && <p className="tv-msg">{error}</p>}
      {data && (
        <div className="tv-body">
          <section>
            <h4>High overall · Top 10</h4>
            {data.overall.slice(0, 10).map((r, i) => (
              <div className={`tvr${i === 0 ? ' first' : ''}`} key={r.shooterId}>
                <span className="rk">{r.rank}</span>
                <span>{r.name}</span>
                <span className="dv">{shortDiv(r.division)}</span>
                <span className="pr">{r.progress}</span>
                <span className="sc">{r.total}</span>
              </div>
            ))}
          </section>
          <section>
            <h4>Division leaders</h4>
            <div className="dcards">
              {data.divisions.map((d) => (
                <div className="dc" key={d.id}>
                  <div className="k">{d.name}</div>
                  {d.rows.slice(0, 2).map((r, i) => (
                    <div className={`rw${i ? ' second' : ''}`} key={r.shooterId}>
                      {i === 0 ? <b>{r.name}</b> : <span>{r.name}</span>}
                      <span className="rye">{r.total}</span>
                    </div>
                  ))}
                  {d.rows.length === 0 && <div className="rw second"><span>—</span></div>}
                </div>
              ))}
            </div>
            <h4 style={{ marginTop: 12 }}>Team awards</h4>
            {data.teams.slice(0, 3).map((t, i) => (
              <div className={`tm${i === 0 ? ' first' : ''}`} key={t.teamId}>
                <span className="rk">{t.rank}</span>
                <span>{t.name}</span>
                <span className="s">{t.total}</span>
              </div>
            ))}
          </section>
        </div>
      )}

      <footer className="tv-spons">
        <span className="lab">Thank you to our sponsors</span>
        {(SPONSORS.length ? SPONSORS : ['Title sponsor', 'Sponsor logo', 'Sponsor logo', 'Scoring sponsor']).map((s, i) => (
          <span className="slot" key={i}>{s}</span>
        ))}
      </footer>
    </div>
  );
}
