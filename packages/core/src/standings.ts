import { displayName } from './names.ts';
import { lewisClasses, rankEntries, type RankInput, type Ranked } from './rankings.ts';
import { courseTargetCount, effectiveScores, shooterTotals, type ShooterTotal } from './scoring.ts';
import type {
  Dispute,
  Division,
  EventConfig,
  ScoreRecord,
  Shooter,
  Squad,
  Station,
  StationConfirmation,
  Team,
} from './types.ts';

/**
 * Builds the cached JSON files that every public screen polls:
 *   standings.json         overall, divisions, teams, Lewis Class
 *   squads/<squadId>.json  one squad's station-by-station scorecard
 *
 * Public files never contain contact details, and minors are always "First L.".
 */

export interface StandingsInput {
  event: EventConfig;
  stations: Station[];
  divisions: Division[];
  teams: Team[];
  shooters: Shooter[];
  squads: Squad[];
  scores: ScoreRecord[];
  confirmations: StationConfirmation[];
  disputes: Dispute[];
  /** Injected for deterministic tests. */
  now?: Date;
}

export interface BoardRow {
  shooterId: string;
  rank: number;
  tied: boolean;
  shootOff: boolean;
  name: string;
  division: string | null;
  total: number;
  /** "Final" or "thru 9" */
  progress: string;
  finished: boolean;
  underReview: boolean;
}

export interface DivisionBoard {
  id: string;
  name: string;
  awardsDepth: number;
  count: number;
  rows: BoardRow[];
}

export interface TeamRow {
  teamId: string;
  rank: number;
  tied: boolean;
  name: string;
  total: number;
  members: number;
  finished: boolean;
}

export interface LewisBoard {
  group: number;
  rows: BoardRow[];
}

export interface StandingsFile {
  version: 1;
  eventId: string;
  eventName: string;
  generatedAt: string;
  courseTargets: number;
  stationCount: number;
  squadsOnCourse: number;
  squadsFinished: number;
  /** True once every shooter has finished and no dispute is open. */
  final: boolean;
  overall: BoardRow[];
  divisions: DivisionBoard[];
  teams: TeamRow[];
  /** Present when the event uses Lewis Class. Provisional until `final`. */
  lewis: LewisBoard[] | null;
  /** Scores two devices disagree on; shown to staff, not on public boards. */
  conflictCount: number;
}

export interface SquadShooterCard {
  shooterId: string;
  name: string;
  division: string | null;
  total: number;
  overallRank: number | null;
  divisionRank: number | null;
  progress: string;
  stations: {
    number: number;
    name: string;
    hits: number;
    targetCount: number;
    /** "H" broken, "M" lost, null not yet thrown */
    targets: ('H' | 'M' | null)[];
  }[];
}

export interface SquadFile {
  version: 1;
  eventId: string;
  generatedAt: string;
  squadId: string;
  squadNumber: number;
  shooters: SquadShooterCard[];
}

export interface StandingsOutput {
  standings: StandingsFile;
  squads: Map<string, SquadFile>;
}

const progressLabel = (t: ShooterTotal): string => (t.finished ? 'Final' : `thru ${t.stationsComplete}`);

interface ShooterRankInput extends RankInput {
  shooter: Shooter;
  totals: ShooterTotal;
  name: string;
}

