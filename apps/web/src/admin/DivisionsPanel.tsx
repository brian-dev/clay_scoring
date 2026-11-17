import { useState } from 'react';
import { getAdminApi } from '../lib/env.ts';
import type { EventSetup } from './adminApi.ts';
import { errText } from './AdminApp.tsx';
import { DIVISION_PRESET } from './registration.ts';

export function DivisionsPanel({ setup, onChange }: { setup: EventSetup; onChange: () => Promise<void> }) {
  const api = getAdminApi();
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const missingPreset = DIVISION_PRESET.filter((p) => !setup.divisions.some((d) => d.name.toLowerCase() === p.name.toLowerCase()));

  const run = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn();
      await onChange();
      setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    }
  };

  return (
    <div className="stack">
      {msg && <div className={msg.ok ? 'ok' : 'error'} role="status">{msg.text}</div>}
      <div className="card stack">
        <span className="eyebrow">Award divisions</span>
        <p className="muted small">Each division is ranked on its own and gets its own awards list. Shooters are placed in a division from the registration file.</p>
        {missingPreset.length > 0 && (
          <button
            className="btn btn-ink"
            onClick={() => void run(() => api.addDivisions(setup.event.id, missingPreset.map((p) => ({ name: p.name, sortOrder: p.sortOrder }))), 'Added the 2026 divisions.')}
          >
            Add the 2026 Slayin' Clays divisions
          </button>
        )}
        <table className="tbl">
          <thead><tr><th>Division</th><th>Award places</th><th /></tr></thead>
          <tbody>
            {setup.divisions.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td>
                  <select className="text tiny" value={d.awardsDepth} aria-label={`${d.name} award places`}
                    onChange={(e) => void run(() => api.updateDivision(d.id, { awardsDepth: Number(e.target.value) }), `${d.name} updated.`)}>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </td>
                <td className="actions">
                  <button className="btn btn-line btn-sm"
                    onClick={() => confirm(`Remove ${d.name}? Shooters in it will have no division.`) && void run(() => api.deleteDivision(d.id), `${d.name} removed.`)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form className="row-form" onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void run(() => api.addDivisions(setup.event.id, [{ name: name.trim(), sortOrder: setup.divisions.length + 1 }]), `Added ${name.trim()}.`).then(() => setName(''));
        }}>
          <input className="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a division, e.g. Senior Male" aria-label="New division name" />
          <button className="btn btn-clay btn-sm">Add</button>
        </form>
      </div>
      <div className="card stack">
        <span className="eyebrow">Teams</span>
        {setup.teams.length === 0 ? (
          <p className="muted small">Teams are created automatically from the registration file's Team column.</p>
        ) : (
          <p style={{ margin: 0 }}>{setup.teams.map((t) => t.name).join(' · ')}</p>
        )}
      </div>
    </div>
  );
}
