import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { getAdminApi } from '../lib/env.ts';
import type { EventSetup, EventSettings } from './adminApi.ts';
import { errText } from './AdminApp.tsx';

export function EventPanel({ setup, onChange }: { setup: EventSetup; onChange: () => Promise<void> }) {
  const api = getAdminApi();
  const [ev, setEv] = useState<EventSettings>(setup.event);
  const [pins, setPins] = useState({ scorer: '', referee: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.updateEvent(ev.id, {
        name: ev.name, eventDate: ev.eventDate, venue: ev.venue, status: ev.status, tieBreak: ev.tieBreak,
        lewisGroups: ev.lewisGroups, teamBestN: ev.teamBestN, adultNameFormat: ev.adultNameFormat,
      });
      await onChange();
      setMsg({ ok: true, text: 'Event saved.' });
    } catch (err) {
      setMsg({ ok: false, text: errText(err) });
    }
  };

  const savePins = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.setPins(ev.id, pins.scorer, pins.referee);
      setPins({ scorer: '', referee: '' });
      setMsg({ ok: true, text: 'PINs changed. Tell your volunteers the new PINs.' });
    } catch (err) {
      setMsg({ ok: false, text: errText(err) });
    }
  };

  const ready = [
    [setup.stations.length > 0, `${setup.stations.length} stations`, 'stations'],
    [setup.divisions.length > 0, `${setup.divisions.length} divisions`, 'divisions'],
    [setup.shooterCount > 0, `${setup.shooterCount} shooters registered`, 'registration'],
    [setup.squads.some((q) => !q.isPractice), `${setup.squads.filter((q) => !q.isPractice).length} squads`, 'squads'],
    [setup.squads.some((q) => q.isPractice), 'Practice squad for phone checks', 'squads'],
  ] as const;

  return (
    <div className="stack">
      {msg && <div className={msg.ok ? 'ok' : 'error'} role="status">{msg.text}</div>}
      <div className="card stack">
        <span className="eyebrow">Ready for the shoot?</span>
        <ul className="checklist">
          {ready.map(([ok, text, tab]) => (
            <li key={text} className={ok ? 'done' : ''}>
              <span>{ok ? '✓' : '○'}</span> <Link to={`../${tab}`} relative="path">{text}</Link>
            </li>
          ))}
        </ul>
        <p className="muted small">
          Volunteers join at <b>/score</b> with event code <b className="mono">{setup.event.joinCode}</b>. Referees use the referee PIN, then open <b>/referee</b>.
        </p>
      </div>

      <form className="card stack" onSubmit={save}>
        <span className="eyebrow">Event details</span>
        <label className="field"><span>Name</span><input className="text" value={ev.name} onChange={(e) => setEv({ ...ev, name: e.target.value })} required /></label>
        <div className="two">
          <label className="field"><span>Date</span><input className="text" type="date" value={ev.eventDate ?? ''} onChange={(e) => setEv({ ...ev, eventDate: e.target.value || null })} /></label>
          <label className="field">
            <span>Status</span>
            <select className="text" value={ev.status} onChange={(e) => setEv({ ...ev, status: e.target.value as EventSettings['status'] })}>
              <option value="setup">Setting up</option>
              <option value="live">Live (scoring open)</option>
              <option value="locked">Locked (results final)</option>
            </select>
          </label>
        </div>
        <label className="field"><span>Venue</span><input className="text" value={ev.venue ?? ''} onChange={(e) => setEv({ ...ev, venue: e.target.value })} /></label>

        <span className="eyebrow" style={{ marginTop: 8 }}>Scoring rules</span>
        <div className="two">
          <label className="field">
            <span>Tie-break</span>
            <select className="text" value={ev.tieBreak} onChange={(e) => setEv({ ...ev, tieBreak: e.target.value as EventSettings['tieBreak'] })}>
              <option value="countback">Countback (last station backward)</option>
              <option value="shoot-off">Shoot-off (ties stay tied)</option>
            </select>
          </label>
          <label className="field">
            <span>Lewis Class groups</span>
            <input className="text" type="number" min={0} max={20} value={ev.lewisGroups ?? 0}
              onChange={(e) => setEv({ ...ev, lewisGroups: Number(e.target.value) > 0 ? Number(e.target.value) : null })} />
          </label>
        </div>
        <div className="two">
          <label className="field">
            <span>Team score counts</span>
            <select className="text" value={ev.teamBestN ?? 0} onChange={(e) => setEv({ ...ev, teamBestN: Number(e.target.value) || null })}>
              <option value={0}>All team members</option>
              {[3, 4, 5].map((n) => <option key={n} value={n}>Best {n} scores</option>)}
            </select>
          </label>
          <label className="field">
            <span>Adult names on boards</span>
            <select className="text" value={ev.adultNameFormat} onChange={(e) => setEv({ ...ev, adultNameFormat: e.target.value as EventSettings['adultNameFormat'] })}>
              <option value="full">Ray Delgado</option>
              <option value="initial-last">R. Delgado</option>
            </select>
          </label>
        </div>
        <p className="muted small">Shooters under 18 always appear as first name and last initial.</p>
        <button className="btn btn-clay">Save event</button>
      </form>

      <form className="card stack" onSubmit={savePins}>
        <span className="eyebrow">Volunteer PINs</span>
        <p className="muted small">PINs are stored scrambled and can't be shown again. Set new ones here if needed.</p>
        <div className="two">
          <label className="field"><span>New scorer PIN</span><input className="text" value={pins.scorer} onChange={(e) => setPins({ ...pins, scorer: e.target.value })} inputMode="numeric" pattern="[0-9]{4,8}" required /></label>
          <label className="field"><span>New referee PIN</span><input className="text" value={pins.referee} onChange={(e) => setPins({ ...pins, referee: e.target.value })} inputMode="numeric" pattern="[0-9]{4,8}" required /></label>
        </div>
        <button className="btn btn-ink">Change PINs</button>
      </form>
    </div>
  );
}
