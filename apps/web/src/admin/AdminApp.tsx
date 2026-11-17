import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Band } from '../components/Brand.tsx';
import { getAdminApi, isDemo } from '../lib/env.ts';
import { AdminError, type EventSetup, type EventSummary } from './adminApi.ts';
import { DivisionsPanel } from './DivisionsPanel.tsx';
import { EventPanel } from './EventPanel.tsx';
import { RegistrationPanel } from './RegistrationPanel.tsx';
import { SquadsPanel } from './SquadsPanel.tsx';
import { StationsPanel } from './StationsPanel.tsx';

export const errText = (e: unknown) => (e instanceof AdminError || e instanceof Error ? e.message : 'Something went wrong.');

type Tab = 'event' | 'stations' | 'divisions' | 'registration' | 'squads';
const TABS: [Tab, string][] = [
  ['event', 'Event'],
  ['stations', 'Stations'],
  ['divisions', 'Divisions'],
  ['registration', 'Registration'],
  ['squads', 'Squads & printing'],
];

function SignIn({ onDone }: { onDone: () => void }) {
  const api = getAdminApi();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (mode === 'in') await api.signIn(email, password);
      else await api.signUp(email, password);
      onDone();
    } catch (err) {
      setError(errText(err));
    }
  };
  return (
    <form className="card stack" onSubmit={submit}>
      <span className="eyebrow">Organizers</span>
      <h2>{mode === 'in' ? 'Sign in' : 'Create an organizer account'}</h2>
      {error && <div className="error" role="alert">{error}</div>}
      <label className="field"><span>Email</span><input className="text" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label className="field"><span>Password</span><input className="text" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required /></label>
      <button className="btn btn-clay">{mode === 'in' ? 'Sign in' : 'Create account'}</button>
      <button type="button" className="btn btn-line btn-sm" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
        {mode === 'in' ? 'New organizer? Create an account' : 'Have an account? Sign in'}
      </button>
    </form>
  );
}

function EventList({ onOpen }: { onOpen: (id: string) => void }) {
  const api = getAdminApi();
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "Slayin' Clays 2027", joinCode: '', scorerPin: '', refereePin: '', displayName: '' });

  useEffect(() => {
    api.listEvents().then(setEvents, (e) => setError(errText(e)));
  }, [api]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const id = await api.createEvent(form);
      onOpen(id);
    } catch (err) {
      setError(errText(err));
    }
  };

  return (
    <div className="stack">
      {error && <div className="error" role="alert">{error}</div>}
      <div className="card stack">
        <span className="eyebrow">Your events</span>
        {events === null && <p className="muted">Loading…</p>}
        {events?.length === 0 && <p className="muted" style={{ margin: 0 }}>No events yet. Create one below.</p>}
        {events?.map((ev) => (
          <button key={ev.id} className="btn btn-ink btn-block" style={{ justifyContent: 'space-between' }} onClick={() => onOpen(ev.id)}>
            <span>{ev.name}</span>
            <span className="mono" style={{ fontSize: '0.85rem' }}>{ev.eventDate ?? 'date TBA'} · {ev.joinCode}</span>
          </button>
        ))}
      </div>
      {!isDemo && (
        <form className="card stack" onSubmit={create}>
          <span className="eyebrow">New event</span>
          <label className="field"><span>Event name</span><input className="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
          <label className="field"><span>Event code (volunteers type this)</span><input className="text" value={form.joinCode} onChange={(e) => setForm({ ...form, joinCode: e.target.value.toUpperCase() })} pattern="[A-Za-z0-9]{4,12}" required /></label>
          <div className="two">
            <label className="field"><span>Scorer PIN</span><input className="text" value={form.scorerPin} onChange={(e) => setForm({ ...form, scorerPin: e.target.value })} inputMode="numeric" pattern="[0-9]{4,8}" required /></label>
            <label className="field"><span>Referee PIN</span><input className="text" value={form.refereePin} onChange={(e) => setForm({ ...form, refereePin: e.target.value })} inputMode="numeric" pattern="[0-9]{4,8}" required /></label>
          </div>
          <label className="field"><span>Your name</span><input className="text" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></label>
          <button className="btn btn-clay">Create event</button>
        </form>
      )}
    </div>
  );
}

export function AdminApp() {
  const api = getAdminApi();
  const navigate = useNavigate();
  const { eventId, tab = 'event' } = useParams();
  const [user, setUser] = useState<{ email: string } | null | undefined>(undefined);
  const [setup, setSetup] = useState<EventSetup | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshUser = useCallback(() => {
    api.currentUser().then(setUser, () => setUser(null));
  }, [api]);
  useEffect(refreshUser, [refreshUser]);

  const reload = useCallback(async () => {
    if (!eventId) return;
    try {
      setSetup(await api.loadSetup(eventId));
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, [api, eventId]);
  useEffect(() => {
    setSetup(null);
    if (user) void reload();
  }, [user, reload]);

  return (
    <div className="admin">
      <Band
        label={setup ? setup.event.name : 'Organizer console'}
        right={user ? <button className="sync wait" style={{ border: 'none' }} onClick={() => void api.signOut().then(refreshUser)}>Sign out</button> : undefined}
      />
      <main className="page wide stack">
        {isDemo && <div className="note">Demo mode: changes are saved in this browser only.</div>}
        {error && <div className="error" role="alert">{error}</div>}
        {user === undefined && <p className="muted">Loading…</p>}
        {user === null && <SignIn onDone={refreshUser} />}
        {user && !eventId && <EventList onOpen={(id) => navigate(`/admin/${id}/event`)} />}
        {user && eventId && (
          <>
            <nav className="tabs admin-tabs">
              {TABS.map(([t, label]) => (
                <Link key={t} to={`/admin/${eventId}/${t}`} className={tab === t ? 'on' : ''}>{label}</Link>
              ))}
            </nav>
            {!setup && !error && <p className="muted">Loading event…</p>}
            {setup && tab === 'event' && <EventPanel setup={setup} onChange={reload} />}
            {setup && tab === 'stations' && <StationsPanel setup={setup} onChange={reload} />}
            {setup && tab === 'divisions' && <DivisionsPanel setup={setup} onChange={reload} />}
            {setup && tab === 'registration' && <RegistrationPanel setup={setup} onChange={reload} />}
            {setup && tab === 'squads' && <SquadsPanel setup={setup} onChange={reload} />}
          </>
        )}
      </main>
    </div>
  );
}
