import { UserFacingError, type ScoringApi, type SquadInfo } from './api.ts';
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

class DemoTransport implements Transport {
  private stored = new Map<string, TapPayload>();
  /** Flip from the dev console to rehearse "no signal": window.__demoOffline = true */
  private get offline() {
    return typeof window !== 'undefined' && (window as unknown as { __demoOffline?: boolean }).__demoOffline === true;
  }
  private async latency() {
    await new Promise((r) => setTimeout(r, 150));
    if (this.offline) throw new TransportError('Failed to fetch', true);
  }
  async recordTaps(taps: TapPayload[]): Promise<TapResult[]> {
    await this.latency();
    return taps.map((t) => {
      if (this.stored.has(t.id)) return { id: t.id, status: 'duplicate' };
      this.stored.set(t.id, t);
      return { id: t.id, status: 'ok' };
    });
  }
  async confirmStation(_p: ConfirmPayload) {
    await this.latency();
  }
  async raiseDispute(_p: DisputePayload) {
    await this.latency();
  }
}

export function createDemoApi(): ScoringApi {
  return {
    mode: 'demo',
    transport: new DemoTransport(),
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
  };
}