export function buildStandings(input: StandingsInput): StandingsOutput {
  const { event } = input;
  const generatedAt = (input.now ?? new Date()).toISOString();
  const stationsAsc = [...input.stations].sort((a, b) => a.number - b.number);
  const stationsDesc = [...stationsAsc].reverse();
  const divisionsById = new Map(input.divisions.map((d) => [d.id, d]));

  const { results, conflicts } = effectiveScores(input.scores);
  const totals = shooterTotals(input.shooters, stationsAsc, results);
  const openDisputeShooters = new Set(input.disputes.filter((d) => d.open).map((d) => d.shooterId));

  const rankInputs: ShooterRankInput[] = input.shooters.map((shooter) => {
    const t = totals.get(shooter.id)!;
    const name = displayName(shooter, event.adultNameFormat);
    return {
      id: shooter.id,
      total: t.total,
      finished: t.finished,
      countback: stationsDesc.map((s) => t.stations.get(s.id)?.hits ?? 0),
      sortKey: name.toLowerCase(),
      shooter,
      totals: t,
      name,
    };
  });

  const toRow = (r: Ranked<ShooterRankInput>): BoardRow => ({
    shooterId: r.entry.id,
    rank: r.rank,
    tied: r.tied,
    shootOff: r.shootOff,
    name: r.entry.name,
    division: r.entry.shooter.divisionId ? divisionsById.get(r.entry.shooter.divisionId)?.name ?? null : null,
    total: r.entry.total,
    progress: progressLabel(r.entry.totals),
    finished: r.entry.finished,
    underReview: openDisputeShooters.has(r.entry.id),
  });

  const overallRanked = rankEntries(rankInputs, { tieBreak: event.tieBreak, awardsDepth: 1 });
  const overall = overallRanked.map(toRow);
  const overallRankById = new Map(overallRanked.map((r) => [r.entry.id, r.rank]));

  const divisionRankById = new Map<string, number>();
  const divisions: DivisionBoard[] = [...input.divisions]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((d) => {
      const members = rankInputs.filter((r) => r.shooter.divisionId === d.id);
      const ranked = rankEntries(members, { tieBreak: event.tieBreak, awardsDepth: d.awardsDepth });
      for (const r of ranked) divisionRankById.set(r.entry.id, r.rank);
      return { id: d.id, name: d.name, awardsDepth: d.awardsDepth, count: members.length, rows: ranked.map(toRow) };
    });

  const teams = buildTeams(input.teams, rankInputs, event.teamBestN);

  const everyoneFinished = rankInputs.length > 0 && rankInputs.every((r) => r.finished);
  const final = everyoneFinished && openDisputeShooters.size === 0;

  const lewis =
    event.lewisGroups && event.lewisGroups > 0
      ? lewisClasses(rankInputs, event.lewisGroups, { tieBreak: event.tieBreak, awardsDepth: 1 }).map((g) => ({
          group: g.group,
          rows: g.ranked.map(toRow),
        }))
      : null;

  // Squad progress from confirmations.
  const confirmedBySquad = new Map<string, Set<string>>();
  for (const c of input.confirmations) {
    if (c.status === 'disputed') continue;
    const set = confirmedBySquad.get(c.squadId) ?? new Set<string>();
    set.add(c.stationId);
    confirmedBySquad.set(c.squadId, set);
  }
  let squadsOnCourse = 0;
  let squadsFinished = 0;
  for (const squad of input.squads) {
    const done = confirmedBySquad.get(squad.id)?.size ?? 0;
    if (stationsAsc.length > 0 && done >= stationsAsc.length) squadsFinished++;
    else if (done > 0) squadsOnCourse++;
  }

  const standings: StandingsFile = {
    version: 1,
    eventId: event.id,
    eventName: event.name,
    generatedAt,
    courseTargets: courseTargetCount(stationsAsc),
    stationCount: stationsAsc.length,
    squadsOnCourse,
    squadsFinished,
    final,
    overall,
    divisions,
    teams,
    lewis,
    conflictCount: conflicts.length,
  };

  const byId = new Map(rankInputs.map((r) => [r.id, r]));
  const squads = new Map<string, SquadFile>();
  for (const squad of input.squads) {
    const shooters: SquadShooterCard[] = squad.shooterIds
      .map((id) => byId.get(id))
      .filter((r): r is ShooterRankInput => r !== undefined)
      .map((r) => ({
        shooterId: r.id,
        name: r.name,
        division: r.shooter.divisionId ? divisionsById.get(r.shooter.divisionId)?.name ?? null : null,
        total: r.total,
        overallRank: overallRankById.get(r.id) ?? null,
        divisionRank: divisionRankById.get(r.id) ?? null,
        progress: progressLabel(r.totals),
        stations: stationsAsc.map((s) => {
          const st = r.totals.stations.get(s.id)!;
          return {
            number: s.number,
            name: s.name,
            hits: st.hits,
            targetCount: s.targetCount,
            targets: st.targets.map((t) => (t === 'hit' ? 'H' : t === 'miss' ? 'M' : null)),
          };
        }),
      }));
    squads.set(squad.id, { version: 1, eventId: event.id, generatedAt, squadId: squad.id, squadNumber: squad.number, shooters });
  }

  return { standings, squads };
}

function buildTeams(teams: Team[], shooters: ShooterRankInput[], bestN: number | null): TeamRow[] {
  const entries = teams.map((team) => {
    const members = shooters.filter((s) => s.shooter.teamId === team.id);
    const scores = members.map((m) => m.total).sort((a, b) => b - a);
    const counted = bestN && bestN > 0 ? scores.slice(0, bestN) : scores;
    return {
      id: team.id,
      total: counted.reduce((a, b) => a + b, 0),
      finished: members.length > 0 && members.every((m) => m.finished),
      countback: [] as number[],
      sortKey: team.name.toLowerCase(),
      name: team.name,
      members: members.length,
    };
  });
  return rankEntries(entries, { tieBreak: 'shoot-off', awardsDepth: 3 }).map((r) => ({
    teamId: r.entry.id,
    rank: r.rank,
    tied: r.tied,
    name: r.entry.name,
    total: r.entry.total,
    members: r.entry.members,
    finished: r.entry.finished,
  }));
}
