import type { BoardRow, StandingsFile } from '@slayin/core';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Band } from '../components/Brand.tsx';
import { parseCode } from '../lib/qr.ts';
import { useStandings } from './useStandings.ts';

type Tab = 'overall' | 'divisions' | 'teams' | 'me';

export function RankChip({ rank }: { rank: number }) {
  return <span className={`rk${rank === 1 ? ' g' : rank <= 3 ? ' s' : ''}`}>{rank}</span>;
}

export function Rows({ rows, limit }: { rows: BoardRow[]; limit?: number }) {
  const shown = limit ? rows.slice(0, limit) : rows;
  if (shown.length === 0) return <p className="muted" style={{ padding: 12, margin: 0 }}>No scores yet.</p>;
  return (
    <div className="list">
      {shown.map((r, i) => (
        <div className={`lrow${r.rank === 1 && i === 0 ? ' first' : ''}`} key={r.shooterId}>
          <RankChip rank={r.rank} />
          <div className="nm">
            {r.name}
            {r.underReview && <span className="flag">UNDER REVIEW</span>}
            {r.shootOff && <span className="flag">SHOOT-OFF</span>}
            <small>
              {r.division ? `${r.division} · ` : ''}
              {r.progress}
            </small>
          </div>
          <span className="scr">{r.total}</span>
        </div>
      ))}
    </div>
  );
}

function Updated({ data, updatedAt }: { data: StandingsFile; updatedAt: number | null }) {
  return (
    <p className="muted small">
      {data.squadsOnCourse} squads on course · {data.squadsFinished} finished
      {updatedAt ? ` · updated ${new Date(updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
      {data.final ? ' · FINAL RESULTS' : ''}
    </p>
  );
}

export function BoardPage() {
  const { data, error, updatedAt } = useStandings(30_000);
  const [tab, setTab] = useState<Tab>('overall');
  const [division, setDivision] = useState(0);
  const [code, setCode] = useState('');
  const navigate = useNavigate();

  const openCard = (e: FormEvent) => {
    e.preventDefault();
    const token = parseCode(code, 'squad');
    if (token) navigate(`/me/${encodeURIComponent(token)}`);
  };

  return (
    <div className="board">
      <Band label={tab === 'divisions' ? 'Division rankings' : tab === 'teams' ? 'Team awards' : 'Live standings'} right={<span className="live">LIVE</span>} />
      <main className="page stack">
        <div className="tabs">
          {(['overall', 'divisions', 'teams', 'me'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t === 'me' ? 'Me' : t}
            </button>
          ))}
        </div>

        {error && <div className="note">{error}</div>}
        {!data && !error && <p className="muted">Loading standings…</p>}

        {data && tab === 'overall' && (
          <>
            <Rows rows={data.overall} />
            <Updated data={data} updatedAt={updatedAt} />
          </>
        )}

        {data && tab === 'divisions' && (
          <>
            <div className="tabs sub">
              {data.divisions.map((d, i) => (
                <button key={d.id} className={division === i ? 'on' : ''} onClick={() => setDivision(i)}>
                  {d.name}
                </button>
              ))}
            </div>
            {data.divisions[division] && (
              <>
                <div className="divhead">
                  <span className="lab">{data.divisions[division]!.name}</span>
                  <span className="muted small">{data.divisions[division]!.count} shooters</span>
                </div>
                <Rows rows={data.divisions[division]!.rows} />
              </>
            )}
            {data.lewis && (
              <p className="muted small">
                Lewis Class results are calculated automatically once every score is final.
              </p>
            )}
          </>
        )}

        {data && tab === 'teams' && (
          <div className="list">
            {data.teams.map((t) => (
              <div className="lrow" key={t.teamId}>
                <RankChip rank={t.rank} />
                <div className="nm">
                  {t.name}
                  <small>{t.members} shooters{t.finished ? ' · Final' : ''}</small>
                </div>
                <span className="scr">{t.total}</span>
              </div>
            ))}
          </div>
        )}

        {tab === 'me' && (
          <form className="card stack" onSubmit={openCard}>
            <span className="eyebrow">My scorecard</span>
            <p style={{ margin: 0 }}>Scan the QR code on your squad card with your phone camera, or type the code printed under it.</p>
            <input className="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="squad-1" autoCapitalize="none" />
            <button className="btn btn-clay" disabled={!code.trim()}>Show my scorecard</button>
          </form>
        )}
      </main>
    </div>
  );
}
