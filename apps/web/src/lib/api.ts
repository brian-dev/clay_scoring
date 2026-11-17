import type { Transport } from './sync.ts';
import type { Presentation, RosterShooter, StationInfo } from '../scorer/stationScoring.ts';

/** What the scoring screens need from the backend. Implemented for Supabase and for demo mode. */

export type StaffRole = 'admin' | 'referee' | 'scorer';

export interface StaffSession {
  eventId: string;
  eventName: string;
  staffId: string;
  role: StaffRole;
  displayName: string;
}

export interface SquadInfo {
  id: string;
  number: number;
  isPractice: boolean;
  shooters: RosterShooter[];
}

export interface ScoringApi {
  readonly mode: 'supabase' | 'demo';
  join(joinCode: string, pin: string, displayName: string): Promise<StaffSession>;
  startStation(stationToken: string, deviceId: string, appVersion: string): Promise<StationInfo>;
  squadByToken(squadToken: string): Promise<SquadInfo>;
  transport: Transport;
}

/** Raised for problems the volunteer can fix (wrong PIN, unknown code). */
export class UserFacingError extends Error {
  override name = 'UserFacingError';
}

// Raw shapes returned by the database RPCs.
export interface RawStation {
  event_id: string;
  station: { id: string; number: number; name: string; target_count: number; presentations: Presentation[] };
}
export interface RawSquad {
  id: string;
  number: number;
  is_practice: boolean;
  shooters: { id: string; first_name: string; last_name: string; is_minor: boolean; shoot_order: number }[];
}

export const toStation = (raw: RawStation): StationInfo => ({
  id: raw.station.id,
  number: raw.station.number,
  name: raw.station.name,
  targetCount: raw.station.target_count,
  presentations: raw.station.presentations ?? [],
});

export const toSquad = (raw: RawSquad): SquadInfo => ({
  id: raw.id,
  number: raw.number,
  isPractice: raw.is_practice,
  shooters: [...raw.shooters]
    .sort((a, b) => a.shoot_order - b.shoot_order)
    .map((s) => ({ id: s.id, firstName: s.first_name, lastName: s.last_name, isMinor: s.is_minor })),
});
