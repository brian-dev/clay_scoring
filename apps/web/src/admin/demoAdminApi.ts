import {
  AdminError,
  type AdminApi,
  type AdminDivision,
  type AdminStation,
  type EventSettings,
  type EventSetup,
  type ImportResult,
} from './adminApi.ts';
import { DIVISION_PRESET } from './registration.ts';

/**
 * Demo-mode admin backend: an in-browser copy of the event, saved in localStorage so
 * it survives reloads. Mirrors the database rules closely enough for training and UI work.
 */

interface DemoShooter {
  id: string;
  firstName: string;
  lastName: string;
  isMinor: boolean;
  divisionId: string | null;
  teamId: string | null;
}
interface DemoSquad {
  id: string;
  number: number;
  isPractice: boolean;
  qrToken: string;
  startStationId: string | null;
  members: { shooterId: string; shootOrder: number }[];
}
interface DemoState {
  event: EventSettings;
  stations: AdminStation[];
  divisions: AdminDivision[];
  teams: { id: string; name: string }[];
  shooters: DemoShooter[];
  squads: DemoSquad[];
  seq: number;
}

const KEY = 'cs.demo.admin';

function seed(): DemoState {
  const stations: AdminStation[] = ['Springing teal', 'Crossing pair', 'Rabbit', 'Incomer', 'Tower'].map((name, i) => ({
    id: `demo-st-${i + 1}`,
    number: i + 1,
    name,
    targetCount: 8,
    qrToken: `station-${i + 1}`,
    presentation: 'report_pair',
  }));
  const divisions: AdminDivision[] = DIVISION_PRESET.map((d, i) => ({ id: `dv${i + 1}`, name: d.name, sortOrder: d.sortOrder, awardsDepth: 3 }));
  const sh = (id: string, firstName: string, lastName: string, div: number | null, isMinor = false, teamId: string | null = null): DemoShooter => ({
    id, firstName, lastName, isMinor, divisionId: div ? `dv${div}` : null, teamId,
  });
  const shooters = [
    sh('d101', 'Ray', 'Delgado', 1, false, 'tm1'), sh('d102', 'Kaden', 'Whitfield', 3, true, 'tm1'), sh('d103', 'Tom', 'Barrera', 1, false, 'tm1'),
    sh('d104', 'Lisa', 'Strand', 2, false, 'tm1'), sh('d105', 'Jace', 'Castillo', 3, true, 'tm2'), sh('d106', 'Nora', 'Ortiz', 4, true, 'tm2'),
    sh('d107', 'Sara', 'Vance', 2, false, 'tm2'), sh('d108', 'Wyatt', 'Tate', 5, true, 'tm2'), sh('d109', 'Emma', 'Ruiz', 6, true),
    sh('d110', 'Gus', 'Holloway', 1), sh('d111', 'Practice', 'Shooter A', null), sh('d112', 'Practice', 'Shooter B', null),
  ];
  const squad = (n: number, ids: string[], start: number | null, practice = false): DemoSquad => ({
    id: practice ? 'demo-sq-99' : `demo-sq-${n}`,
    number: n,
    isPractice: practice,
    qrToken: practice ? 'squad-practice' : `squad-${n}`,
    startStationId: start ? `demo-st-${start}` : null,
    members: ids.map((shooterId, i) => ({ shooterId, shootOrder: i + 1 })),
  });
  return {
    event: {
      id: 'demo-event', name: "Slayin' Clays Demo", eventDate: '2027-04-10', venue: 'Buck Horn Creek Ranch, McCoy, Texas',
      joinCode: 'SLAYIN', status: 'live', tieBreak: 'countback', lewisGroups: 3, teamBestN: null, adultNameFormat: 'full',
    },
    stations,
    divisions,
    teams: [{ id: 'tm1', name: 'Sponsor Team A' }, { id: 'tm2', name: 'Pirates Alumni' }],
    shooters,
    squads: [
      squad(1, ['d101', 'd102', 'd103', 'd104'], 1),
      squad(2, ['d105', 'd106', 'd107', 'd108'], 3),
      squad(3, ['d109', 'd110'], 5),
      squad(99, ['d111', 'd112'], null, true),
    ],
    seq: 1000,
  };
}

