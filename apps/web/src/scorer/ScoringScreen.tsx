import { displayName } from '@slayin/core';
import { useEffect, useMemo, useState } from 'react';
import type { SquadInfo } from '../lib/api.ts';
import type { Outbox } from '../lib/outbox.ts';
import { clearScoring, deviceId, loadScoring, markSquadDone, saveScoring } from '../lib/session.ts';
import {
  cells,
  initialState,
  isComplete,
  markFor,
  select,
  tallies,
  tap,
  targetLabel,
  undo,
  type ScoringState,
  type StationInfo,
} from './stationScoring.ts';

type Phase = 'scoring' | 'confirm' | 'dispute';

export function ScoringScreen({
  station,
  squad,
  outbox,
  onQueued,
  onExit,
}: {
  station: StationInfo;
  squad: SquadInfo;
  outbox: Outbox;
  onQueued: () => void;
  onExit: (message: string) => void;
}) {
  const all = useMemo(() => cells(squad.shooters, station.targetCount), [squad, station]);
  const [state, setState] = useState<ScoringState>(
    () => loadScoring(station.id, squad.id) ?? initialState(station.id, squad.id, squad.isPractice ? 'practice' : 'official'),
  );
  const [phase, setPhase] = useState<Phase>('scoring');
  const [disputeShooter, setDisputeShooter] = useState<string>('');
  const [disputeNote, setDisputeNote] = useState('');

  useEffect(() => saveScoring(state), [state]);

  const complete = isComplete(state, all);
  const current = all[state.cursor]!;
  const shooter = squad.shooters[current.shooterIndex]!;
  const totals = tallies(state, squad.shooters, station.targetCount);
  const name = (id: string) => {
    const s = squad.shooters.find((x) => x.id === id)!;
    return displayName(s);
  };

  const record = async (result: 'hit' | 'miss') => {
    const out = tap(state, all, result, { deviceId: deviceId(), newId: () => crypto.randomUUID() });
    setState(out.state);
    await outbox.add({ kind: 'tap', payload: out.payload });
    onQueued();
    if (navigator.vibrate) navigator.vibrate(30);
  };

  const finish = (message: string) => {
    if (!squad.isPractice) markSquadDone(station.id, squad.id);
    clearScoring(station.id, squad.id);
    onExit(message);
  };

  if (phase === 'confirm') {
    return (
      <div className="card stack">
        <span className="eyebrow">Squad {squad.number} · Station {station.number}</span>
        <h2>Check the totals</h2>
        <p className="muted" style={{ margin: 0 }}>Show the squad this screen. The squad leader confirms, or asks for a referee.</p>
        <div className="totals">
          {squad.shooters.map((s, i) => (
            <div className="row" key={s.id}>
              <span style={{ fontWeight: 600 }}>{displayName(s)}</span>
              <span>
                <span className="big">{totals[i]!.hits}</span>
                <span className="muted"> / {station.targetCount}</span>
              </span>
            </div>
          ))}
        </div>
        <button
          className="btn btn-clay btn-block"
          onClick={async () => {
            await outbox.add({ kind: 'confirm', payload: { squad_id: squad.id, station_id: station.id } });
            onQueued();
            finish(squad.isPractice ? 'Practice squad done. Nothing was counted.' : `Squad ${squad.number} confirmed. Ready for the next squad.`);
          }}
        >
          Squad confirms
        </button>
        <button className="btn btn-line btn-block" onClick={() => setPhase('dispute')}>Dispute a score</button>
        <button className="btn btn-line btn-block" onClick={() => setPhase('scoring')}>Back to fix a target</button>
      </div>
    );
  }

  if (phase === 'dispute') {
    return (
      <form
        className="card stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!disputeShooter) return;
          await outbox.add({
            kind: 'dispute',
            payload: { squad_id: squad.id, station_id: station.id, shooter_id: disputeShooter, note: disputeNote.trim() },
          });
          onQueued();
          finish(`Referee called for ${name(disputeShooter)}. Squad ${squad.number} can move on.`);
        }}
      >
        <span className="eyebrow">Call a referee</span>
        <h2>Which shooter?</h2>
        {squad.shooters.map((s) => (
          <label key={s.id} className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 12 }}>
            <input type="radio" name="sh" value={s.id} checked={disputeShooter === s.id} onChange={() => setDisputeShooter(s.id)} />
            <span>{displayName(s)}</span>
          </label>
        ))}
        <label className="field">
          <span>What's the disagreement? (optional)</span>
          <input className="text" value={disputeNote} onChange={(e) => setDisputeNote(e.target.value)} placeholder="Target 3 broke" />
        </label>
        <button className="btn btn-clay btn-block" disabled={!disputeShooter}>Call referee</button>
        <button type="button" className="btn btn-line btn-block" onClick={() => setPhase('confirm')}>Cancel</button>
      </form>
    );
  }

  return (
    <div className="stack">
      <div className="card stack">
        <div className="score-head">
          <span className="eyebrow">Squad {squad.number}{squad.isPractice ? ' · Practice' : ''}</span>
          <span className="lab muted">Shooter {current.shooterIndex + 1} of {squad.shooters.length}</span>
        </div>
        {complete ? (
          <>
            <p className="shooter-name">All targets scored</p>
            <button className="btn btn-clay btn-block" onClick={() => setPhase('confirm')}>Show totals to the squad</button>
          </>
        ) : (
          <>
            <p className="shooter-name">{displayName(shooter)}</p>
            <p className="target-label">{targetLabel(station, current.targetNo)}</p>
            <div className="hm">
              <button className="hit" onClick={() => void record('hit')}>HIT</button>
              <button className="miss" onClick={() => void record('miss')}>MISS</button>
            </div>
          </>
        )}
        <button className="btn btn-line btn-sm" onClick={() => setState(undo(state))} disabled={state.cursor === 0}>
          ↶ Undo last tap
        </button>
      </div>

      <div className="card grid" aria-label="Scores at this station">
        {squad.shooters.map((s, si) => (
          <div className={`row${si === current.shooterIndex && !complete ? ' current' : ''}`} key={s.id}>
            <div className="stack" style={{ gap: 4 }}>
              <span className="nm">{displayName(s)}</span>
              <div className="dots">
                {Array.from({ length: station.targetCount }, (_, t) => {
                  const idx = si * station.targetCount + t;
                  const m = markFor(state, s.id, t + 1);
                  const cls = ['dot', m?.result ?? '', idx === state.cursor && !complete ? 'cursor' : ''].join(' ');
                  return (
                    <button
                      key={t}
                      className={cls}
                      aria-label={`${displayName(s)} target ${t + 1}: ${m?.result ?? 'not scored'}`}
                      onClick={() => setState(select(state, all, idx))}
                    >
                      {t + 1}
                    </button>
                  );
                })}
              </div>
            </div>
            <span />
            <span className="tally">{totals[si]!.hits}</span>
          </div>
        ))}
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>Tap any numbered dot to re-score that target.</p>
      </div>

      <button
        className="btn btn-line btn-sm"
        onClick={() => {
          if (confirm('Leave this squad? Scores already tapped stay saved.')) onExit('Left the squad without confirming.');
        }}
      >
        Leave squad
      </button>
    </div>
  );
}
