-- Clay Scoring: initial schema
--
-- Design notes
-- * score_events is an append-only log. Every tap carries a client-generated UUID,
--   so a tap re-sent after a dropped connection is stored once. Corrections are new
--   rows whose supersedes_id points at the row they replace.
-- * Writes go through SECURITY DEFINER RPCs that validate everything; there are no
--   direct INSERT/UPDATE/DELETE policies on the scoring tables.
-- * The public never reads these tables. Public leaderboards read cached JSON files
--   from the `standings` Storage bucket (keeps us inside the free tier).
-- * Shooter contact details live in shooter_contacts (admins only).

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.score_result as enum ('hit', 'miss');
create type public.score_kind as enum ('official', 'paper', 'shadow', 'practice');
create type public.staff_role as enum ('admin', 'referee', 'scorer');
create type public.confirmation_status as enum ('confirmed', 'disputed', 'resolved');
create type public.tie_break_method as enum ('countback', 'shoot-off');
create type public.adult_name_format as enum ('full', 'initial-last');
create type public.presentation_kind as enum ('single', 'report_pair', 'true_pair', 'following_pair');

-- Short random token for QR codes (URL-safe).
create or replace function public.new_token(bytes int default 9)
returns text language sql volatile security definer set search_path = public, extensions as $$
  select translate(encode(gen_random_bytes(bytes), 'base64'), '+/=', '-_');
$$;

-- ---------------------------------------------------------------------------
-- Event setup
-- ---------------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  event_date date,
  venue text,
  join_code text not null unique check (join_code ~ '^[A-Z0-9]{4,12}$'),
  scorer_pin_hash text not null,
  referee_pin_hash text not null,
  tie_break public.tie_break_method not null default 'countback',
  lewis_groups int check (lewis_groups is null or lewis_groups between 1 and 20),
  team_best_n int check (team_best_n is null or team_best_n > 0),
  adult_name_format public.adult_name_format not null default 'full',
  status text not null default 'setup' check (status in ('setup', 'live', 'locked')),
  created_at timestamptz not null default now()
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  name text not null default 'Main course'
);

create table public.stations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  course_id uuid not null references public.courses on delete cascade,
  number int not null check (number > 0),
  name text not null default '',
  target_count int not null check (target_count between 1 and 50),
  qr_token text not null unique default public.new_token(),
  unique (course_id, number)
);

create table public.presentations (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations on delete cascade,
  ord int not null,
  kind public.presentation_kind not null,
  target_count int not null check (target_count between 1 and 2),
  unique (station_id, ord)
);

create table public.divisions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  name text not null,
  sort_order int not null default 0,
  awards_depth int not null default 3 check (awards_depth between 0 and 10),
  unique (event_id, name)
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  name text not null,
  unique (event_id, name)
);

create table public.shooters (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  first_name text not null,
  last_name text not null default '',
  is_minor boolean not null default false,
  division_id uuid references public.divisions on delete set null,
  team_id uuid references public.teams on delete set null,
  registration_ref text,
  created_at timestamptz not null default now()
);

-- Admin-only contact details, kept out of every scorer/public read path.
create table public.shooter_contacts (
  shooter_id uuid primary key references public.shooters on delete cascade,
  event_id uuid not null references public.events on delete cascade,
  email text,
  phone text
);

create table public.squads (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  number int not null check (number > 0),
  start_station_id uuid references public.stations on delete set null,
  is_practice boolean not null default false,
  qr_token text not null unique default public.new_token(),
  unique (event_id, number)
);

create table public.squad_members (
  squad_id uuid not null references public.squads on delete cascade,
  shooter_id uuid not null unique references public.shooters on delete cascade,
  shoot_order int not null check (shoot_order > 0),
  primary key (squad_id, shooter_id),
  unique (squad_id, shoot_order)
);

-- ---------------------------------------------------------------------------
-- Staff and devices
-- ---------------------------------------------------------------------------
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  user_id uuid not null,
  role public.staff_role not null,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  unique (event_id, user_id, role)
);
create index staff_user_idx on public.staff (user_id);

