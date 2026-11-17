import { UserFacingError, type DisputeView, type ScoringApi, type SquadInfo, type TargetScore } from './api.ts';
import type { ConfirmPayload, DisputePayload, TapPayload } from './outbox.ts';
import { TransportError, type TapResult, type Transport } from './sync.ts';
import type { StationInfo } from '../scorer/stationScoring.ts';

/**
 * Demo mode: runs the whole scoring flow in the browser with no backend, using the
 * same data as supabase/seed.sql. Used when VITE_SUPABASE_URL is not set, for trying
 * the app, volunteer training, and UI work.
 *
 * Event code SLAYIN · scorer PIN 1234 · referee PIN 5678
 * Station codes station-1 .. station-5 · squad cards squad-1, squad-2, squad-3, squad-practice
 */

const pairs = [1, 2, 3, 4].map((ord) => ({ ord, kind: 'report_pair' as const, target_count: 2 }));
const stationNames = ['Springing teal', 'Crossing pair', 'Rabbit', 'Incomer', 'Tower'];
const stations: Record<string, StationInfo> = Object.fromEntries(
  stationNames.map((name, i) => [
    `station-${i + 1}`,
    { id: `demo-st-${i + 1}`, number: i + 1, name, targetCount: 8, presentations: pairs },
  ]),
);

const sh = (id: string, firstName: string, lastName: string, isMinor = false) => ({ id, firstName, lastName, isMinor });
const squads: Record<string, SquadInfo> = {
  'squad-1': {
    id: 'demo-sq-1', number: 1, isPractice: false,
    shooters: [sh('d101', 'Ray', 'Delgado'), sh('d102', 'Kaden', 'Whitfield', true), sh('d103', 'Tom', 'Barrera'), sh('d104', 'Lisa', 'Strand')],
  },
  'squad-2': {
    id: 'demo-sq-2', number: 2, isPractice: false,
    shooters: [sh('d105', 'Jace', 'Castillo', true), sh('d106', 'Nora', 'Ortiz', true), sh('d107', 'Sara', 'Vance'), sh('d108', 'Wyatt', 'Tate', true)],
  },
  'squad-3': {
    id: 'demo-sq-3', number: 3, isPractice: false,
    shooters: [sh('d109', 'Emma', 'Ruiz', true), sh('d110', 'Gus', 'Holloway')],
  },
  'squad-practice': {
    id: 'demo-sq-99', number: 99, isPractice: true,
    shooters: [sh('d111', 'Practice', 'Shooter A'), sh('d112', 'Practice', 'Shooter B')],
  },
};

interface DemoDispute {
  id: string;
  squadId: string;
  stationId: string;
  shooterId: string;
  note: string;
  raisedAt: string;
  resolved: boolean;
}

interface DemoStore {
  taps: (TapPayload & { serverTs: string })[];
  confirmed: string[];
  disputes: DemoDispute[];
}

const STORE_KEY = 'cs.demo.scoring';

