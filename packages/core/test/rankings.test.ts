import { describe, expect, it } from 'vitest';
import { compareCountback, lewisClasses, rankEntries, type RankInput } from '../src/rankings.ts';

const e = (id: string, total: number, countback: number[] = [], finished = true): RankInput => ({
  id,
  total,
  finished,
  countback,
  sortKey: id,
});

const summary = (r: ReturnType<typeof rankEntries>) => r.map((x) => `${x.entry.id}:${x.rank}${x.tied ? 't' : ''}${x.shootOff ? 's' : ''}`);

describe('compareCountback', () => {
  it('the first different station decides, starting with the last station', () => {
    expect(compareCountback([8, 5], [7, 8])).toBeLessThan(0);
    expect(compareCountback([7, 8], [8, 5])).toBeGreaterThan(0);
    expect(compareCountback([6, 6], [6, 6])).toBe(0);
  });
});

describe('rankEntries', () => {
  it('uses standard competition ranking for unbreakable ties', () => {
    const r = rankEntries([e('a', 90), e('b', 85), e('c', 85), e('d', 80)], { tieBreak: 'shoot-off' });
    expect(summary(r)).toEqual(['a:1', 'b:2t', 'c:2t', 'd:4']);
  });

  it('countback separates finished shooters with equal totals', () => {
    const r = rankEntries([e('a', 85, [6, 7]), e('b', 85, [7, 5])], { tieBreak: 'countback' });
    expect(summary(r)).toEqual(['b:1', 'a:2']);
  });

  it('countback does not separate shooters still on the course', () => {
    const r = rankEntries([e('a', 40, [6], false), e('b', 40, [7], true)], { tieBreak: 'countback' });
    expect(r.every((x) => x.rank === 1 && x.tied)).toBe(true);
  });

  it('flags a shoot-off only for finished ties inside the award places', () => {
    const r = rankEntries([e('a', 90), e('b', 90), e('c', 70), e('d', 70)], { tieBreak: 'shoot-off', awardsDepth: 2 });
    expect(summary(r)).toEqual(['a:1ts', 'b:1ts', 'c:3t', 'd:3t']);
  });

  it('no shoot-off while a tied shooter is still shooting', () => {
    const r = rankEntries([e('a', 50, [], true), e('b', 50, [], false)], { tieBreak: 'shoot-off', awardsDepth: 3 });
    expect(r.every((x) => x.tied && !x.shootOff)).toBe(true);
  });

  it('identical countback stays tied even with countback enabled', () => {
    const r = rankEntries([e('a', 80, [7, 7]), e('b', 80, [7, 7])], { tieBreak: 'countback', awardsDepth: 1 });
    expect(summary(r)).toEqual(['a:1ts', 'b:1ts']);
  });
});

describe('lewisClasses', () => {
  const field = [95, 90, 88, 85, 80, 77, 70, 66, 60].map((t, i) => e(`p${i}`, t));

  it('splits finished shooters into equal groups, larger groups first', () => {
    const groups = lewisClasses(field, 2, { tieBreak: 'shoot-off' });
    expect(groups.map((g) => g.ranked.length)).toEqual([5, 4]);
    expect(groups[1]!.ranked[0]!.entry.total).toBe(77);
    expect(groups[1]!.ranked[0]!.rank).toBe(1);
  });

  it('moves shooters tied on the break line up into the higher class', () => {
    const tied = [90, 85, 80, 80, 70, 60].map((t, i) => e(`q${i}`, t));
    const groups = lewisClasses(tied, 2, { tieBreak: 'shoot-off' });
    expect(groups.map((g) => g.ranked.map((r) => r.entry.total))).toEqual([[90, 85, 80, 80], [70, 60]]);
  });

  it('ignores shooters who have not finished', () => {
    const groups = lewisClasses([e('a', 90), e('b', 99, [], false)], 1, { tieBreak: 'shoot-off' });
    expect(groups[0]!.ranked.map((r) => r.entry.id)).toEqual(['a']);
  });

  it('rejects zero groups', () => {
    expect(() => lewisClasses(field, 0, { tieBreak: 'shoot-off' })).toThrow();
  });
});
