import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getAdminApi } from '../lib/env.ts';
import type { EventSetup } from './adminApi.ts';
import { errText } from './AdminApp.tsx';

export function SquadsPanel({ setup, onChange }: { setup: EventSetup; onChange: () => Promise<void> }) {
  const api = getAdminApi();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const real = setup.squads.filter((q) => !q.isPractice);
  const practice = setup.squads.find((q) => q.isPractice);
  const unstarted = real.filter((q) => q.startStationNumber === null).length;

  const run = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn();
      await onChange();
      setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    }
  };

  /** Spread squads across stations (shotgun start): squad 1 → station 1, squad 2 → station 2, … wrapping. */
  const autoStart = () =>
    run(async () => {
      const stations = [...setup.stations].sort((a, b) => a.number - b.number);
      if (stations.length === 0) throw new Error('Add stations first.');
      await Promise.all(real.map((q, i) => api.setSquadStart(q.id, stations[i % stations.length]!.id)));
    }, 'Start stations assigned.');

  return (
    <div className="stack">
      {msg && <div className={msg.ok ? 'ok' : 'error'} role="status">{msg.text}</div>}
      <div className="card stack">
        <span className="eyebrow">Print</span>
        <p className="muted small">Print on plain paper (laminate if you can). Each squad card's QR code opens that squad's live scorecard; scorers scan it to load the squad. Station signs are scanned by volunteers to pick their station.</p>
        <div className="row-form">
          <Link className="btn btn-clay" to={`/admin/${setup.event.id}/print/squads`}>Print squad cards ({real.length})</Link>
          <Link className="btn btn-ink" to={`/admin/${setup.event.id}/print/stations`}>Print station signs ({setup.stations.length})</Link>
        </div>
      </div>

      <div className="card stack">
        <div className="divhead">
          <span className="eyebrow">Squads</span>
          <span className="muted small">{real.length} squads · {setup.unsquadded.length} shooters not in a squad</span>
        </div>
        {real.length > 0 && (
          <button className="btn btn-line btn-sm" onClick={() => void autoStart()}>
            {unstarted ? `Assign start stations (${unstarted} squads have none)` : 'Re-spread start stations across the course'}
          </button>
        )}
        <div className="squads">
          {real.map((q) => (
            <div className="sq" key={q.id}>
              <div className="divhead">
                <span className="lab">Squad {q.number}</span>
                <select className="text tiny" value={setup.stations.find((s) => s.number === q.startStationNumber)?.id ?? ''} aria-label={`Squad ${q.number} start station`}
                  onChange={(e) => void run(() => api.setSquadStart(q.id, e.target.value || null), `Squad ${q.number} start updated.`)}>
                  <option value="">Start: —</option>
                  {setup.stations.map((s) => <option key={s.id} value={s.id}>Start: {s.number}</option>)}
                </select>
              </div>
              <ol>
                {q.members.map((m) => (
                  <li key={m.shooterId}>
                    {m.firstName} {m.lastName}
                    {m.isMinor && <span className="pill">U18</span>}
                    <small>{[m.division, m.team].filter(Boolean).join(' · ')}</small>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        {setup.unsquadded.length > 0 && (
          <p className="muted small">Not in a squad yet: {setup.unsquadded.map((s) => `${s.firstName} ${s.lastName}`).join(', ')}. Add a Squad column to your registration file and import them, or assign them on event day.</p>
        )}
      </div>

      <div className="card stack">
        <span className="eyebrow">Practice squad</span>
        {practice ? (
          <p className="muted small" style={{ margin: 0 }}>Squad {practice.number} is the practice squad for volunteer phone checks. Its scores never count. It prints with the squad cards, marked PRACTICE.</p>
        ) : (
          <button className="btn btn-ink" onClick={() => void run(() => api.ensurePracticeSquad(setup.event.id), 'Practice squad added.')}>Add a practice squad</button>
        )}
      </div>
    </div>
  );
}
