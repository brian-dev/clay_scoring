import type { StaffSession } from './api.ts';
import type { ScoringState, StationInfo } from '../scorer/stationScoring.ts';

/**
 * Small per-phone state kept in localStorage. Every access is wrapped because
 * storage can throw (private mode, full disk) and the app must keep working.
 */

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: state lives in memory for this visit */
  }
}

export function deviceId(): string {
  let id = read<string>('cs.deviceId');
  if (!id) {
    id = crypto.randomUUID();
    write('cs.deviceId', id);
  }
  return id;
}

export const loadSession = () => read<StaffSession>('cs.session');
export const saveSession = (s: StaffSession | null) => write('cs.session', s);

export const loadStation = () => read<StationInfo>('cs.station');
export const saveStation = (s: StationInfo | null) => write('cs.station', s);

const scoringKey = (stationId: string, squadId: string) => `cs.scoring.${stationId}.${squadId}`;
export const loadScoring = (stationId: string, squadId: string) => read<ScoringState>(scoringKey(stationId, squadId));
export const saveScoring = (s: ScoringState) => write(scoringKey(s.stationId, s.squadId), s);
export const clearScoring = (stationId: string, squadId: string) => write(scoringKey(stationId, squadId), null);

/** Squads already confirmed at this station on this phone (to warn about re-scoring). */
export const loadDoneSquads = (stationId: string) => read<string[]>(`cs.done.${stationId}`) ?? [];
export const markSquadDone = (stationId: string, squadId: string) =>
  write(`cs.done.${stationId}`, [...new Set([...loadDoneSquads(stationId), squadId])]);
