import { displayName } from '@slayin/core';
import { useMemo, useState } from 'react';
import { getAdminApi } from '../lib/env.ts';
import type { EventSetup, ImportResult } from './adminApi.ts';
import { errText } from './AdminApp.tsx';
import { detectColumns, FIELD_LABELS, mapRows, parseCsv, type ColumnMap, type Field } from './registration.ts';

const TEMPLATE =
  'First Name,Last Name,Age,Gender,Team,Squad,Order,Email,Phone\n' +
  'Ray,Delgado,44,M,Sponsor Team A,1,1,ray@example.com,\n' +
  'Kaden,Whitfield,15,M,Sponsor Team A,1,2,,\n';

export function RegistrationPanel({ setup, onChange }: { setup: EventSetup; onChange: () => Promise<void> }) {
  const api = getAdminApi();
  const [text, setText] = useState('');
  const [map, setMap] = useState<ColumnMap>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const data = useMemo(() => (text.trim() ? parseCsv(text) : []), [text]);
  const headers = data[0] ?? [];
  const mapped = useMemo(
    () => (data.length > 1 ? mapRows(data, map, setup.divisions.map((d) => d.name)) : null),
    [data, map, setup.divisions],
  );
  const errors = mapped?.problems.filter((p) => p.level === 'error') ?? [];
  const warnings = mapped?.problems.filter((p) => p.level === 'warning') ?? [];

  const load = (t: string) => {
    setText(t);
    setResult(null);
    const rows = parseCsv(t);
    setMap(rows[0] ? detectColumns(rows[0]) : {});
  };

  const doImport = async () => {
    if (!mapped) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.importRegistrations(setup.event.id, mapped.rows);
      setResult(res);
      if (res.ok) {
        setText('');
        await onChange();
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      {error && <div className="error" role="alert">{error}</div>}
      {result?.ok && (
        <div className="ok" role="status">
          Imported {result.shooters} shooters. Created {result.squadsCreated} squads and {result.teamsCreated} teams.
        </div>
      )}
      {result && !result.ok && (
        <div className="error" role="alert">
          Nothing was imported. Fix these rows and try again:
          <ul>{result.errors.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}</ul>
        </div>
      )}

      <div className="card stack">
        <div className="divhead">
          <span className="eyebrow">Import registrations</span>
          <span className="muted small">{setup.shooterCount} shooters registered</span>
        </div>
        <p className="muted small">
          Export the sign-up list as a CSV (EventCreate, Google Sheets, Excel all work) and choose the file, or paste it below.
          Columns are matched automatically; check them before importing. Contact details are stored privately and never shown on leaderboards.{' '}
          <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="registration-template.csv">Download a template</a>.
        </p>
        <input type="file" accept=".csv,text/csv" aria-label="Registration CSV file"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then(load); }} />
        <textarea className="text csv" rows={6} value={text} onChange={(e) => load(e.target.value)} placeholder="…or paste CSV here" aria-label="Paste CSV" />
      </div>

      {headers.length > 0 && (
        <div className="card stack">
          <span className="eyebrow">Columns</span>
          <div className="colmap">
            {(Object.keys(FIELD_LABELS) as Field[]).map((f) => (
              <label key={f} className="field">
                <span>{FIELD_LABELS[f]}</span>
                <select className="text" value={map[f] ?? ''} aria-label={`Column for ${FIELD_LABELS[f]}`}
                  onChange={(e) => setMap({ ...map, [f]: e.target.value === '' ? undefined : Number(e.target.value) })}>
                  <option value="">—</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
          <p className="muted small">No division column? Age + Gender places shooters automatically: Junior 12 &amp; under, Intermediate 13–18, Adult 19+.</p>
        </div>
      )}

      {mapped && (
        <div className="card stack">
          <div className="divhead">
            <span className="eyebrow">Preview</span>
            <span className="muted small">{mapped.rows.length} shooters · {errors.length} errors · {warnings.length} warnings</span>
          </div>
          {mapped.problems.length > 0 && (
            <ul className="problems">
              {mapped.problems.map((p, i) => (
                <li key={i} className={p.level}>{p.row ? `Row ${p.row}: ` : ''}{p.message}</li>
              ))}
            </ul>
          )}
          <div className="scroll">
            <table className="tbl">
              <thead><tr><th>Shooter</th><th>Board name</th><th>Division</th><th>Team</th><th>Squad</th></tr></thead>
              <tbody>
                {mapped.rows.slice(0, 50).map((r, i) => (
                  <tr key={i}>
                    <td>{r.first_name} {r.last_name}</td>
                    <td>{displayName({ firstName: r.first_name, lastName: r.last_name, isMinor: r.is_minor }, setup.event.adultNameFormat)}</td>
                    <td>{r.division || <span className="muted">—</span>}</td>
                    <td>{r.team || <span className="muted">—</span>}</td>
                    <td>{r.squad ? `${r.squad}${r.shoot_order ? ` (#${r.shoot_order})` : ''}` : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {mapped.rows.length > 50 && <p className="muted small">…and {mapped.rows.length - 50} more.</p>}
          </div>
          <button className="btn btn-clay" disabled={busy || errors.length > 0 || mapped.rows.length === 0} onClick={() => void doImport()}>
            {busy ? 'Importing…' : `Import ${mapped.rows.length} shooters`}
          </button>
        </div>
      )}
    </div>
  );
}
