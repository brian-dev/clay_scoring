import { describe, expect, it } from 'vitest';
import {
  cells,
  initialState,
  isComplete,
  markFor,
  select,
  tallies,
  tap,
  targetLabel,
  undo,
  type RosterShooter,
} from '../src/scorer/stationScoring.ts';

const roster: RosterShooter[] = [
  { id: 'a', firstName: 'Ray', lastName: 'Delgado', isMinor: false },
  { id: 'b', firstName: 'Kaden', lastName: 'Whitfield', isMinor: true },
];
const all = cells(roster, 2);
let n = 0;
const ctx = { deviceId: 'dev', newId: () => `id${++n}`, now: () => new Date('2027-04-10T15:00:00Z') };

describe('station scoring', () => {
  it('scores each shooter through the whole station in order', () => {
    expect(all.map((c) => `${c.shooterId}${c.targetNo}`)).toEqual(['a1', 'a2', 'b1', 'b2']);
    let s = initialState('st', 'sq');
    const results = ['hit', 'miss', 'hit', 'hit'] as const;
    const payloads = results.map((r) => {
      const out = tap(s, all, r, ctx);
      s = out.state;
      return out.payload;
    });
    expect(payloads.map((p) => [p.shooter_id, p.target_no, p.result])).toEqual([
      ['a', 1, 'hit'], ['a', 2, 'miss'], ['b', 1, 'hit'], ['b', 2, 'hit'],
    ]);
    expect(payloads.every((p) => p.supersedes_id === undefined)).toBe(true);
    expect(isComplete(s, all)).toBe(true);
    expect(tallies(s, roster, 2)).toEqual([
      { shooterId: 'a', hits: 1, scored: 2 },
      { shooterId: 'b', hits: 2, scored: 2 },
    ]);
  });

  it('undo steps back and the re-tap supersedes the earlier tap', () => {
    let s = initialState('st', 'sq');
    const first = tap(s, all, 'miss', ctx);
    s = undo(first.state);
    expect(s.cursor).toBe(0);
    const fix = tap(s, all, 'hit', ctx);
    expect(fix.payload.supersedes_id).toBe(first.payload.id);
    expect(markFor(fix.state, 'a', 1)?.result).toBe('hit');
    expect(fix.state.cursor).toBe(1);
  });

  it('after fixing an earlier target, the cursor returns to the first unscored one', () => {
    let s = initialState('st', 'sq');
    for (const r of ['hit', 'hit', 'hit'] as const) s = tap(s, all, r, ctx).state; // a1 a2 b1
    s = select(s, all, 0); // go back to a1
    s = tap(s, all, 'miss', ctx).state;
    expect(all[s.cursor]).toMatchObject({ shooterId: 'b', targetNo: 2 });
  });

  it('practice squads tag their taps as practice', () => {
    const s = initialState('st', 'sq', 'practice');
    expect(tap(s, all, 'hit', ctx).payload.kind).toBe('practice');
  });

  it('labels targets from the station presentations', () => {
    const station = {
      targetCount: 8,
      presentations: [1, 2, 3, 4].map((ord) => ({ ord, kind: 'report_pair' as const, target_count: 2 })),
    };
    expect(targetLabel(station, 1)).toBe('Report pair 1 · Target 1 of 2');
    expect(targetLabel(station, 8)).toBe('Report pair 4 · Target 2 of 2');
    expect(targetLabel({ targetCount: 5, presentations: [] }, 3)).toBe('Target 3 of 5');
  });
});
