import { describe, expect, it } from 'vitest';
import { buildStandings, type StandingsInput } from '../src/standings.ts';
import type { EventConfig } from '../src/types.ts';
import { rec, scoreStation, shooter, station } from './fixtures.ts';

const s1 = station('s1', 1, 4);
const s2 = station('s2', 2, 4);

const event: EventConfig = {
  id: 'ev1',
  name: "Slayin' Clays 2027",
  tieBreak: 'countback',
  lewisGroups: 2,
  teamBestN: null,
  adultNameFormat: 'full',
};

function baseInput(): StandingsInput {
  const shooters = [
    shooter('ray', 'Ray', 'Delgado', { divisionId: 'am', teamId: 't1', squadId: 'q1' }),
    shooter('kad', 'Kaden', 'Whitfield', { isMinor: true, divisionId: 'im', teamId: 't1', squadId: 'q1' }),
    shooter('lis', 'Lisa', 'Strand', { divisionId: 'af', teamId: 't2', squadId: 'q2' }),
  ];
  return {
    event,
    stations: [s2, s1],
    divisions: [
      { id: 'im', name: 'Intermediate Male', sortOrder: 2, awardsDepth: 3 },
      { id: 'am', name: 'Adult Male', sortOrder: 1, awardsDepth: 3 },
      { id: 'af', name: 'Adult Female', sortOrder: 3, awardsDepth: 3 },
    ],
    teams: [
      { id: 't1', name: 'Sponsor Team A' },
      { id: 't2', name: 'Pirates Alumni' },
    ],
    shooters,
    squads: [
      { id: 'q1', number: 12, shooterIds: ['ray', 'kad'] },
      { id: 'q2', number: 7, shooterIds: ['lis'] },
    ],
    scores: [
      ...scoreStation('ray', s1, 'HHHM'),
      ...scoreStation('ray', s2, 'HHHH'), // 7, last station 4
      ...scoreStation('kad', s1, 'HHHH'),
      ...scoreStation('kad', s2, 'HHHM'), // 7, last station 3 -> loses countback
      ...scoreStation('lis', s1, 'HMHM'), // 2, thru 1
    ],
    confirmations: [
      { squadId: 'q1', stationId: 's1', status: 'confirmed' },
      { squadId: 'q1', stationId: 's2', status: 'confirmed' },
      { squadId: 'q2', stationId: 's1', status: 'confirmed' },
    ],
    disputes: [],
    now: new Date('2027-04-10T15:00:00Z'),
  };
}

describe('buildStandings', () => {
  it('ranks overall with countback and labels progress', () => {
    const { standings } = buildStandings(baseInput());
    expect(standings.overall.map((r) => [r.name, r.rank, r.total, r.progress])).toEqual([
      ['Ray Delgado', 1, 7, 'Final'],
      ['Kaden W.', 2, 7, 'Final'],
      ['Lisa Strand', 3, 2, 'thru 1'],
    ]);
    expect(standings.courseTargets).toBe(8);
    expect(standings.generatedAt).toBe('2027-04-10T15:00:00.000Z');
  });

  it('never exposes a minor full last name anywhere in the public files', () => {
    const { standings, squads } = buildStandings(baseInput());
    const all = JSON.stringify(standings) + JSON.stringify([...squads.values()]);
    expect(all).not.toContain('Whitfield');
    expect(all).toContain('Kaden W.');
  });

  it('orders divisions by sortOrder and ranks inside each', () => {
    const { standings } = buildStandings(baseInput());
    expect(standings.divisions.map((d) => [d.name, d.count])).toEqual([
      ['Adult Male', 1],
      ['Intermediate Male', 1],
      ['Adult Female', 1],
    ]);
  });

  it('totals teams and flags squad progress', () => {
    const { standings } = buildStandings(baseInput());
    expect(standings.teams.map((t) => [t.name, t.total, t.rank])).toEqual([
      ['Sponsor Team A', 14, 1],
      ['Pirates Alumni', 2, 2],
    ]);
    expect(standings.squadsFinished).toBe(1);
    expect(standings.squadsOnCourse).toBe(1);
    expect(standings.final).toBe(false);
  });

  it('team best-N counts only the top scores', () => {
    const input = baseInput();
    input.event = { ...event, teamBestN: 1 };
    const { standings } = buildStandings(input);
    expect(standings.teams[0]!.total).toBe(7);
  });

  it('marks shooters with an open dispute as under review and blocks final', () => {
    const input = baseInput();
    input.scores.push(...scoreStation('lis', s2, 'HHHH'));
    input.disputes = [{ id: 'd1', shooterId: 'lis', stationId: 's2', open: true }];
    const { standings } = buildStandings(input);
    expect(standings.overall.find((r) => r.name === 'Lisa Strand')!.underReview).toBe(true);
    expect(standings.final).toBe(false);
    input.disputes = [{ id: 'd1', shooterId: 'lis', stationId: 's2', open: false }];
    expect(buildStandings(input).standings.final).toBe(true);
  });

  it('builds squad scorecards with H/M/null per target and ranks', () => {
    const { squads } = buildStandings(baseInput());
    const q2 = squads.get('q2')!;
    expect(q2.squadNumber).toBe(7);
    const lisa = q2.shooters[0]!;
    expect(lisa.stations[0]!.targets).toEqual(['H', 'M', 'H', 'M']);
    expect(lisa.stations[1]!.targets).toEqual([null, null, null, null]);
    expect(lisa.overallRank).toBe(3);
    expect(lisa.divisionRank).toBe(1);
  });

  it('builds Lewis Class groups from finished shooters', () => {
    const { standings } = buildStandings(baseInput());
    expect(standings.lewis?.map((g) => g.rows.map((r) => r.name))).toEqual([['Ray Delgado', 'Kaden W.']]);
  });

  it('reports scoring conflicts as a count only', () => {
    const input = baseInput();
    input.scores.push(rec('lis', 's1', 1, 'miss'));
    const { standings } = buildStandings(input);
    expect(standings.conflictCount).toBe(1);
  });
});