create table public.devices (
  id uuid primary key,
  event_id uuid not null references public.events on delete cascade,
  staff_id uuid references public.staff on delete set null,
  station_id uuid references public.stations on delete set null,
  app_version text,
  last_seen timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Scoring
-- ---------------------------------------------------------------------------
create table public.score_events (
  id uuid primary key,
  event_id uuid not null references public.events on delete cascade,
  shooter_id uuid not null references public.shooters on delete cascade,
  station_id uuid not null references public.stations on delete cascade,
  squad_id uuid not null references public.squads on delete cascade,
  target_no int not null check (target_no > 0),
  result public.score_result not null,
  kind public.score_kind not null,
  staff_id uuid references public.staff on delete set null,
  device_id uuid,
  device_ts timestamptz not null,
  server_ts timestamptz not null default now(),
  supersedes_id uuid references public.score_events,
  reason text
);
create index score_events_event_idx on public.score_events (event_id);
create index score_events_target_idx on public.score_events (shooter_id, station_id, target_no);
create index score_events_squad_station_idx on public.score_events (squad_id, station_id);

create table public.station_confirmations (
  squad_id uuid not null references public.squads on delete cascade,
  station_id uuid not null references public.stations on delete cascade,
  event_id uuid not null references public.events on delete cascade,
  status public.confirmation_status not null default 'confirmed',
  confirmed_by uuid references public.staff on delete set null,
  confirmed_at timestamptz not null default now(),
  primary key (squad_id, station_id)
);

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  squad_id uuid not null references public.squads on delete cascade,
  station_id uuid not null references public.stations on delete cascade,
  shooter_id uuid not null references public.shooters on delete cascade,
  raised_by uuid references public.staff on delete set null,
  raised_at timestamptz not null default now(),
  note text,
  resolved_by uuid references public.staff on delete set null,
  resolved_at timestamptz,
  resolution text check (resolution in ('upheld', 'changed')),
  reason text,
  check ((resolved_at is null) = (resolution is null))
);
create index disputes_open_idx on public.disputes (event_id) where resolved_at is null;

-- Debounce bookkeeping for the build-standings Edge Function.
create table public.standings_builds (
  event_id uuid primary key references public.events on delete cascade,
  requested_at timestamptz not null default now(),
  building_since timestamptz,
  built_at timestamptz
);

-- Private settings (Edge Function URL + shared secret). Never exposed via the API.
create schema if not exists private;
create table private.settings (
  key text primary key,
  value text not null
);
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Role helpers
-- ---------------------------------------------------------------------------
create or replace function public.has_role(p_event uuid, p_roles public.staff_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff s
    where s.event_id = p_event and s.user_id = auth.uid() and s.role = any (p_roles)
  );
$$;

