import { displayName } from '@slayin/core';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Sabers } from '../components/Brand.tsx';
import { getAdminApi } from '../lib/env.ts';
import { squadQrUrl, stationQrUrl } from '../lib/qr.ts';
import type { AdminSquad, AdminStation, EventSetup } from './adminApi.ts';
import { errText } from './AdminApp.tsx';

function Qr({ url, label }: { url: string; label: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    void QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#16202a', light: '#ffffff' } }).then(setSvg);
  }, [url]);
  return <div className="qr" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />;
}

const presentationName: Record<AdminStation['presentation'], string> = {
  report_pair: 'report pairs',
  true_pair: 'true pairs',
  following_pair: 'following pairs',
  single: 'singles',
};

function SquadCard({ squad, setup, origin }: { squad: AdminSquad; setup: EventSetup; origin: string }) {
  return (
    <section className="pcard">
      <header className="pband">
        <Sabers />
        <span className="rye">Slayin' Clays</span>
        {squad.isPractice && <span className="practice">PRACTICE</span>}
      </header>
      <div className="pbody">
        <div className="phead">
          <div>
            <div className="lab clay">Squad</div>
            <div className="rye big">{squad.number}</div>
          </div>
          {squad.startStationNumber !== null && (
            <div className="start">
              <div className="lab">Start at</div>
              <div className="rye">Station {squad.startStationNumber}</div>
            </div>
          )}
        </div>
        <ol className="pmembers">
          {squad.members.map((m) => (
            <li key={m.shooterId}>
              <span>{displayName(m, setup.event.adultNameFormat)}</span>
              <small>{m.division ?? ''}</small>
            </li>
          ))}
        </ol>
        <div className="pqr">
          <Qr url={squadQrUrl(origin, squad.qrToken)} label={`QR code for squad ${squad.number}`} />
          <div>
            <b>Scan for your live scores</b>
            <p>Station scorers scan this card when your squad arrives.</p>
            <span className="mono code">{squad.qrToken}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function StationSign({ station, setup, origin }: { station: AdminStation; setup: EventSetup; origin: string }) {
  return (
    <section className="psign">
      <header className="pband">
        <Sabers />
        <span className="rye">Slayin' Clays</span>
      </header>
      <div className="psign-body">
        <div className="lab clay">Station</div>
        <div className="rye huge">{station.number}</div>
        <div className="sname">{station.name}</div>
        <div className="muted">{station.targetCount} targets · {presentationName[station.presentation]}</div>
        <Qr url={stationQrUrl(origin, station.qrToken)} label={`QR code for station ${station.number}`} />
        <b className="cta">Volunteers: scan to score this station</b>
        <span className="mono code">Code: {station.qrToken} · Event {setup.event.joinCode}</span>
      </div>
    </section>
  );
}

/** Printable squad cards (4 per page) or station signs (1 per page). Use the browser's Print → Save as PDF. */
export function PrintPage() {
  const { eventId = '', kind = 'squads' } = useParams();
  const [setup, setSetup] = useState<EventSetup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const origin = window.location.origin;

  useEffect(() => {
    getAdminApi().loadSetup(eventId).then(setSetup, (e) => setError(errText(e)));
  }, [eventId]);

  const squads = setup ? [...setup.squads].sort((a, b) => Number(a.isPractice) - Number(b.isPractice) || a.number - b.number) : [];

  return (
    <div className={`print print-${kind}`}>
      <div className="print-controls">
        <Link className="btn btn-line btn-sm" to={`/admin/${eventId}/squads`}>← Back</Link>
        <button className="btn btn-clay btn-sm" onClick={() => window.print()}>Print / Save as PDF</button>
        <span className="muted small">
          {kind === 'squads' ? `${squads.length} squad cards, 4 per page` : `${setup?.stations.length ?? 0} station signs, 1 per page`}
        </span>
      </div>
      {error && <div className="error">{error}</div>}
      {setup && kind === 'squads' && <div className="pgrid">{squads.map((q) => <SquadCard key={q.id} squad={q} setup={setup} origin={origin} />)}</div>}
      {setup && kind === 'stations' && setup.stations.map((s) => <StationSign key={s.id} station={s} setup={setup} origin={origin} />)}
    </div>
  );
}
