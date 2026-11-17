import type { ImportRow } from './registration.ts';

/** Organizer-side operations. Implemented for Supabase and for demo mode. */

export type TieBreak = 'countback' | 'shoot-off';
export type AdultNameFormat = 'full' | 'initial-last';
export type PresentationKind = 'single' | 'report_pair' | 'true_pair' | 'following_pair';

export interface EventSummary {
  id: string;
  name: string;
  eventDate: string | null;
  joinCode: string;
  status: 'setup' | 'live' | 'locked';
}

export interface EventSettings extends EventSummary {
  venue: string | null;
  tieBreak: TieBreak;
  lewisGroups: number | null;
  teamBestN: number | null;
  adultNameFormat: AdultNameFormat;
}

export interface AdminStation {
  id: string;
  number: number;
  name: string;
  targetCount: number;
  qrToken: string;
  /** How targets are presented; applied to the whole station. */
  presentation: PresentationKind;
}

export interface AdminDivision {
  id: string;
  name: string;
  sortOrder: number;
  awardsDepth: number;
}

export interface AdminMember {
  shooterId: string;
  firstName: string;
  lastName: string;
  isMinor: boolean;
  division: string | null;
  team: string | null;
  shootOrder: number;
}

export interface AdminSquad {
  id: string;
  number: number;
  isPractice: boolean;
  qrToken: string;
  startStationNumber: number | null;
  members: AdminMember[];
}

export interface EventSetup {
  event: EventSettings;
  courseId: string;
  stations: AdminStation[];
  divisions: AdminDivision[];
  teams: { id: string; name: string }[];
  squads: AdminSquad[];
  /** Registered shooters not yet in a squad. */
  unsquadded: Omit<AdminMember, 'shootOrder'>[];
  shooterCount: number;
}

export interface StationInput {
  id?: string;
  number: number;
  name: string;
  targetCount: number;
  presentation: PresentationKind;
}

export type ImportResult =
  | { ok: true; shooters: number; teamsCreated: number; squadsCreated: number }
  | { ok: false; errors: { row: number; message: string }[] };

export interface AdminApi {
  readonly mode: 'supabase' | 'demo';
  currentUser(): Promise<{ email: string } | null>;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;

  listEvents(): Promise<EventSummary[]>;
  createEvent(input: { name: string; joinCode: string; scorerPin: string; refereePin: string; displayName: string }): Promise<string>;
  loadSetup(eventId: string): Promise<EventSetup>;
  updateEvent(eventId: string, patch: Partial<Omit<EventSettings, 'id' | 'joinCode'>>): Promise<void>;
  setPins(eventId: string, scorerPin: string, refereePin: string): Promise<void>;

  saveStation(eventId: string, courseId: string, station: StationInput): Promise<void>;
  deleteStation(stationId: string): Promise<void>;

  addDivisions(eventId: string, divisions: { name: string; sortOrder: number }[]): Promise<void>;
  updateDivision(divisionId: string, patch: { awardsDepth?: number; sortOrder?: number }): Promise<void>;
  deleteDivision(divisionId: string): Promise<void>;

  importRegistrations(eventId: string, rows: ImportRow[]): Promise<ImportResult>;
  setSquadStart(squadId: string, stationId: string | null): Promise<void>;
  /** Squad 99 with two practice shooters, for the volunteer phone check. */
  ensurePracticeSquad(eventId: string): Promise<void>;
}

/** Problems the organizer can fix (wrong password, duplicate code...). */
export class AdminError extends Error {
  override name = 'AdminError';
}

/** Presentation rows for a station: pairs need an even target count, otherwise singles. */
export function presentationRows(targetCount: number, kind: PresentationKind) {
  const pairs = kind !== 'single' && targetCount % 2 === 0;
  const per = pairs ? 2 : 1;
  return Array.from({ length: targetCount / per }, (_, i) => ({ ord: i + 1, kind: pairs ? kind : ('single' as const), target_count: per }));
}
