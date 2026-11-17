import type { Result, ScoreRecord, Shooter, Station } from './types.ts';

/** Key for one target thrown at one shooter at one station. */
export const targetKey = (shooterId: string, stationId: string, targetNo: number): string =>
  `${shooterId}|${stationId}|${targetNo}`;

export interface TapValidation {
  ok: boolean;
  reason?: string;
}

/** A station accepts exactly its configured number of targets per shooter. */
export function validateTargetNo(station: Pick<Station, 'targetCount'>, targetNo: number): TapValidation {
  if (!Number.isInteger(targetNo)) return { ok: false, reason: 'Target number must be a whole number.' };
  if (targetNo < 1 || targetNo > station.targetCount) {
    return { ok: false, reason: `Target must be between 1 and ${station.targetCount}.` };
  }
  return { ok: true };
}

export interface EffectiveScores {
  /** targetKey -> result, for every target that has a counting score. */
  results: Map<string, Result>;
  /** targetKeys where two or more live records disagree or duplicate (needs a referee). */
  conflicts: string[];
}

const COUNTING_KINDS = new Set(['official', 'paper']);

/**
 * Reduce the append-only score log to one result per target.
 *
 * - Only official and paper records count (shadow and practice never do).
 * - A record named in another record's supersedesId is retired.
 * - If more than one live record remains for a target (e.g. two phones scored the
 *   same station), the latest by server time wins and the key is reported as a conflict.
 */
export function effectiveScores(records: readonly ScoreRecord[]): EffectiveScores {
  // De-duplicate by id: a tap re-sent after a dropped connection is the same record.
  const byId = new Map<string, ScoreRecord>();
  for (const r of records) if (COUNTING_KINDS.has(r.kind) && !byId.has(r.id)) byId.set(r.id, r);
  const counting = [...byId.values()];
  const superseded = new Set<string>();
  for (const r of counting) if (r.supersedesId) superseded.add(r.supersedesId);

  const live = new Map<string, ScoreRecord[]>();
  for (const r of counting) {
    if (superseded.has(r.id)) continue;
    const key = targetKey(r.shooterId, r.stationId, r.targetNo);
    const list = live.get(key);
    if (list) list.push(r);
    else live.set(key, [r]);
  }

  const results = new Map<string, Result>();
  const conflicts: string[] = [];
  for (const [key, list] of live) {
    list.sort((a, b) => (a.serverTs < b.serverTs ? -1 : a.serverTs > b.serverTs ? 1 : a.id.localeCompare(b.id)));
    const latest = list[list.length - 1]!;
    results.set(key, latest.result);
    if (list.length > 1) conflicts.push(key);
  }
  conflicts.sort();
  return { results, conflicts };
}

export interface StationScore {
  stationId: string;
  hits: number;
  scored: number;
  targetCount: number;
  complete: boolean;
  /** Per-target result in order 1..targetCount; null where not yet scored. */
  targets: (Result | null)[];
}

export interface ShooterTotal {
  shooterId: string;
  total: number;
  stationsComplete: number;
  stationCount: number;
  finished: boolean;
  /** stationId -> score */
  stations: Map<string, StationScore>;
}

/** Totals for every shooter across every station. */
export function shooterTotals(
  shooters: readonly Shooter[],
  stations: readonly Station[],
  results: Map<string, Result>,
): Map<string, ShooterTotal> {
  const out = new Map<string, ShooterTotal>();
  for (const shooter of shooters) {
    let total = 0;
    let stationsComplete = 0;
    const perStation = new Map<string, StationScore>();
    for (const station of stations) {
      const targets: (Result | null)[] = [];
      let hits = 0;
      let scored = 0;
      for (let t = 1; t <= station.targetCount; t++) {
        const r = results.get(targetKey(shooter.id, station.id, t)) ?? null;
        targets.push(r);
        if (r !== null) scored++;
        if (r === 'hit') hits++;
      }
      const complete = scored === station.targetCount;
      if (complete) stationsComplete++;
      total += hits;
      perStation.set(station.id, { stationId: station.id, hits, scored, targetCount: station.targetCount, complete, targets });
    }
    out.set(shooter.id, {
      shooterId: shooter.id,
      total,
      stationsComplete,
      stationCount: stations.length,
      finished: stations.length > 0 && stationsComplete === stations.length,
      stations: perStation,
    });
  }
  return out;
}

/** Total targets on the course (e.g. 100). */
export const courseTargetCount = (stations: readonly Station[]): number =>
  stations.reduce((sum, s) => sum + s.targetCount, 0);
