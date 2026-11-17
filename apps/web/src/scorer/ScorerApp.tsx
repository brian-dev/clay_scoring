import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Band } from '../components/Brand.tsx';
import { InstallBanner } from '../components/InstallBanner.tsx';
import { QrScan } from '../components/QrScan.tsx';
import { SyncBadge } from '../components/SyncBadge.tsx';
import { UserFacingError, type SquadInfo, type StaffSession } from '../lib/api.ts';
import { APP_VERSION, getApi, isDemo } from '../lib/env.ts';
import { Outbox } from '../lib/outbox.ts';
import { deviceId, loadDoneSquads, loadSession, loadStation, saveSession, saveStation } from '../lib/session.ts';
import { Syncer, type SyncStatus } from '../lib/sync.ts';
import type { StationInfo } from './stationScoring.ts';
import { JoinScreen } from './JoinScreen.tsx';
import { ScoringScreen } from './ScoringScreen.tsx';
import { RejectedList } from './RejectedList.tsx';

// One outbox and syncer per page load.
const outbox = new Outbox(isDemo ? 'clay-scoring-demo' : 'clay-scoring');
const syncer = new Syncer(outbox, getApi().transport);

const message = (e: unknown) =>
  e instanceof UserFacingError ? e.message : 'Something went wrong. Check your signal and try again.';

export function ScorerApp() {
  const api = getApi();
  const [params, setParams] = useSearchParams();
  const [session, setSession] = useState<StaffSession | null>(loadSession);
  const [station, setStation] = useState<StationInfo | null>(loadStation);
  const [squad, setSquad] = useState<SquadInfo | null>(null);
  const [status, setStatus] = useState<SyncStatus>({ pending: 0, rejected: 0, syncing: false, lastSuccessAt: null, lastError: null });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showProblems, setShowProblems] = useState(false);

  useEffect(() => {
    syncer.start();
    const off = syncer.onStatus(setStatus);
    void outbox.prune();
    return () => {
      off();
    };
  }, []);

  const openStation = useCallback(
    async (token: string) => {
      setBusy(true);
      setError(null);
      try {
        const st = await api.startStation(token, deviceId(), APP_VERSION);
        saveStation(st);
        setStation(st);
        setNotice(`Scoring station ${st.number}${st.name ? ` · ${st.name}` : ''}.`);
      } catch (e) {
        setError(message(e));
      } finally {
        setBusy(false);
      }
    },
    [api],
  );

  // A station sign scanned with the phone camera opens /score?station=<token>.
  const stationParam = params.get('station');
  useEffect(() => {
    if (session && stationParam) {
      setParams({}, { replace: true });
      void openStation(stationParam);
    }
  }, [session, stationParam, openStation, setParams]);

  const openSquad = useCallback(
    async (token: string) => {
      if (!station) return;
      setBusy(true);
      setError(null);
      try {
        const sq = await api.squadByToken(token);
        if (!sq.isPractice && loadDoneSquads(station.id).includes(sq.id)) {
          setNotice(`Squad ${sq.number} was already confirmed at this station on this phone. Any change now needs a referee.`);
        }
        setSquad(sq);
      } catch (e) {
        setError(message(e));
      } finally {
        setBusy(false);
      }
    },
    [api, station],
  );

  const badge = useMemo(
    () => (
      <button style={{ background: 'none', border: 'none', padding: 0 }} onClick={() => setShowProblems((v) => !v)}>
        <SyncBadge status={status} />
      </button>
    ),
    [status],
  );

  const label = station ? `Station ${station.number}${session ? ` · ${session.displayName}` : ''}` : session ? session.eventName : 'Volunteer scoring';

  return (
    <>
      <Band label={label} right={session ? badge : isDemo ? <span className="sync wait">Demo mode</span> : undefined} />
      <main className="page stack">
        {showProblems && <RejectedList outbox={outbox} onClose={() => setShowProblems(false)} />}
        {error && <div className="error" role="alert">{error}</div>}
        {notice && !squad && <div className="ok">{notice}</div>}

        {!session && (
          <>
            <InstallBanner />
            <JoinScreen
              demo={isDemo}
              onJoin={async (code, pin, name) => {
                setError(null);
                try {
                  const s = await api.join(code, pin, name);
                  saveSession(s);
                  setSession(s);
                } catch (e) {
                  setError(message(e));
                }
              }}
            />
          </>
        )}

        {session && session.role !== 'scorer' && (
          <Link className="btn btn-ink btn-block" to="/referee">Open the referee dispute queue</Link>
        )}

        {session && !station && (
          <div className="card stack">
            <span className="eyebrow">Step 1</span>
            <h2>Scan your station sign</h2>
            <QrScan kind="station" prompt="Point the camera at the QR code on the station sign." onCode={openStation} busy={busy} />
          </div>
        )}

        {session && station && !squad && (
          <div className="card stack">
            <span className="eyebrow">Station {station.number} · {station.targetCount} targets</span>
            <h2>Scan the squad card</h2>
            <QrScan kind="squad" prompt="Scan the QR code on the squad's card when they arrive." onCode={openSquad} busy={busy} />
            <button
              className="btn btn-line btn-sm"
              onClick={() => {
                saveStation(null);
                setStation(null);
                setNotice(null);
              }}
            >
              Change station
            </button>
            <button
              className="btn btn-line btn-sm"
              onClick={() => {
                saveStation(null);
                saveSession(null);
                setStation(null);
                setSession(null);
              }}
            >
              Sign out
            </button>
          </div>
        )}

        {session && station && squad && (
          <ScoringScreen
            station={station}
            squad={squad}
            outbox={outbox}
            onQueued={() => syncer.kick()}
            onExit={(msg) => {
              setSquad(null);
              setNotice(msg);
            }}
          />
        )}
      </main>
    </>
  );
}
