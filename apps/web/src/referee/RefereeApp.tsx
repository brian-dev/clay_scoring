import { displayName } from '@slayin/core';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Band } from '../components/Brand.tsx';
import { UserFacingError, type DisputeView, type TargetScore } from '../lib/api.ts';
import { getApi } from '../lib/env.ts';
import { deviceId, loadSession } from '../lib/session.ts';

const msg = (e: unknown) => (e instanceof UserFacingError || e instanceof Error ? e.message : 'Something went wrong.');
const timeAgo = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'just now' : m === 1 ? '1 minute ago' : `${m} minutes ago`;
};

function DisputeCard({ d, onDone }: { d: DisputeView; onDone: (text: string) => void }) {
  const api = getApi();
  const [scores, setScores] = useState<TargetScore[] | null>(null);
  const [changes, setChanges] = useState<Record<number, 'hit' | 'miss'>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = displayName(d);

  const open = async () => {
    try {
      setScores(await api.stationScores(d.shooterId, d.stationId));
    } catch (e) {
      setError(msg(e));
    }
  };

  const changed = Object.keys(changes).length > 0;
  const resultFor = (t: number) => changes[t] ?? scores?.find((s) => s.targetNo === t)?.result ?? null;
  const total = scores ? Array.from({ length: d.targetCount }, (_, i) => resultFor(i + 1)).filter((r) => r === 'hit').length : 0;

  const settle = async () => {
    if (!reason.trim()) {
      setError('Give a short reason, e.g. "Visible piece on target 3".');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (changed && scores) {
        const taps = Object.entries(changes).map(([t, result]) => {
          const prev = scores.find((s) => s.targetNo === Number(t));
          return {
            id: crypto.randomUUID(),
            shooter_id: d.shooterId,
            station_id: d.stationId,
            squad_id: d.squadId,
            target_no: Number(t),
            result,
            kind: 'official' as const,
            device_id: deviceId(),
            device_ts: new Date().toISOString(),
            ...(prev ? { supersedes_id: prev.recordId } : {}),
            reason: reason.trim(),
          };
        });
        const results = await api.transport.recordTaps(taps);
        const bad = results.find((r) => r.status === 'rejected');
        if (bad) throw new Error(bad.reason ?? 'A correction was refused.');
      }
      await api.resolveDispute(d.id, changed ? 'changed' : 'upheld', reason.trim());
      onDone(changed ? `Score changed for ${name} at station ${d.stationNumber}. Dispute settled.` : `Score upheld for ${name}. Dispute settled.`);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack dispute">
      <div className="divhead">
        <span className="eyebrow">Station {d.stationNumber}{d.stationName ? ` · ${d.stationName}` : ''}</span>
        <span className="lab muted">Squad {d.squadNumber}</span>
      </div>
      <h2 style={{ fontSize: '1.4rem' }}>{name}</h2>
      {d.note && <p style={{ margin: 0 }}>“{d.note}”</p>}
      <p className="meta" style={{ margin: 0 }}>Raised {timeAgo(d.raisedAt)}{d.raisedBy ? ` by ${d.raisedBy}` : ''}</p>
      {error && <div className="error" role="alert">{error}</div>}
      {!scores ? (
        <button className="btn btn-ink" onClick={() => void open()}>Review scores</button>
      ) : (
        <>
          <p className="muted small">Tap a target to switch it between broken and lost. Station total: <b>{total}</b> / {d.targetCount}</p>
          <div className="fixgrid">
            {Array.from({ length: d.targetCount }, (_, i) => {
              const t = i + 1;
              const r = resultFor(t);
              return (
                <button
                  key={t}
                  className={`dot ${r ?? ''} ${changes[t] ? 'changed' : ''}`}
                  aria-label={`Target ${t}: ${r ?? 'not scored'}`}
                  onClick={() =>
                    setChanges((c) => {
                      const original = scores.find((s) => s.targetNo === t)?.result;
                      const next = resultFor(t) === 'hit' ? 'miss' : 'hit';
                      const { [t]: _drop, ...rest } = c;
                      return next === original ? rest : { ...rest, [t]: next };
                    })
                  }
                >
                  {t}
                </button>
              );
            })}
          </div>
          <label className="field">
            <span>Reason (required)</span>
            <input className="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Visible piece on target 3" />
          </label>
          <button className="btn btn-clay" disabled={busy} onClick={() => void settle()}>
            {changed ? `Save ${Object.keys(changes).length} change${Object.keys(changes).length === 1 ? '' : 's'} and settle` : 'Uphold score and settle'}
          </button>
        </>
      )}
    </div>
  );
}

/** Referee queue: open disputes, review a station's scores, correct with a reason, settle. */
export function RefereeApp() {
  const api = getApi();
  const session = loadSession();
  const [disputes, setDisputes] = useState<DisputeView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const allowed = session && (session.role === 'referee' || session.role === 'admin');

  const load = useCallback(async () => {
    if (!session) return;
    try {
      setDisputes(await api.listDisputes(session.eventId));
      setError(null);
    } catch (e) {
      setError(msg(e));
    }
  }, [api, session?.eventId]); // eslint-disable-line

  useEffect(() => {
    if (!allowed) return;
    void load();
    const t = setInterval(() => document.visibilityState === 'visible' && void load(), 20_000);
    return () => clearInterval(t);
  }, [allowed, load]);

  return (
    <>
      <Band label={session ? `Referee · ${session.displayName}` : 'Referee'} right={disputes ? <span className="live">{disputes.length} open</span> : undefined} />
      <main className="page stack">
        {!allowed ? (
          <div className="card stack">
            <h2>Referees only</h2>
            <p style={{ margin: 0 }}>Sign in on the scoring page with the event code and the <b>referee PIN</b>, then come back here.</p>
            <Link className="btn btn-clay" to="/score">Go to sign-in</Link>
          </div>
        ) : (
          <>
            {notice && <div className="ok" role="status">{notice}</div>}
            {error && <div className="error" role="alert">{error}</div>}
            {disputes === null && !error && <p className="muted">Loading disputes…</p>}
            {disputes?.length === 0 && (
              <div className="card"><p style={{ margin: 0 }}>No open disputes. This list refreshes on its own.</p></div>
            )}
            {disputes?.map((d) => (
              <DisputeCard
                key={d.id}
                d={d}
                onDone={(text) => {
                  setNotice(text);
                  void load();
                }}
              />
            ))}
            <button className="btn btn-line btn-sm" onClick={() => void load()}>Refresh</button>
          </>
        )}
      </main>
    </>
  );
}