create or replace function public.is_staff(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(p_event, array['admin', 'referee', 'scorer']::public.staff_role[]);
$$;

create or replace function public.is_admin(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(p_event, array['admin']::public.staff_role[]);
$$;

-- The caller's staff row for an event, preferring the most privileged role.
create or replace function public.my_staff_id(p_event uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select s.id from public.staff s
  where s.event_id = p_event and s.user_id = auth.uid()
  order by case s.role when 'admin' then 1 when 'referee' then 2 else 3 end
  limit 1;
$$;

create or replace function public.is_anonymous_user()
returns boolean language sql stable as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

-- ---------------------------------------------------------------------------
-- Standings build requests
-- ---------------------------------------------------------------------------
create or replace function public.request_standings_build(p_event uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v_building timestamptz;
  v_url text;
  v_secret text;
begin
  insert into public.standings_builds (event_id, requested_at)
  values (p_event, now())
  on conflict (event_id) do update set requested_at = excluded.requested_at
  returning building_since into v_building;

  perform pg_notify('standings', p_event::text);

  -- A build already running will pick this request up before it finishes.
  if v_building is not null and v_building > now() - interval '60 seconds' then
    return;
  end if;

  select value into v_url from private.settings where key = 'standings_function_url';
  select value into v_secret from private.settings where key = 'standings_function_secret';
  if v_url is null or to_regproc('net.http_post') is null then
    return; -- local/dev without pg_net: run the function manually
  end if;

  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using v_url,
          jsonb_build_object('event_id', p_event),
          jsonb_build_object('Content-Type', 'application/json', 'x-standings-secret', coalesce(v_secret, ''));
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: create an event (the caller becomes its admin)
-- ---------------------------------------------------------------------------
create or replace function public.create_event(
  p_name text,
  p_join_code text,
  p_scorer_pin text,
  p_referee_pin text,
  p_display_name text default ''
) returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_event uuid;
begin
  if auth.uid() is null or public.is_anonymous_user() then
    raise exception 'Sign in with an organizer account to create an event.' using errcode = '42501';
  end if;
  if p_scorer_pin !~ '^[0-9]{4,8}$' or p_referee_pin !~ '^[0-9]{4,8}$' then
    raise exception 'PINs must be 4 to 8 digits.' using errcode = '22023';
  end if;
  if p_scorer_pin = p_referee_pin then
    raise exception 'The scorer and referee PINs must differ.' using errcode = '22023';
  end if;

  insert into public.events (name, join_code, scorer_pin_hash, referee_pin_hash)
  values (p_name, upper(p_join_code), crypt(p_scorer_pin, gen_salt('bf')), crypt(p_referee_pin, gen_salt('bf')))
  returning id into v_event;

  insert into public.courses (event_id) values (v_event);
  insert into public.staff (event_id, user_id, role, display_name) values (v_event, auth.uid(), 'admin', coalesce(p_display_name, ''));
  return v_event;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: volunteer joins an event with the join code + scorer or referee PIN
-- ---------------------------------------------------------------------------
create or replace function public.join_event(p_join_code text, p_pin text, p_display_name text)
returns table (event_id uuid, staff_id uuid, role public.staff_role, event_name text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_event public.events;
  v_role public.staff_role;
  v_staff uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_display_name, ''))) = 0 then
    raise exception 'Please enter your name.' using errcode = '22023';
  end if;

  select * into v_event from public.events e where e.join_code = upper(trim(p_join_code));
  if v_event.id is null then
    raise exception 'Invalid event code or PIN.' using errcode = '28000';
  end if;

  if v_event.referee_pin_hash = crypt(p_pin, v_event.referee_pin_hash) then
    v_role := 'referee';
  elsif v_event.scorer_pin_hash = crypt(p_pin, v_event.scorer_pin_hash) then
    v_role := 'scorer';
  else
    raise exception 'Invalid event code or PIN.' using errcode = '28000';
  end if;

  insert into public.staff as s (event_id, user_id, role, display_name)
  values (v_event.id, auth.uid(), v_role, trim(p_display_name))
  on conflict on constraint staff_event_id_user_id_role_key
    do update set display_name = excluded.display_name
  returning s.id into v_staff;

  return query select v_event.id, v_staff, v_role, v_event.name;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: lock a device to a station (scan the station's QR sign)
-- ---------------------------------------------------------------------------
create or replace function public.start_station_session(p_station_token text, p_device_id uuid, p_app_version text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_station public.stations;
  v_staff uuid;
begin
  select * into v_station from public.stations s where s.qr_token = p_station_token;
  if v_station.id is null then
    raise exception 'Unknown station code.' using errcode = '22023';
  end if;
  if not public.is_staff(v_station.event_id) then
    raise exception 'Join the event before scoring.' using errcode = '42501';
  end if;
  v_staff := public.my_staff_id(v_station.event_id);

  insert into public.devices (id, event_id, staff_id, station_id, app_version, last_seen)
  values (p_device_id, v_station.event_id, v_staff, v_station.id, p_app_version, now())
  on conflict (id) do update
    set staff_id = excluded.staff_id, station_id = excluded.station_id,
        app_version = excluded.app_version, last_seen = now();

  return jsonb_build_object(
    'event_id', v_station.event_id,
    'station', jsonb_build_object(
      'id', v_station.id, 'number', v_station.number, 'name', v_station.name,
      'target_count', v_station.target_count,
      'presentations', coalesce((
        select jsonb_agg(jsonb_build_object('ord', p.ord, 'kind', p.kind, 'target_count', p.target_count) order by p.ord)
        from public.presentations p where p.station_id = v_station.id), '[]'::jsonb)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: look up a squad from its card's QR code (staff only)
-- ---------------------------------------------------------------------------
create or replace function public.squad_by_token(p_squad_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_squad public.squads;
begin
  select * into v_squad from public.squads q where q.qr_token = p_squad_token;
  if v_squad.id is null or not public.is_staff(v_squad.event_id) then
    raise exception 'Unknown squad card.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'id', v_squad.id, 'number', v_squad.number, 'is_practice', v_squad.is_practice,
    'shooters', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sh.id, 'first_name', sh.first_name, 'last_name', sh.last_name,
        'is_minor', sh.is_minor, 'shoot_order', m.shoot_order) order by m.shoot_order)
      from public.squad_members m join public.shooters sh on sh.id = m.shooter_id
      where m.squad_id = v_squad.id), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: record a batch of taps from the offline queue
--   p_taps: [{id, shooter_id, station_id, squad_id, target_no, result, kind,
--             device_id, device_ts, supersedes_id?, reason?}]
--   returns: [{id, status: 'ok'|'duplicate'|'rejected', reason?}]
-- Each tap is validated and stored independently, so one bad tap never blocks the rest.
-- ---------------------------------------------------------------------------
create or replace function public.record_taps(p_taps jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t jsonb;
  out jsonb := '[]'::jsonb;
  v_id uuid;
  v_station public.stations;
  v_kind public.score_kind;
  v_squad uuid;
  v_shooter uuid;
  v_target int;
  v_staff uuid;
  v_is_ref boolean;
  v_locked boolean;
  v_super public.score_events;
  v_touched uuid[] := '{}';
begin
  if jsonb_typeof(p_taps) <> 'array' then
    raise exception 'p_taps must be a JSON array.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_taps) > 500 then
    raise exception 'Send at most 500 taps per call.' using errcode = '22023';
  end if;

  for t in select * from jsonb_array_elements(p_taps) loop
    begin
      v_locked := false;
      v_super := null;
      v_id := (t ->> 'id')::uuid;
      if exists (select 1 from public.score_events e where e.id = v_id) then
        out := out || jsonb_build_object('id', v_id, 'status', 'duplicate');
        continue;
      end if;

      v_kind := (t ->> 'kind')::public.score_kind;
      v_squad := (t ->> 'squad_id')::uuid;
      v_shooter := (t ->> 'shooter_id')::uuid;
      v_target := (t ->> 'target_no')::int;
      select * into v_station from public.stations s where s.id = (t ->> 'station_id')::uuid;
      if v_station.id is null then raise exception 'unknown station'; end if;

      if not public.is_staff(v_station.event_id) then raise exception 'not staff for this event'; end if;
      v_staff := public.my_staff_id(v_station.event_id);
      v_is_ref := public.has_role(v_station.event_id, array['admin', 'referee']::public.staff_role[]);

      if v_kind = 'paper' and not public.is_admin(v_station.event_id) then
        raise exception 'only admins enter paper scores';
      end if;
      if v_target < 1 or v_target > v_station.target_count then
        raise exception 'target % out of range 1..%', v_target, v_station.target_count;
      end if;
      if not exists (
        select 1 from public.squad_members m join public.squads q on q.id = m.squad_id
        where m.squad_id = v_squad and m.shooter_id = v_shooter and q.event_id = v_station.event_id
      ) then
        raise exception 'shooter is not in this squad';
      end if;

      if (t ->> 'supersedes_id') is not null then
        select * into v_super from public.score_events e where e.id = (t ->> 'supersedes_id')::uuid;
        if v_super.id is null
           or v_super.shooter_id <> v_shooter or v_super.station_id <> v_station.id or v_super.target_no <> v_target then
          raise exception 'supersedes a different target';
        end if;
      end if;

      if v_kind in ('official', 'paper') then
        select exists (
          select 1 from public.station_confirmations c
          where c.squad_id = v_squad and c.station_id = v_station.id  -- confirmed, disputed or resolved
        ) into v_locked;
        if v_locked and not (v_is_ref and (t ->> 'supersedes_id') is not null and length(coalesce(t ->> 'reason', '')) > 0) then
          raise exception 'station already confirmed; a referee correction with a reason is required';
        end if;
      end if;

      insert into public.score_events
        (id, event_id, shooter_id, station_id, squad_id, target_no, result, kind,
         staff_id, device_id, device_ts, supersedes_id, reason)
      values
        (v_id, v_station.event_id, v_shooter, v_station.id, v_squad, v_target,
         (t ->> 'result')::public.score_result, v_kind, v_staff,
         nullif(t ->> 'device_id', '')::uuid, coalesce((t ->> 'device_ts')::timestamptz, now()),
         (t ->> 'supersedes_id')::uuid, nullif(t ->> 'reason', ''));

      if v_kind in ('official', 'paper') and v_locked then
        v_touched := array_append(v_touched, v_station.event_id);
      end if;
      out := out || jsonb_build_object('id', v_id, 'status', 'ok');
    exception
      when unique_violation then
        out := out || jsonb_build_object('id', v_id, 'status', 'duplicate');
      when others then
        out := out || jsonb_build_object('id', t ->> 'id', 'status', 'rejected', 'reason', sqlerrm);
    end;
  end loop;

  -- Corrections to already-confirmed stations change the standings immediately.
  perform public.request_standings_build(e) from (select distinct unnest(v_touched) as e) x;

  if v_station.id is not null then
    update public.devices set last_seen = now()
    where id = nullif(p_taps -> 0 ->> 'device_id', '')::uuid;
  end if;
  return out;
end;
$$;

-- Effective official/paper score per target (latest live record wins).
create or replace view public.effective_scores
with (security_invoker = true) as
select distinct on (e.shooter_id, e.station_id, e.target_no)
  e.event_id, e.squad_id, e.shooter_id, e.station_id, e.target_no, e.result, e.id, e.server_ts
from public.score_events e
where e.kind in ('official', 'paper')
  and not exists (
    select 1 from public.score_events s
    where s.supersedes_id = e.id and s.kind in ('official', 'paper')
  )
order by e.shooter_id, e.station_id, e.target_no, e.server_ts desc, e.id desc;

-- ---------------------------------------------------------------------------
-- RPC: squad confirms a station's totals
-- ---------------------------------------------------------------------------
create or replace function public.confirm_station(p_squad_id uuid, p_station_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_station public.stations;
  v_missing int;
  v_practice boolean;
begin
  select * into v_station from public.stations s where s.id = p_station_id;
  if v_station.id is null or not public.is_staff(v_station.event_id) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select q.is_practice into v_practice from public.squads q where q.id = p_squad_id and q.event_id = v_station.event_id;
  if v_practice is null then
    raise exception 'Unknown squad.' using errcode = '22023';
  end if;
  if v_practice then
    return jsonb_build_object('status', 'practice');
  end if;

  select count(*) into v_missing
  from public.squad_members m
  cross join generate_series(1, v_station.target_count) as t(n)
  where m.squad_id = p_squad_id
    and not exists (
      select 1 from public.effective_scores es
      where es.shooter_id = m.shooter_id and es.station_id = p_station_id and es.target_no = t.n
    );
  if v_missing > 0 then
    raise exception '% target(s) still need a score before confirming.', v_missing using errcode = '22023';
  end if;

  insert into public.station_confirmations (squad_id, station_id, event_id, status, confirmed_by)
  values (p_squad_id, p_station_id, v_station.event_id, 'confirmed', public.my_staff_id(v_station.event_id))
  on conflict (squad_id, station_id) do nothing;

  perform public.request_standings_build(v_station.event_id);
  return jsonb_build_object('status', 'confirmed');
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: raise / resolve disputes
-- ---------------------------------------------------------------------------
create or replace function public.raise_dispute(p_squad_id uuid, p_station_id uuid, p_shooter_id uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_station public.stations;
  v_id uuid;
begin
  select * into v_station from public.stations s where s.id = p_station_id;
  if v_station.id is null or not public.is_staff(v_station.event_id) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.squad_members m where m.squad_id = p_squad_id and m.shooter_id = p_shooter_id) then
    raise exception 'Shooter is not in this squad.' using errcode = '22023';
  end if;

  insert into public.disputes (event_id, squad_id, station_id, shooter_id, raised_by, note)
  values (v_station.event_id, p_squad_id, p_station_id, p_shooter_id, public.my_staff_id(v_station.event_id), p_note)
  returning id into v_id;

  insert into public.station_confirmations (squad_id, station_id, event_id, status, confirmed_by)
  values (p_squad_id, p_station_id, v_station.event_id, 'disputed', public.my_staff_id(v_station.event_id))
  on conflict (squad_id, station_id) do update set status = 'disputed';

  perform public.request_standings_build(v_station.event_id);
  return v_id;
end;
$$;

create or replace function public.resolve_dispute(p_dispute_id uuid, p_resolution text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_d public.disputes;
begin
  select * into v_d from public.disputes d where d.id = p_dispute_id;
  if v_d.id is null or not public.has_role(v_d.event_id, array['admin', 'referee']::public.staff_role[]) then
    raise exception 'Only a referee can settle disputes.' using errcode = '42501';
  end if;
  if v_d.resolved_at is not null then
    raise exception 'This dispute is already settled.' using errcode = '22023';
  end if;
  if p_resolution not in ('upheld', 'changed') or length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Choose upheld or changed and give a reason.' using errcode = '22023';
  end if;

  update public.disputes
     set resolved_at = now(), resolved_by = public.my_staff_id(v_d.event_id), resolution = p_resolution, reason = trim(p_reason)
   where id = p_dispute_id;

  if not exists (
    select 1 from public.disputes d
    where d.squad_id = v_d.squad_id and d.station_id = v_d.station_id and d.resolved_at is null
  ) then
    update public.station_confirmations set status = 'resolved'
    where squad_id = v_d.squad_id and station_id = v_d.station_id;
  end if;

  perform public.request_standings_build(v_d.event_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.events enable row level security;
alter table public.courses enable row level security;
alter table public.stations enable row level security;
alter table public.presentations enable row level security;
alter table public.divisions enable row level security;
alter table public.teams enable row level security;
alter table public.shooters enable row level security;
alter table public.shooter_contacts enable row level security;
alter table public.squads enable row level security;
alter table public.squad_members enable row level security;
alter table public.staff enable row level security;
alter table public.devices enable row level security;
alter table public.score_events enable row level security;
alter table public.station_confirmations enable row level security;
alter table public.disputes enable row level security;
alter table public.standings_builds enable row level security;

-- Events: staff can read; admins can update settings (PIN hashes are never readable).
revoke select on public.events from anon, authenticated;
grant select (id, name, event_date, venue, join_code, tie_break, lewis_groups, team_best_n, adult_name_format, status, created_at)
  on public.events to authenticated;
grant update (name, event_date, venue, tie_break, lewis_groups, team_best_n, adult_name_format, status)
  on public.events to authenticated;
create policy events_staff_read on public.events for select to authenticated using (public.is_staff(id));
create policy events_admin_update on public.events for update to authenticated using (public.is_admin(id)) with check (public.is_admin(id));

-- Setup tables: staff read, admins write.
do $$
declare
  tbl text;
begin
  foreach tbl in array array['courses', 'stations', 'divisions', 'teams', 'shooters', 'squads'] loop
    execute format('create policy %1$s_staff_read on public.%1$s for select to authenticated using (public.is_staff(event_id))', tbl);
    execute format('create policy %1$s_admin_insert on public.%1$s for insert to authenticated with check (public.is_admin(event_id))', tbl);
    execute format('create policy %1$s_admin_update on public.%1$s for update to authenticated using (public.is_admin(event_id)) with check (public.is_admin(event_id))', tbl);
    execute format('create policy %1$s_admin_delete on public.%1$s for delete to authenticated using (public.is_admin(event_id))', tbl);
  end loop;
end $$;

create policy presentations_staff_read on public.presentations for select to authenticated
  using (exists (select 1 from public.stations s where s.id = station_id and public.is_staff(s.event_id)));
create policy presentations_admin_write on public.presentations for all to authenticated
  using (exists (select 1 from public.stations s where s.id = station_id and public.is_admin(s.event_id)))
  with check (exists (select 1 from public.stations s where s.id = station_id and public.is_admin(s.event_id)));

create policy squad_members_staff_read on public.squad_members for select to authenticated
  using (exists (select 1 from public.squads q where q.id = squad_id and public.is_staff(q.event_id)));
create policy squad_members_admin_write on public.squad_members for all to authenticated
  using (exists (select 1 from public.squads q where q.id = squad_id and public.is_admin(q.event_id)))
  with check (exists (select 1 from public.squads q where q.id = squad_id and public.is_admin(q.event_id)));

create policy shooter_contacts_admin on public.shooter_contacts for all to authenticated
  using (public.is_admin(event_id)) with check (public.is_admin(event_id));

-- Staff: see your own rows; admins see and manage everyone on their event.
create policy staff_self_read on public.staff for select to authenticated using (user_id = auth.uid() or public.is_admin(event_id));
create policy staff_admin_delete on public.staff for delete to authenticated using (public.is_admin(event_id));

create policy devices_staff_read on public.devices for select to authenticated using (public.has_role(event_id, array['admin', 'referee']::public.staff_role[]));

-- Scoring tables: read-only for staff; all writes go through the RPCs above.
create policy score_events_staff_read on public.score_events for select to authenticated using (public.is_staff(event_id));
create policy confirmations_staff_read on public.station_confirmations for select to authenticated using (public.is_staff(event_id));
create policy disputes_staff_read on public.disputes for select to authenticated using (public.is_staff(event_id));
create policy standings_builds_admin_read on public.standings_builds for select to authenticated using (public.is_admin(event_id));

revoke insert, update, delete on public.score_events, public.station_confirmations, public.disputes,
  public.standings_builds, public.devices from anon, authenticated;
revoke all on public.events, public.courses, public.stations, public.presentations, public.divisions,
  public.teams, public.shooters, public.shooter_contacts, public.squads, public.squad_members, public.staff,
  public.devices, public.score_events, public.station_confirmations, public.disputes, public.standings_builds
  from anon;
revoke all on public.effective_scores from anon;

-- RPC permissions
revoke execute on all functions in schema public from public, anon;
-- Internal helpers: callable only from the SECURITY DEFINER functions above.
revoke execute on function public.request_standings_build(uuid), public.is_anonymous_user() from authenticated;
grant execute on function
  public.create_event(text, text, text, text, text),
  public.join_event(text, text, text),
  public.start_station_session(text, uuid, text),
  public.squad_by_token(text),
  public.record_taps(jsonb),
  public.confirm_station(uuid, uuid),
  public.raise_dispute(uuid, uuid, uuid, text),
  public.resolve_dispute(uuid, text, text),
  public.is_staff(uuid), public.is_admin(uuid), public.has_role(uuid, public.staff_role[]), public.my_staff_id(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Storage bucket for the public standings files (Supabase only)
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('standings', 'standings', true)
    on conflict (id) do nothing;
  end if;
end $$;