export function createDemoAdminApi(): AdminApi {
  let state: DemoState;
  try {
    state = JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? seed();
  } catch {
    state = seed();
  }
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* memory only */
    }
  };
  const id = (p: string) => `${p}-${++state.seq}`;
  let signedIn = true;

  return {
    mode: 'demo',
    async currentUser() {
      return signedIn ? { email: 'organizer@demo' } : null;
    },
    async signIn() {
      signedIn = true;
    },
    async signUp() {
      signedIn = true;
    },
    async signOut() {
      signedIn = false;
    },

    async listEvents() {
      const { id, name, eventDate, joinCode, status } = state.event;
      return [{ id, name, eventDate, joinCode, status }];
    },
    async createEvent() {
      throw new AdminError('Demo mode has one event. Connect Supabase to create real events.');
    },

    async loadSetup(): Promise<EventSetup> {
      const divName = new Map(state.divisions.map((d) => [d.id, d.name]));
      const teamName = new Map(state.teams.map((t) => [t.id, t.name]));
      const stNum = new Map(state.stations.map((s) => [s.id, s.number]));
      const byId = new Map(state.shooters.map((s) => [s.id, s]));
      const member = (s: DemoShooter) => ({
        shooterId: s.id, firstName: s.firstName, lastName: s.lastName, isMinor: s.isMinor,
        division: s.divisionId ? divName.get(s.divisionId) ?? null : null,
        team: s.teamId ? teamName.get(s.teamId) ?? null : null,
      });
      const squadded = new Set(state.squads.flatMap((q) => q.members.map((m) => m.shooterId)));
      return structuredClone({
        event: state.event,
        courseId: 'demo-course',
        stations: [...state.stations].sort((a, b) => a.number - b.number),
        divisions: [...state.divisions].sort((a, b) => a.sortOrder - b.sortOrder),
        teams: state.teams,
        squads: [...state.squads].sort((a, b) => a.number - b.number).map((q) => ({
          id: q.id, number: q.number, isPractice: q.isPractice, qrToken: q.qrToken,
          startStationNumber: q.startStationId ? stNum.get(q.startStationId) ?? null : null,
          members: [...q.members].sort((a, b) => a.shootOrder - b.shootOrder).map((m) => ({ ...member(byId.get(m.shooterId)!), shootOrder: m.shootOrder })),
        })),
        unsquadded: state.shooters.filter((s) => !squadded.has(s.id)).map(member),
        shooterCount: state.shooters.length,
      });
    },

    async updateEvent(_eventId, patch) {
      state.event = { ...state.event, ...patch };
      save();
    },
    async setPins(_e, scorer, referee) {
      if (!/^\d{4,8}$/.test(scorer) || !/^\d{4,8}$/.test(referee)) throw new AdminError('PINs must be 4 to 8 digits.');
      if (scorer === referee) throw new AdminError('The scorer and referee PINs must differ.');
    },

    async saveStation(_e, _c, s) {
      if (state.stations.some((x) => x.number === s.number && x.id !== s.id)) throw new AdminError(`Station ${s.number} already exists.`);
      if (s.id) state.stations = state.stations.map((x) => (x.id === s.id ? { ...x, ...s, id: x.id } : x));
      else state.stations.push({ ...s, id: id('st'), qrToken: id('stn') });
      save();
    },
    async deleteStation(stationId) {
      state.stations = state.stations.filter((s) => s.id !== stationId);
      save();
    },

    async addDivisions(_e, divisions) {
      for (const d of divisions) {
        if (!state.divisions.some((x) => x.name.toLowerCase() === d.name.toLowerCase())) {
          state.divisions.push({ id: id('dv'), name: d.name, sortOrder: d.sortOrder, awardsDepth: 3 });
        }
      }
      save();
    },
    async updateDivision(divId, patch) {
      state.divisions = state.divisions.map((d) => (d.id === divId ? { ...d, ...patch } : d));
      save();
    },
    async deleteDivision(divId) {
      state.divisions = state.divisions.filter((d) => d.id !== divId);
      state.shooters = state.shooters.map((s) => (s.divisionId === divId ? { ...s, divisionId: null } : s));
      save();
    },

    async importRegistrations(_e, rows): Promise<ImportResult> {
      const errors: { row: number; message: string }[] = [];
      const divByLower = new Map(state.divisions.map((d) => [d.name.toLowerCase(), d.id]));
      const seen = new Set<string>();
      rows.forEach((r, i) => {
        if (!r.first_name.trim()) errors.push({ row: i + 1, message: 'First name is missing.' });
        if (r.division && !divByLower.has(r.division.toLowerCase())) errors.push({ row: i + 1, message: `Unknown division "${r.division}".` });
        if (r.squad && !/^\d{1,4}$/.test(r.squad)) errors.push({ row: i + 1, message: `Squad "${r.squad}" must be a number.` });
        if (r.squad && r.shoot_order) {
          const k = `${r.squad}:${r.shoot_order}`;
          if (seen.has(k)) errors.push({ row: i + 1, message: `Squad ${r.squad} already has a shooter in position ${r.shoot_order}.` });
          seen.add(k);
        }
      });
      if (errors.length) return { ok: false, errors };

      const teamsBefore = state.teams.length;
      const squadsBefore = state.squads.length;
      for (const r of rows) {
        let teamId: string | null = null;
        if (r.team.trim()) {
          let t = state.teams.find((x) => x.name === r.team.trim());
          if (!t) state.teams.push((t = { id: id('tm'), name: r.team.trim() }));
          teamId = t.id;
        }
        const shooter: DemoShooter = {
          id: id('sh'), firstName: r.first_name.trim(), lastName: r.last_name.trim(), isMinor: r.is_minor,
          divisionId: r.division ? divByLower.get(r.division.toLowerCase()) ?? null : null, teamId,
        };
        state.shooters.push(shooter);
        if (r.squad) {
          const n = Number(r.squad);
          let q = state.squads.find((x) => x.number === n);
          if (!q) state.squads.push((q = { id: id('sq'), number: n, isPractice: false, qrToken: `squad-${n}`, startStationId: null, members: [] }));
          const wanted = r.shoot_order ? Number(r.shoot_order) : null;
          const order = wanted && !q.members.some((m) => m.shootOrder === wanted) ? wanted : Math.max(0, ...q.members.map((m) => m.shootOrder)) + 1;
          q.members.push({ shooterId: shooter.id, shootOrder: order });
        }
      }
      save();
      return { ok: true, shooters: rows.length, teamsCreated: state.teams.length - teamsBefore, squadsCreated: state.squads.length - squadsBefore };
    },

    async setSquadStart(squadId, stationId) {
      state.squads = state.squads.map((q) => (q.id === squadId ? { ...q, startStationId: stationId } : q));
      save();
    },
    async ensurePracticeSquad() {
      /* the demo already has one */
    },
  };
}

/** Clears demo admin data back to the seed (used by tests and the "reset demo" button). */
export const resetDemoAdmin = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
};
