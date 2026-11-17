import { describe, expect, it } from 'vitest';
import { courseTargetCount, effectiveScores, shooterTotals, targetKey, validateTargetNo } from '../src/scoring.ts';
import { rec, scoreStation, shooter, station } from './fixtures.ts';

describe('validateTargetNo', () => {
  const st = station('s1', 1, 8);
  it('accepts targets inside the station count', () => {
    expect(validateTargetNo(st, 1).ok).toBe(true);
    expect(validateTargetNo(st, 8).ok).toBe(true);
  });
  it('rejects targets outside the station count or non-integers', () => {
    expect(validateTargetNo(st, 0).ok).toBe(false);
    expect(validateTargetNo(st, 9).ok).toBe(false);
    expect(validateTargetNo(st, 2.5).ok).toBe(false);
  });
});

describe('effectiveScores', () => {
  it('counts official and paper scores but never shadow or practice', () => {
    const { results } = effectiveScores([
      rec('a', 's1', 1, 'hit'),
      rec('a', 's1', 2, 'miss', { kind: 'paper' }),
      rec('a', 's1', 3, 'hit', { kind: 'shadow' }),
      rec('a', 's1', 4, 'hit', { kind: 'practice' }),
    ]);
    expect(results.get(targetKey('a', 's1', 1))).toBe('hit');
    expect(results.get(targetKey('a', 's1', 2))).toBe('miss');
    expect(results.has(targetKey('a', 's1', 3))).toBe(false);
    expect(results.has(targetKey('a', 's1', 4))).toBe(false);
  });

  it('retires a record once another record supersedes it (undo / correction)', () => {
    const first = rec('a', 's1', 1, 'miss', { id: 'x1' });
    const fix = rec('a', 's1', 1, 'hit', { id: 'x2', supersedes: 'x1' });
    const { results, conflicts } = effectiveScores([fix, first]);
    expect(results.get(targetKey('a', 's1', 1))).toBe('hit');
    expect(conflicts).toEqual([]);
  });

  it('a supersede chain resolves to the last link', () => {
    const { results } = effectiveScores([
      rec('a', 's1', 1, 'miss', { id: 'c1' }),
      rec('a', 's1', 1, 'hit', { id: 'c2', supersedes: 'c1' }),
      rec('a', 's1', 1, 'miss', { id: 'c3', supersedes: 'c2' }),
    ]);
    expect(results.get(targetKey('a', 's1', 1))).toBe('miss');
  });

  it('flags a conflict when two live records exist for one target, keeping the latest', () => {
    const { results, conflicts } = effectiveScores([
      rec('a', 's1', 1, 'hit', { t: 1 }),
      rec('a', 's1', 1, 'miss', { t: 5 }),
    ]);
    expect(results.get(targetKey('a', 's1', 1))).toBe('miss');
    expect(conflicts).toEqual([targetKey('a', 's1', 1)]);
  });

  it('the same record sent twice (same id) is not a conflict', () => {
    const r = rec('a', 's1', 1, 'hit', { id: 'dup' });
    const { conflicts } = effectiveScores([r, { ...r }]);
    expect(conflicts).toEqual([]);
  });
});

describe('shooterTotals', () => {
  const s1 = station('s1', 1, 4);
  const s2 = station('s2', 2, 4);
  const a = shooter('a', 'Ann', 'Lee');

  it('totals hits and tracks completed stations', () => {
    const { results } = effectiveScores([...scoreStation('a', s1, 'HHMH'), rec('a', 's2', 1, 'hit')]);
    const t = shooterTotals([a], [s1, s2], results).get('a')!;
    expect(t.total).toBe(4);
    expect(t.stationsComplete).toBe(1);
    expect(t.finished).toBe(false);
    expect(t.stations.get('s2')!.targets).toEqual(['hit', null, null, null]);
  });

  it('marks a shooter finished when every station is complete', () => {
    const { results } = effectiveScores([...scoreStation('a', s1, 'HHHH'), ...scoreStation('a', s2, 'MMMM')]);
    const t = shooterTotals([a], [s1, s2], results).get('a')!;
    expect(t.finished).toBe(true);
    expect(t.total).toBe(4);
  });

  it('counts course targets', () => {
    expect(courseTargetCount([s1, s2, station('s3', 3, 8)])).toBe(16);
  });
});
