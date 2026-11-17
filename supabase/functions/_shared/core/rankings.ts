// GENERATED from packages/core/src by scripts/sync-core.mjs. Do not edit here.
import type { TieBreakMethod } from './types.ts';

export interface RankInput {
  id: string;
  total: number;
  finished: boolean;
  /**
   * Hits per station ordered for countback: highest station number first.
   * Countback compares these left to right; the first difference decides.
   */
  countback: number[];
  /** Secondary display order for entries that stay tied (usually the display name). */
  sortKey: string;
}

export interface Ranked<T extends RankInput = RankInput> {
  entry: T;
  /** Standard competition ranking: 1, 2, 2, 4. */
  rank: number;
  /** Shares its rank with at least one other entry. */
  tied: boolean;
  /** Finished, tied, and inside the award places: a shoot-off is needed. */
  shootOff: boolean;
}

/** Compare two countback arrays. Negative when a ranks ahead of b. */
export function compareCountback(a: readonly number[], b: readonly number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (b[i] ?? 0) - (a[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Countback only separates shooters who have both finished; while anyone is still on
 * the course, equal totals stay tied on the live board.
 */
function separates(a: RankInput, b: RankInput, method: TieBreakMethod): number {
  if (a.total !== b.total) return b.total - a.total;
  if (method === 'countback' && a.finished && b.finished) return compareCountback(a.countback, b.countback);
  return 0;
}

export interface RankOptions {
  tieBreak: TieBreakMethod;
  /** Award places (e.g. 3). Ties inside these places among finished shooters need a shoot-off. */
  awardsDepth?: number;
}

export function rankEntries<T extends RankInput>(entries: readonly T[], opts: RankOptions): Ranked<T>[] {
  const sorted = [...entries].sort((a, b) => separates(a, b, opts.tieBreak) || a.sortKey.localeCompare(b.sortKey));

  const ranked: Ranked<T>[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i]!;
    const prev = ranked[i - 1];
    const sameAsPrev = prev !== undefined && separates(prev.entry, entry, opts.tieBreak) === 0;
    ranked.push({ entry, rank: sameAsPrev ? prev.rank : i + 1, tied: false, shootOff: false });
  }

  // Mark ties (both sides of every equal pair) and shoot-offs.
  const depth = opts.awardsDepth ?? 0;
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i]!;
    const tiedWithNeighbor =
      (ranked[i - 1]?.rank === r.rank) || (ranked[i + 1]?.rank === r.rank);
    if (!tiedWithNeighbor) continue;
    r.tied = true;
    const group = ranked.filter((x) => x.rank === r.rank);
    r.shootOff = r.rank <= depth && group.every((x) => x.entry.finished);
  }
  return ranked;
}

export interface LewisGroup<T extends RankInput> {
  /** 1 = highest-scoring group. */
  group: number;
  ranked: Ranked<T>[];
}

/**
 * Lewis Class: after the shoot, all finished shooters are ordered by score and split
 * into `groups` classes of (nearly) equal size; larger classes come first. A shooter
 * tied with the last member of a class moves up into that class. Each class is then
 * ranked on its own, so a mid-pack shooter can win their class.
 */
export function lewisClasses<T extends RankInput>(
  entries: readonly T[],
  groups: number,
  opts: RankOptions,
): LewisGroup<T>[] {
  if (!Number.isInteger(groups) || groups < 1) throw new Error('Lewis Class needs at least 1 group.');
  const finished = [...entries]
    .filter((e) => e.finished)
    .sort((a, b) => b.total - a.total || a.sortKey.localeCompare(b.sortKey));
  const n = finished.length;
  const base = Math.floor(n / groups);
  const extra = n % groups;

  const out: LewisGroup<T>[] = [];
  let start = 0;
  for (let g = 0; g < groups && start < n; g++) {
    let end = start + base + (g < extra ? 1 : 0);
    if (end <= start) end = start + 1;
    // Ties on the break line move up into this class.
    while (end < n && finished[end]!.total === finished[end - 1]!.total) end++;
    out.push({ group: g + 1, ranked: rankEntries(finished.slice(start, end), { ...opts, awardsDepth: opts.awardsDepth ?? 1 }) });
    start = end;
  }
  return out;
}
