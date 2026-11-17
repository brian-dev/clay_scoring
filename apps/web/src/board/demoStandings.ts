import {
  buildStandings,
  type Division,
  type EventConfig,
  type ScoreRecord,
  type Shooter,
  type Squad,
  type Station,
  type StationConfirmation,
  type StandingsOutput,
} from '@slayin/core';

/**
 * A simulated shoot for demo mode: 32 made-up shooters in 8 squads on a 100-target,
 * 10-station course. Each tick advances every squad by one station so the boards move.
 */

const DIVISIONS: Division[] = [
  ['Adult Male', 1], ['Adult Female', 2], ['Intermediate Male', 3], ['Intermediate Female', 4], ['Junior Male', 5], ['Junior Female', 6],
].map(([name, sortOrder]) => ({ id: `dv${sortOrder}`, name: name as string, sortOrder: sortOrder as number, awardsDepth: 3 }));

const NAMES: [string, string, number, boolean][] = [
  ['Ray', 'Delgado', 1, false], ['Tom', 'Barrera', 1, false], ['Marcus', 'Okafor', 1, false], ['Gus', 'Holloway', 1, false],
  ['Dale', 'Hale', 1, false], ['Neil', 'Ortega', 1, false], ['Bo', 'Kessler', 1, false], ['Clint', 'Rowe', 1, false],
  ['Lisa', 'Strand', 2, false], ['Sara', 'Vance', 2, false], ['June', 'Pruett', 2, false], ['Amy', 'Calder', 2, false],
  ['Kaden', 'Whitfield', 3, true], ['Jace', 'Castillo', 3, true], ['Avery', 'Pruitt', 3, true], ['Ben', 'Nguyen', 3, true],
  ['Cole', 'Reyes', 3, true], ['Eli', 'Larkin', 3, true], ['Nora', 'Ortiz', 4, true], ['Paige', 'Moreno', 4, true],
  ['Lily', 'Sutton', 4, true], ['Rosa', 'Navarro', 4, true], ['Wyatt', 'Tate', 5, true], ['Hank', 'Cole', 5, true],
  ['Owen', 'Price', 5, true], ['Luke', 'Bishop', 5, true], ['Emma', 'Ruiz', 6, true], ['Mia', 'Price', 6, true],
  ['Ella', 'Dunn', 6, true], ['Ava', 'Kirby', 6, true], ['Pat', 'Greer', 1, false], ['Sam', 'Ivers', 2, false],
];

const event: EventConfig = {
  id: 'demo-event',
  name: "Slayin' Clays Demo",
  tieBreak: 'countback',
  lewisGroups: 3,
  teamBestN: null,
  adultNameFormat: 'full',
};

const stationNames = ['Springing teal', 'Crossing pair', 'Rabbit', 'Incomer', 'Tower', 'Quartering', 'Chandelle', 'Battue', 'Rising pair', 'Long crosser'];
const stations: Station[] = stationNames.map((name, i) => ({ id: `st${i + 1}`, number: i + 1, name, targetCount: 10 }));

const teams = [
  { id: 'tm1', name: 'Sponsor Team A' },
  { id: 'tm2', name: 'Pirates Alumni' },
  { id: 'tm3', name: 'Sponsor Team B' },
  { id: 'tm4', name: 'Brush Country' },
];

const shooters: Shooter[] = NAMES.map(([first, last, div, minor], i) => ({
  id: `sh${i + 1}`,
  firstName: first,
  lastName: last,
  isMinor: minor,
  divisionId: `dv${div}`,
  teamId: i < 16 ? teams[i % 4]!.id : null,
  squadId: `sq${Math.floor(i / 4) + 1}`,
}));

const squads: Squad[] = Array.from({ length: 8 }, (_, q) => ({
  id: `sq${q + 1}`,
  number: q + 1,
  shooterIds: shooters.slice(q * 4, q * 4 + 4).map((s) => s.id),
}));

/** Deterministic pseudo-random hit chance per shooter, so ranks are stable between ticks. */
function rand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

export function demoStandings(tick: number, now = new Date()): StandingsOutput {
  const scores: ScoreRecord[] = [];
  const confirmations: StationConfirmation[] = [];
  squads.forEach((squad, q) => {
    // Squads start on different stations (shotgun start) and are at slightly different paces.
    const done = Math.min(stations.length, Math.max(0, tick - (q % 3)));
    for (let k = 0; k < done; k++) {
      const st = stations[(q + k) % stations.length]!;
      confirmations.push({ squadId: squad.id, stationId: st.id, status: 'confirmed' });
      for (const sid of squad.shooterIds) {
        const n = Number(sid.slice(2));
        // Base skill plus station-to-station form, so the lead changes hands during the demo.
        const skill = 0.6 + 0.25 * rand(n) + 0.3 * (rand(n * 77 + st.number * 13) - 0.5);
        for (let t = 1; t <= st.targetCount; t++) {
          const hit = rand(n * 1000 + st.number * 37 + t) < skill;
          scores.push({
            id: `${sid}-${st.id}-${t}`,
            shooterId: sid,
            stationId: st.id,
            targetNo: t,
            result: hit ? 'hit' : 'miss',
            kind: 'official',
            serverTs: now.toISOString(),
            supersedesId: null,
          });
        }
      }
    }
  });
  const disputes = tick >= 3 && tick < 6 ? [{ id: 'dp1', shooterId: 'sh9', stationId: 'st2', open: true }] : [];
  return buildStandings({ event, stations, divisions: DIVISIONS, teams, shooters, squads, scores, confirmations, disputes, now });
}

/** Demo squad tokens map to squad ids (squad-1 .. squad-8). */
export const demoSquadIdForToken = (token: string): string | null => {
  const m = token.match(/^squad-(\d+)$/);
  return m && Number(m[1]) >= 1 && Number(m[1]) <= 8 ? `sq${m[1]}` : null;
};
