import type { Result, ScoreKind, ScoreRecord, Shooter, Station } from '../src/types.ts';

let seq = 0;
const ts = (n: number) => new Date(Date.UTC(2027, 3, 10, 9, 0, n)).toISOString();

export function rec(
  shooterId: string,
  stationId: string,
  targetNo: number,
  result: Result,
  opts: { id?: string; kind?: ScoreKind; t?: number; supersedes?: string } = {},
): ScoreRecord {
  seq++;
  return {
    id: opts.id ?? `r${seq}`,
    shooterId,
    stationId,
    targetNo,
    result,
    kind: opts.kind ?? 'official',
    serverTs: ts(opts.t ?? seq),
    supersedesId: opts.supersedes ?? null,
  };
}

export const station = (id: string, number: number, targetCount = 4): Station => ({
  id,
  number,
  name: `Station ${number}`,
  targetCount,
});

export const shooter = (id: string, first: string, last: string, extra: Partial<Shooter> = {}): Shooter => ({
  id,
  firstName: first,
  lastName: last,
  isMinor: false,
  divisionId: null,
  teamId: null,
  squadId: null,
  ...extra,
});

/** Score a whole station for a shooter from a pattern like "HHMH". */
export function scoreStation(shooterId: string, st: Station, pattern: string): ScoreRecord[] {
  if (pattern.length !== st.targetCount) throw new Error(`pattern ${pattern} != ${st.targetCount} targets`);
  return [...pattern].map((c, i) => rec(shooterId, st.id, i + 1, c === 'H' ? 'hit' : 'miss'));
}
