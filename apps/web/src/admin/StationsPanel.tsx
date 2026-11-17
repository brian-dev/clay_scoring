import { useState } from 'react';
import { getAdminApi } from '../lib/env.ts';
import type { AdminStation, EventSetup, PresentationKind, StationInput } from './adminApi.ts';
import { errText } from './AdminApp.tsx';

const KINDS: [PresentationKind, string][] = [
  ['report_pair', 'Report pairs'],
  ['true_pair', 'True pairs'],
  ['following_pair', 'Following pairs'],
  ['single', 'Singles'],
];

function StationRow({ station, onSave, onDelete }: { station: StationInput; onSave: (s: StationInput) => Promise<void>; onDelete?: () => Promise<void> }) {
  const [s, setS] = useState(station);
  const dirty = JSON.stringify(s) !== JSON.stringify(station);
  return (
    <tr>
      <td><input className="text tiny" type="number" min={1} value={s.number} onChange={(e) => setS({ ...s, number: Number(e.target.value) })} aria-label="Station number" /></td>
      <td><input className="text" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} placeholder="Springing teal" aria-label="Station name" /></td>
      <td><input className="text tiny" type="number" min={1} max={50} value={s.targetCount} onChange={(e) => setS({ ...s, targetCount: Number(e.target.value) })} aria-label="Targets" /></td>
      <td>
        <select className="text" value={s.presentation} onChange={(e) => setS({ ...s, presentation: e.target.value as PresentationKind })} aria-label="Presentation">
          {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </td>
      <td className="actions">
        <button className="btn btn-clay btn-sm" disabled={!dirty && !!station.id} onClick={() => void onSave(s)}>{station.id ? 'Save' : 'Add'}</button>
        {onDelete && <button className="btn btn-line btn-sm" onClick={() => void onDelete()}>Remove</button>}
      </td>
    </tr>
  );
}

export function StationsPanel({ setup, onChange }: { setup: EventSetup; onChange: () => Promise<void> }) {
  const api = getAdminApi();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const total = setup.stations.reduce((n, s) => n + s.targetCount, 0);
  const nextNumber = Math.max(0, ...setup.stations.map((s) => s.number)) + 1;

  const run = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn();
      await onChange();
      setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    }
  };

  const toInput = (s: AdminStation): StationInput => ({ id: s.id, number: s.number, name: s.name, targetCount: s.targetCount, presentation: s.presentation });

  return (
    <div className="stack">
      {msg && <div className={msg.ok ? 'ok' : 'error'} role="status">{msg.text}</div>}
      <div className="card stack">
        <div className="divhead">
          <span className="eyebrow">Course</span>
          <span className="muted small"><b>{setup.stations.length}</b> stations · <b>{total}</b> targets per shooter</span>
        </div>
        <p className="muted small">Pairs need an even number of targets; odd counts are scored as singles. Each station gets its own QR sign (Squads &amp; printing tab).</p>
        <table className="tbl">
          <thead><tr><th>#</th><th>Name</th><th>Targets</th><th>Presentation</th><th /></tr></thead>
          <tbody>
            {setup.stations.map((s) => (
              <StationRow
                key={`${s.id}-${s.number}-${s.targetCount}-${s.name}-${s.presentation}`}
                station={toInput(s)}
                onSave={(v) => run(() => api.saveStation(setup.event.id, setup.courseId, v), `Station ${v.number} saved.`)}
                onDelete={() =>
                  confirm(`Remove station ${s.number}? Any scores already recorded there are deleted too.`)
                    ? run(() => api.deleteStation(s.id), `Station ${s.number} removed.`)
                    : Promise.resolve()
                }
              />
            ))}
            <StationRow
              key={`new-${nextNumber}`}
              station={{ number: nextNumber, name: '', targetCount: 10, presentation: 'report_pair' }}
              onSave={(v) => run(() => api.saveStation(setup.event.id, setup.courseId, v), `Station ${v.number} added.`)}
            />
          </tbody>
        </table>
      </div>
    </div>
  );
}
