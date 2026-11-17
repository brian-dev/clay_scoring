import type { Result, TapKind, TapPayload } from '../lib/outbox.ts';

/**
 * Pure state for scoring one squad at one station.
 * Each shooter shoots the whole station in turn, so the order is
 * shooter 1 targets 1..n, then shooter 2 targets 1..n, and so on.
 */

export interface RosterShooter {
  id: string;
  firstName: string;
  lastName: string;
  isMinor: boolean;
}

export interface Presentation {
  ord: number;
  kind: 'single' | 'report_pair' | 'true_pair' | 'following_pair';
  target_count: number;
}

export interface StationInfo {
  id: string;
  number: number;
  name: string;
  targetCount: number;
  presentations: Presentation[];
}

export interface Cell {
  shooterIndex: number;
  shooterId: string;
  targetNo: number;
}

export interface Mark {
  tapId: string;
  result: Result;
}

export interface ScoringState {
  stationId: string;
  squadId: string;
  kind: TapKind;
  /** `${shooterId}:${targetNo}` -> latest mark */
  marks: Record<string, Mark>;
  /** Index into cells() of the target being scored now. */
  cursor: number;
}

const key = (shooterId: string, targetNo: number) => `${shooterId}:${targetNo}`;

export function cells(roster: readonly RosterShooter[], targetCount: number): Cell[] {
  const out: Cell[] = [];
  roster.forEach((s, shooterIndex) => {
    for (let t = 1; t <= targetCount; t++) out.push({ shooterIndex, shooterId: s.id, targetNo: t });
  });
  return out;
}

export function initialState(stationId: string, squadId: string, kind: TapKind = 'official'): ScoringState {
  return { stationId, squadId, kind, marks: {}, cursor: 0 };
}

export const markFor = (state: ScoringState, shooterId: string, targetNo: number): Mark | undefined =>
  state.marks[key(shooterId, targetNo)];

/** First unscored cell at or after `from`, wrapping around; -1 when everything is scored. */
export function nextUnscored(state: ScoringState, all: readonly Cell[], from = 0): number {
  for (let k = 0; k < all.length; k++) {
    const i = (from + k) % all.length;
    const c = all[i]!;
    if (!state.marks[key(c.shooterId, c.targetNo)]) return i;
  }
  return -1;
}

export const isComplete = (state: ScoringState, all: readonly Cell[]): boolean => nextUnscored(state, all) === -1;

export interface TapOutcome {
  state: ScoringState;
  payload: TapPayload;
}

/**
 * Record HIT or MISS at the cursor. Re-scoring a target supersedes its earlier tap,
 * so the server keeps the history and counts only the latest.
 */
export function tap(
  state: ScoringState,
  all: readonly Cell[],
  result: Result,
  ctx: { deviceId: string; newId: () => string; now?: () => Date },
): TapOutcome {
  const cell = all[state.cursor];
  if (!cell) throw new Error('Nothing left to score at this station.');
  const k = key(cell.shooterId, cell.targetNo);
  const previous = state.marks[k];
  const id = ctx.newId();
  const payload: TapPayload = {
    id,
    shooter_id: cell.shooterId,
    station_id: state.stationId,
    squad_id: state.squadId,
    target_no: cell.targetNo,
    result,
    kind: state.kind,
    device_id: ctx.deviceId,
    device_ts: (ctx.now?.() ?? new Date()).toISOString(),
    ...(previous ? { supersedes_id: previous.tapId } : {}),
  };
  const marks = { ...state.marks, [k]: { tapId: id, result } };
  const next = { ...state, marks };
  const after = nextUnscored(next, all, state.cursor + 1);
  return { state: { ...next, cursor: after === -1 ? state.cursor : after }, payload };
}

/** Step back to the previous target so the next tap re-scores it. */
export function undo(state: ScoringState): ScoringState {
  return { ...state, cursor: Math.max(0, state.cursor - 1) };
}

/** Jump to any target (e.g. the scorer taps a dot to fix it). */
export function select(state: ScoringState, all: readonly Cell[], index: number): ScoringState {
  if (index < 0 || index >= all.length) return state;
  return { ...state, cursor: index };
}

export interface ShooterTally {
  shooterId: string;
  hits: number;
  scored: number;
}

export function tallies(state: ScoringState, roster: readonly RosterShooter[], targetCount: number): ShooterTally[] {
  return roster.map((s) => {
    let hits = 0;
    let scored = 0;
    for (let t = 1; t <= targetCount; t++) {
      const m = state.marks[key(s.id, t)];
      if (m) {
        scored++;
        if (m.result === 'hit') hits++;
      }
    }
    return { shooterId: s.id, hits, scored };
  });
}

/** "Report pair 2 · Target 1 of 2" for a target number, using the station's presentations. */
export function targetLabel(station: Pick<StationInfo, 'presentations' | 'targetCount'>, targetNo: number): string {
  const names: Record<Presentation['kind'], string> = {
    single: 'Single',
    report_pair: 'Report pair',
    true_pair: 'True pair',
    following_pair: 'Following pair',
  };
  let start = 1;
  for (const p of [...station.presentations].sort((a, b) => a.ord - b.ord)) {
    const end = start + p.target_count - 1;
    if (targetNo >= start && targetNo <= end) {
      const within = targetNo - start + 1;
      return p.target_count > 1
        ? `${names[p.kind]} ${p.ord} · Target ${within} of ${p.target_count}`
        : `${names[p.kind]} ${p.ord}`;
    }
    start = end + 1;
  }
  return `Target ${targetNo} of ${station.targetCount}`;
}
