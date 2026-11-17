import { createClient } from '@supabase/supabase-js';
import {
  AdminError,
  presentationRows,
  type AdminApi,
  type AdminSquad,
  type EventSettings,
  type EventSetup,
  type ImportResult,
  type PresentationKind,
} from './adminApi.ts';

type Row = Record<string, any>; // eslint-ish: rows come straight from PostgREST

export function createSupabaseAdminApi(url: string, anonKey: string): AdminApi {
  // Separate session from the volunteer app, so a phone can be both.
  const db = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cs.admin.auth' } });

  const must = <T>(res: { data: T | null; error: { message: string } | null }): T => {
    if (res.error) throw new AdminError(res.error.message);
    return res.data as T;
  };

  return {
    mode: 'supabase',

    async currentUser() {
      const { data } = await db.auth.getUser();
      return data.user && !data.user.is_anonymous ? { email: data.user.email ?? '' } : null;
    },
    async signIn(email, password) {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw new AdminError(error.message);
    },
    async signUp(email, password) {
      const { data, error } = await db.auth.signUp({ email, password });
      if (error) throw new AdminError(error.message);
      if (!data.session) throw new AdminError('Check your email to confirm your account, then sign in.');
    },
    async signOut() {
      await db.auth.signOut();
    },

    async listEvents() {
      const { data: user } = await db.auth.getUser();
      if (!user.user) return [];
      const staff = must(await db.from('staff').select('event_id').eq('user_id', user.user.id).eq('role', 'admin')) as Row[];
      if (staff.length === 0) return [];
      const events = must(
        await db.from('events').select('id, name, event_date, join_code, status').in('id', staff.map((s) => s.event_id)).order('created_at', { ascending: false }),
      ) as Row[];
      return events.map((e) => ({ id: e.id, name: e.name, eventDate: e.event_date, joinCode: e.join_code, status: e.status }));
    },

    async createEvent({ name, joinCode, scorerPin, refereePin, displayName }) {
      return must(
        await db.rpc('create_event', { p_name: name, p_join_code: joinCode, p_scorer_pin: scorerPin, p_referee_pin: refereePin, p_display_name: displayName }),
      ) as string;
    },

    async loadSetup(eventId): Promise<EventSetup> {
      const [ev, courses, stations, presentations, divisions, teams, shooters, squads] = await Promise.all([
        db.from('events').select('id, name, event_date, venue, join_code, tie_break, lewis_groups, team_best_n, adult_name_format, status').eq('id', eventId).single(),
        db.from('courses').select('id').eq('event_id', eventId).limit(1),
        db.from('stations').select('id, number, name, target_count, qr_token').eq('event_id', eventId).order('number'),
        db.from('presentations').select('station_id, kind').order('ord'),
        db.from('divisions').select('id, name, sort_order, awards_depth').eq('event_id', eventId).order('sort_order'),
        db.from('teams').select('id, name').eq('event_id', eventId).order('name'),
        db.from('shooters').select('id, first_name, last_name, is_minor, division_id, team_id').eq('event_id', eventId).order('last_name').limit(5000),
        db.from('squads').select('id, number, is_practice, qr_token, start_station_id, squad_members(shooter_id, shoot_order)').eq('event_id', eventId).order('number'),
      ]);
      const e = must(ev) as Row;
      const st = must(stations) as Row[];
      const pres = must(presentations) as Row[];
      const divs = must(divisions) as Row[];
      const tms = must(teams) as Row[];
      const shs = must(shooters) as Row[];
      const sqs = must(squads) as Row[];
      const courseId = ((must(courses) as Row[])[0]?.id as string | undefined) ?? '';

      const divName = new Map(divs.map((d) => [d.id, d.name as string]));
      const teamName = new Map(tms.map((t) => [t.id, t.name as string]));
      const stationNumber = new Map(st.map((s) => [s.id, s.number as number]));
      const shooterById = new Map(shs.map((s) => [s.id, s]));
      const member = (s: Row) => ({
        shooterId: s.id as string,
        firstName: s.first_name as string,
        lastName: s.last_name as string,
        isMinor: s.is_minor as boolean,
        division: s.division_id ? divName.get(s.division_id) ?? null : null,
        team: s.team_id ? teamName.get(s.team_id) ?? null : null,
      });
      const squadded = new Set<string>();
      const squadList: AdminSquad[] = sqs.map((q) => ({
        id: q.id,
        number: q.number,
        isPractice: q.is_practice,
        qrToken: q.qr_token,
        startStationNumber: q.start_station_id ? stationNumber.get(q.start_station_id) ?? null : null,
        members: (q.squad_members as Row[])
          .sort((a, b) => a.shoot_order - b.shoot_order)
          .map((m) => {
            squadded.add(m.shooter_id);
            const s = shooterById.get(m.shooter_id);
            return s ? { ...member(s), shootOrder: m.shoot_order as number } : null;
          })
          .filter((m): m is NonNullable<typeof m> => m !== null),
      }));
      const firstKind = new Map<string, PresentationKind>();
      for (const p of pres) if (!firstKind.has(p.station_id)) firstKind.set(p.station_id, p.kind);

      const event: EventSettings = {
        id: e.id,
        name: e.name,
        eventDate: e.event_date,
        venue: e.venue,
        joinCode: e.join_code,
        status: e.status,
        tieBreak: e.tie_break,
        lewisGroups: e.lewis_groups,
        teamBestN: e.team_best_n,
        adultNameFormat: e.adult_name_format,
      };
      return {
        event,
        courseId,
        stations: st.map((s) => ({
          id: s.id,
          number: s.number,
          name: s.name,
          targetCount: s.target_count,
          qrToken: s.qr_token,
          presentation: firstKind.get(s.id) ?? 'single',
        })),
        divisions: divs.map((d) => ({ id: d.id, name: d.name, sortOrder: d.sort_order, awardsDepth: d.awards_depth })),
        teams: tms.map((t) => ({ id: t.id, name: t.name })),
        squads: squadList,
        unsquadded: shs.filter((s) => !squadded.has(s.id)).map(member),
        shooterCount: shs.length,
      };
    },

    async updateEvent(eventId, patch) {
      const row: Row = {};
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.eventDate !== undefined) row.event_date = patch.eventDate || null;
      if (patch.venue !== undefined) row.venue = patch.venue || null;
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.tieBreak !== undefined) row.tie_break = patch.tieBreak;
      if (patch.lewisGroups !== undefined) row.lewis_groups = patch.lewisGroups;
      if (patch.teamBestN !== undefined) row.team_best_n = patch.teamBestN;
      if (patch.adultNameFormat !== undefined) row.adult_name_format = patch.adultNameFormat;
      must(await db.from('events').update(row).eq('id', eventId));
    },

    async setPins(eventId, scorerPin, refereePin) {
      must(await db.rpc('set_event_pins', { p_event: eventId, p_scorer_pin: scorerPin, p_referee_pin: refereePin }));
    },

    async saveStation(eventId, courseId, s) {
      const row = { event_id: eventId, course_id: courseId, number: s.number, name: s.name, target_count: s.targetCount };
      const saved = s.id
        ? (must(await db.from('stations').update(row).eq('id', s.id).select('id').single()) as Row)
        : (must(await db.from('stations').insert(row).select('id').single()) as Row);
      must(await db.from('presentations').delete().eq('station_id', saved.id));
      must(await db.from('presentations').insert(presentationRows(s.targetCount, s.presentation).map((p) => ({ ...p, station_id: saved.id }))));
    },

    async deleteStation(stationId) {
      must(await db.from('stations').delete().eq('id', stationId));
    },

    async addDivisions(eventId, divisions) {
      if (divisions.length === 0) return;
      must(await db.from('divisions').upsert(divisions.map((d) => ({ event_id: eventId, name: d.name, sort_order: d.sortOrder })), { onConflict: 'event_id,name', ignoreDuplicates: true }));
    },
    async updateDivision(id, patch) {
      const row: Row = {};
      if (patch.awardsDepth !== undefined) row.awards_depth = patch.awardsDepth;
      if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
      must(await db.from('divisions').update(row).eq('id', id));
    },
    async deleteDivision(id) {
      must(await db.from('divisions').delete().eq('id', id));
    },

    async importRegistrations(eventId, rows): Promise<ImportResult> {
      const res = must(await db.rpc('import_registrations', { p_event: eventId, p_rows: rows })) as Row;
      return res.ok
        ? { ok: true, shooters: res.shooters, teamsCreated: res.teams_created, squadsCreated: res.squads_created }
        : { ok: false, errors: res.errors };
    },

    async setSquadStart(squadId, stationId) {
      must(await db.from('squads').update({ start_station_id: stationId }).eq('id', squadId));
    },

    async ensurePracticeSquad(eventId) {
      const existing = must(await db.from('squads').select('id').eq('event_id', eventId).eq('is_practice', true).limit(1)) as Row[];
      if (existing.length) return;
      const squad = must(await db.from('squads').insert({ event_id: eventId, number: 99, is_practice: true }).select('id').single()) as Row;
      const shooters = must(
        await db.from('shooters').insert([
          { event_id: eventId, first_name: 'Practice', last_name: 'Shooter A' },
          { event_id: eventId, first_name: 'Practice', last_name: 'Shooter B' },
        ]).select('id'),
      ) as Row[];
      must(await db.from('squad_members').insert(shooters.map((s, i) => ({ squad_id: squad.id, shooter_id: s.id, shoot_order: i + 1 }))));
    },
  };
}