/** Demo "server": keeps taps, confirmations and disputes in localStorage so the referee page can see them. */
class DemoServer implements Transport {
  store: DemoStore;
  constructor() {
    try {
      this.store = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') ?? { taps: [], confirmed: [], disputes: [] };
    } catch {
      this.store = { taps: [], confirmed: [], disputes: [] };
    }
  }
  private save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.store));
    } catch {
      /* memory only */
    }
  }
  /** Flip from the dev console to rehearse "no signal": window.__demoOffline = true */
  private get offline() {
    return typeof window !== 'undefined' && (window as unknown as { __demoOffline?: boolean }).__demoOffline === true;
  }
  private async latency() {
    await new Promise((r) => setTimeout(r, 150));
    if (this.offline) throw new TransportError('Failed to fetch', true);
  }
  private locked(squadId: string, stationId: string) {
    return this.store.confirmed.includes(`${squadId}|${stationId}`) || this.store.disputes.some((d) => d.squadId === squadId && d.stationId === stationId);
  }
  async recordTaps(taps: TapPayload[]): Promise<TapResult[]> {
    await this.latency();
    const results = taps.map((t): TapResult => {
      if (this.store.taps.some((x) => x.id === t.id)) return { id: t.id, status: 'duplicate' };
      if (t.kind === 'official' && this.locked(t.squad_id, t.station_id) && !(t.supersedes_id && t.reason)) {
        return { id: t.id, status: 'rejected', reason: 'station already confirmed; a referee correction with a reason is required' };
      }
      this.store.taps.push({ ...t, serverTs: new Date().toISOString() });
      return { id: t.id, status: 'ok' };
    });
    this.save();
    return results;
  }
  async confirmStation(p: ConfirmPayload) {
    await this.latency();
    this.store.confirmed.push(`${p.squad_id}|${p.station_id}`);
    this.save();
  }
  async raiseDispute(p: DisputePayload) {
    await this.latency();
    this.store.disputes.push({
      id: `dp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      squadId: p.squad_id,
      stationId: p.station_id,
      shooterId: p.shooter_id,
      note: p.note,
      raisedAt: new Date().toISOString(),
      resolved: false,
    });
    this.save();
  }
  scores(shooterId: string, stationId: string): TargetScore[] {
    const mine = this.store.taps.filter((t) => t.shooter_id === shooterId && t.station_id === stationId && t.kind === 'official');
    const superseded = new Set(mine.map((t) => t.supersedes_id).filter(Boolean));
    const byTarget = new Map<number, TargetScore>();
    for (const t of mine) if (!superseded.has(t.id)) byTarget.set(t.target_no, { targetNo: t.target_no, result: t.result, recordId: t.id });
    return [...byTarget.values()].sort((a, b) => a.targetNo - b.targetNo);
  }
}

const stationById = (id: string) => Object.values(stations).find((s) => s.id === id);
const squadById = (id: string) => Object.values(squads).find((q) => q.id === id);

export function createDemoApi(): ScoringApi {
  const server = new DemoServer();
  return {
    mode: 'demo',
    transport: server,
    async join(joinCode, pin, displayName) {
      if (!displayName.trim()) throw new UserFacingError('Please enter your name.');
      if (joinCode.trim().toUpperCase() !== 'SLAYIN' || (pin !== '1234' && pin !== '5678')) {
        throw new UserFacingError('Invalid event code or PIN.');
      }
      return {
        eventId: 'demo-event',
        eventName: "Slayin' Clays Demo",
        staffId: 'demo-staff',
        role: pin === '5678' ? 'referee' : 'scorer',
        displayName: displayName.trim(),
      };
    },
    async startStation(token) {
      const st = stations[token];
      if (!st) throw new UserFacingError('Unknown station code.');
      return st;
    },
    async squadByToken(token) {
      const sq = squads[token];
      if (!sq) throw new UserFacingError('Unknown squad card.');
      return sq;
    },
    async listDisputes(): Promise<DisputeView[]> {
      return server.store.disputes
        .filter((d) => !d.resolved)
        .map((d) => {
          const st = stationById(d.stationId);
          const sq = squadById(d.squadId);
          const sh = sq?.shooters.find((x) => x.id === d.shooterId);
          return {
            id: d.id, raisedAt: d.raisedAt, note: d.note || null, raisedBy: 'Station scorer',
            squadId: d.squadId, squadNumber: sq?.number ?? 0,
            stationId: d.stationId, stationNumber: st?.number ?? 0, stationName: st?.name ?? '', targetCount: st?.targetCount ?? 0,
            shooterId: d.shooterId, firstName: sh?.firstName ?? '', lastName: sh?.lastName ?? '', isMinor: sh?.isMinor ?? false,
          };
        });
    },
    async stationScores(shooterId, stationId) {
      return server.scores(shooterId, stationId);
    },
    async resolveDispute(disputeId, _resolution, reason) {
      if (!reason.trim()) throw new UserFacingError('Choose upheld or changed and give a reason.');
      const d = server.store.disputes.find((x) => x.id === disputeId);
      if (!d || d.resolved) throw new UserFacingError('This dispute is already settled.');
      d.resolved = true;
      localStorage.setItem('cs.demo.scoring', JSON.stringify(server.store));
    },
  };
}
