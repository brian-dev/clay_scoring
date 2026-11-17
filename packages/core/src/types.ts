/**
 * Shared domain types. These mirror the database tables (see supabase/migrations)
 * but use camelCase and only the fields the scoring logic needs.
 */

export type Result = 'hit' | 'miss';

/**
 * official — entered by a station scorer (or referee correction)
 * paper    — entered by an admin from a paper backup card
 * shadow   — unofficial squad-entered score, used only for comparison
 * practice — phone-check / training scores, never counted
 */
export type ScoreKind = 'official' | 'paper' | 'shadow' | 'practice';

export type TieBreakMethod = 'countback' | 'shoot-off';

export type AdultNameFormat = 'full' | 'initial-last';

export interface Station {
  id: string;
  /** Course order. Countback compares stations from the highest number down. */
  number: number;
  name: string;
  targetCount: number;
}

export interface Division {
  id: string;
  name: string;
  sortOrder: number;
  /** How many places receive awards (e.g. 3). */
  awardsDepth: number;
}

export interface Team {
  id: string;
  name: string;
}

export interface Shooter {
  id: string;
  firstName: string;
  lastName: string;
  /** Under 18. Minors are always shown as "First L." on public views. */
  isMinor: boolean;
  divisionId: string | null;
  teamId: string | null;
  squadId: string | null;
}

export interface Squad {
  id: string;
  number: number;
  /** Shooter ids in shooting order. */
  shooterIds: string[];
}

export interface ScoreRecord {
  /** Client-generated UUID; makes re-sent taps idempotent. */
  id: string;
  shooterId: string;
  stationId: string;
  targetNo: number;
  result: Result;
  kind: ScoreKind;
  /** ISO timestamp assigned by the server. */
  serverTs: string;
  /** Id of the record this one replaces (undo, re-tap or referee correction). */
  supersedesId: string | null;
}

export type ConfirmationStatus = 'confirmed' | 'disputed' | 'resolved';

export interface StationConfirmation {
  squadId: string;
  stationId: string;
  status: ConfirmationStatus;
}

export interface Dispute {
  id: string;
  shooterId: string;
  stationId: string;
  open: boolean;
}

export interface EventConfig {
  id: string;
  name: string;
  tieBreak: TieBreakMethod;
  /** Number of Lewis Class groups, or null when Lewis Class is not used. */
  lewisGroups: number | null;
  /** Team total counts only the best N member scores; null = all members. */
  teamBestN: number | null;
  adultNameFormat: AdultNameFormat;
}
