// build-standings: rebuilds the public standings files for one event.
//
// Called by the database (request_standings_build) whenever a station is confirmed,
// a dispute is raised or settled, or a referee corrects a confirmed score.
// Writes to the public `standings` Storage bucket:
//   <event_id>/standings.json            overall, divisions, teams, Lewis Class
//   <event_id>/squads/<qr_token>.json    one per squad (personal scorecards)
//
// Debounce: at most one build per event runs at a time, and builds run at most once
// every 10 seconds. Requests that arrive during a build are picked up before it exits.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { buildStandings, type ScoreRecord } from '../_shared/core/index.ts';

const MIN_INTERVAL_MS = 10_000;
const MAX_ROUNDS = 6;
const PAGE = 1000;

type Row = Record<string, unknown>;

/** Reads every row for an event, 1,000 at a time, in a stable order. */
async function selectAll(
  client: SupabaseClient,
  table: string,
  columns: string,
  eventId: string,
  orderBy: string[] = ['id'],
  // deno-lint-ignore no-explicit-any
  extra?: (q: any) => any,
): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = client.from(table).select(columns).eq('event_id', eventId);
    for (const col of orderBy) q = q.order(col);
    q = q.range(from, from + PAGE - 1);
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < PAGE) return out;
  }
}

async function buildOnce(client: SupabaseClient, eventId: string) {
  const { data: ev, error: evErr } = await client
    .from('events')
    .select('id, name, tie_break, lewis_groups, team_best_n, adult_name_format')
    .eq('id', eventId)
    .single();
  if (evErr || !ev) throw new Error(`event: ${evErr?.message ?? 'not found'}`);

  const [stations, divisions, teams, shooters, squads, scores, confirmations, disputes] = await Promise.all([
    selectAll(client, 'stations', 'id, number, name, target_count', eventId),
    selectAll(client, 'divisions', 'id, name, sort_order, awards_depth', eventId),
    selectAll(client, 'teams', 'id, name', eventId),
    selectAll(client, 'shooters', 'id, first_name, last_name, is_minor, division_id, team_id', eventId),
    selectAll(client, 'squads', 'id, number, is_practice, qr_token', eventId),
    selectAll(client, 'score_events', 'id, shooter_id, station_id, target_no, result, kind, server_ts, supersedes_id', eventId, ['id'], (q) =>
      q.in('kind', ['official', 'paper']),
    ),
    selectAll(client, 'station_confirmations', 'squad_id, station_id, status', eventId, ['squad_id', 'station_id']),
    selectAll(client, 'disputes', 'id, shooter_id, station_id, resolved_at', eventId),
  ]);

  // squad_members has no event_id, so fetch it through the event's squads.
  const members: Row[] = [];
  const realSquads = squads.filter((s) => !s.is_practice);
  const squadIds = realSquads.map((s) => s.id as string);
  if (squadIds.length) {
    for (let i = 0; i < squadIds.length; i += 200) {
      const { data, error } = await client
        .from('squad_members')
        .select('squad_id, shooter_id, shoot_order')
        .in('squad_id', squadIds.slice(i, i + 200));
      if (error) throw new Error(`squad_members: ${error.message}`);
      members.push(...((data ?? []) as Row[]));
    }
  }
  const squadOf = new Map(members.map((m) => [m.shooter_id as string, m.squad_id as string]));

  const output = buildStandings({
    event: {
      id: ev.id,
      name: ev.name,
      tieBreak: ev.tie_break,
      lewisGroups: ev.lewis_groups,
      teamBestN: ev.team_best_n,
      adultNameFormat: ev.adult_name_format,
    },
    stations: stations.map((s) => ({ id: s.id as string, number: s.number as number, name: s.name as string, targetCount: s.target_count as number })),
    divisions: divisions.map((d) => ({ id: d.id as string, name: d.name as string, sortOrder: d.sort_order as number, awardsDepth: d.awards_depth as number })),
    teams: teams.map((t) => ({ id: t.id as string, name: t.name as string })),
    // Only shooters in a real (non-practice) squad appear on the boards.
    shooters: shooters
      .filter((s) => squadOf.has(s.id as string))
      .map((s) => ({
        id: s.id as string,
        firstName: s.first_name as string,
        lastName: s.last_name as string,
        isMinor: s.is_minor as boolean,
        divisionId: (s.division_id as string | null) ?? null,
        teamId: (s.team_id as string | null) ?? null,
        squadId: squadOf.get(s.id as string) ?? null,
      })),
    squads: realSquads.map((q) => ({
      id: q.id as string,
      number: q.number as number,
      shooterIds: members
        .filter((m) => m.squad_id === q.id)
        .sort((a, b) => (a.shoot_order as number) - (b.shoot_order as number))
        .map((m) => m.shooter_id as string),
    })),
    scores: scores.map(
      (r): ScoreRecord => ({
        id: r.id as string,
        shooterId: r.shooter_id as string,
        stationId: r.station_id as string,
        targetNo: r.target_no as number,
        result: r.result as 'hit' | 'miss',
        kind: r.kind as 'official' | 'paper',
        serverTs: r.server_ts as string,
        supersedesId: (r.supersedes_id as string | null) ?? null,
      }),
    ),
    confirmations: confirmations.map((c) => ({
      squadId: c.squad_id as string,
      stationId: c.station_id as string,
      status: c.status as 'confirmed' | 'disputed' | 'resolved',
    })),
    disputes: disputes.map((d) => ({ id: d.id as string, shooterId: d.shooter_id as string, stationId: d.station_id as string, open: d.resolved_at === null })),
  });

  const bucket = client.storage.from('standings');
  const put = async (path: string, body: unknown) => {
    const { error } = await bucket.upload(path, new Blob([JSON.stringify(body)], { type: 'application/json' }), {
      upsert: true,
      cacheControl: '10',
      contentType: 'application/json',
    });
    if (error) throw new Error(`upload ${path}: ${error.message}`);
  };

  await put(`${eventId}/standings.json`, output.standings);
  const tokenOf = new Map(realSquads.map((q) => [q.id as string, q.qr_token as string]));
  await Promise.all(
    [...output.squads.entries()].map(([squadId, file]) => put(`${eventId}/squads/${tokenOf.get(squadId)}.json`, file)),
  );
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('STANDINGS_SECRET');
  if (!secret || req.headers.get('x-standings-secret') !== secret) {
    return new Response('forbidden', { status: 403 });
  }
  const { event_id: eventId } = (await req.json().catch(() => ({}))) as { event_id?: string };
  if (!eventId) return new Response('event_id required', { status: 400 });

  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  for (let round = 0; round < MAX_ROUNDS; round++) {
    // Claim the build lock for this event (stale after 60 seconds).
    const staleBefore = new Date(Date.now() - 60_000).toISOString();
    const startedAt = new Date();
    const { data: claimed, error: claimErr } = await client
      .from('standings_builds')
      .update({ building_since: startedAt.toISOString() })
      .eq('event_id', eventId)
      .or(`building_since.is.null,building_since.lt.${staleBefore}`)
      .select('requested_at, built_at');
    if (claimErr) return new Response(claimErr.message, { status: 500 });
    if (!claimed?.length) return new Response('build already running', { status: 202 });

    // Keep at least MIN_INTERVAL_MS between builds.
    const lastBuilt = claimed[0]!.built_at ? Date.parse(claimed[0]!.built_at as string) : 0;
    const wait = lastBuilt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const buildStart = new Date();

    try {
      await buildOnce(client, eventId);
    } catch (err) {
      await client.from('standings_builds').update({ building_since: null }).eq('event_id', eventId);
      return new Response(String(err instanceof Error ? err.message : err), { status: 500 });
    }

    const { data: after } = await client
      .from('standings_builds')
      .update({ building_since: null, built_at: new Date().toISOString() })
      .eq('event_id', eventId)
      .select('requested_at')
      .single();

    // Another change arrived while we were building: go round again.
    if (!after || Date.parse(after.requested_at as string) <= buildStart.getTime()) {
      return new Response('ok', { status: 200 });
    }
  }
  return new Response('ok (more changes pending; next request will rebuild)', { status: 200 });
});
