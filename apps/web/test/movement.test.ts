import type { BoardRow, StandingsFile } from '@slayin/core';
import { describe, expect, it } from 'vitest';
import { diffStandings } from '../src/board/movement.ts';

const row = (id: string, rank: number, total: number, finished = false): BoardRow => ({
  shooterId: id, rank, tied: false, shootOff: false, name: id.toUpperCase(), division: null,
  total, progress: finished ? 'Final' : 'thru 3', finished, underReview: false,
});

const file = (overall: BoardRow[], divisions: StandingsFile['divisions'] = []): StandingsFile => ({
  version: 1, eventId: 'e', eventName: 'E', generatedAt: '', courseTargets: 100, stationCount: 10,
  squadsOnCourse: 1, squadsFinished: 0, final: false, overall, divisions, teams: [], lewis: null, conflictCount: 0,
});

describe('diffStandings', () => {
  it('reports nothing on the first snapshot', () => {
    const m = diffStandings(null, file([row('a', 1, 10)]));
    expect(m.changes.size).toBe(0);
    expect(m.newLeader).toBeNull();
    expect(m.movers).toEqual([]);
  });

  it('tracks rank and score changes per shooter', () => {
    const prev = file([row('a', 1, 30), row('b', 2, 28), row('c', 3, 25)]);
    const next = file([row('c', 1, 35), row('a', 2, 30), row('b', 3, 29)]);
    const m = diffStandings(prev, next);
    expect(m.changes.get('c')).toEqual({ shooterId: 'c', rankDelta: 2, scoreDelta: 10, justFinished: false });
    expect(m.changes.get('a')).toEqual({ shooterId: 'a', rankDelta: -1, scoreDelta: 0, justFinished: false });
    expect(m.newLeader?.shooterId).toBe('c');
    expect(m.movers.map((x) => x.text)).toEqual(['New leader: C with 35', 'C climbs 2 to 1st']);
  });

  it('announces finishers inside the top 10 only', () => {
    const prev = file([row('a', 1, 90), row('z', 11, 50)]);
    const next = file([row('a', 1, 94, true), row('z', 11, 60, true)]);
    expect(diffStandings(prev, next).movers.map((x) => x.text)).toEqual(['A finishes with 94']);
  });

  it('announces division lead changes', () => {
    const d = (lead: BoardRow) => [{ id: 'jm', name: 'Junior Male', awardsDepth: 3, count: 2, rows: [lead] }];
    const prev = file([row('a', 1, 10), row('b', 2, 9)], d(row('a', 1, 10)));
    const next = file([row('a', 1, 12), row('b', 2, 11)], d(row('b', 1, 13)));
    expect(diffStandings(prev, next).movers.map((x) => x.text)).toContain('B takes the Junior Male lead');
  });
});
