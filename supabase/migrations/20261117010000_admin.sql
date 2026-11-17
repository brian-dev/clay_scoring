-- Admin tools: registration import, PIN changes, referee views.

-- ---------------------------------------------------------------------------
-- RPC: import registrations (all or nothing)
--   p_rows: [{first_name, last_name, is_minor, division, team, squad, shoot_order,
--             email, phone, registration_ref}]
--   division / team are names; squad is a squad number.
--   Unknown divisions are errors; missing teams and squads are created.
--   Returns {ok: true, shooters, teams_created, squads_created}
--        or {ok: false, errors: [{row, message}]} with nothing saved.
-- ---------------------------------------------------------------------------
create or replace function public.import_registrations(p_event uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  i int := 0;
  errors jsonb := '[]'::jsonb;
  v_div uuid;
  v_team uuid;
  v_squad uuid;
  v_shooter uuid;
  v_order int;
  v_shooters int := 0;
  v_teams_before int;
  v_squads_before int;
begin
  if not public.is_admin(p_event) then
    raise exception 'Only an event admin can import registrations.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Nothing to import.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Import at most 2,000 shooters at a time.' using errcode = '22023';
  end if;

  -- Pass 1: validate everything before saving anything.
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    if length(trim(coalesce(r ->> 'first_name', ''))) = 0 then
      errors := errors || jsonb_build_object('row', i, 'message', 'First name is missing.');
    end if;
    if coalesce(r ->> 'division', '') <> '' and not exists (
      select 1 from public.divisions d where d.event_id = p_event and lower(d.name) = lower(trim(r ->> 'division'))
    ) then
      errors := errors || jsonb_build_object('row', i, 'message', format('Unknown division "%s".', r ->> 'division'));
    end if;
    if coalesce(r ->> 'squad', '') <> '' and (r ->> 'squad') !~ '^[0-9]{1,4}$' then
      errors := errors || jsonb_build_object('row', i, 'message', format('Squad "%s" must be a number.', r ->> 'squad'));
    end if;
    if (case when coalesce(r ->> 'squad', '') ~ '^[0-9]{1,4}$' then exists (
      select 1 from public.squads q where q.event_id = p_event and q.number = (r ->> 'squad')::int and q.is_practice
    ) else false end) then
      errors := errors || jsonb_build_object('row', i, 'message', format('Squad %s is the practice squad.', r ->> 'squad'));
    end if;
    if coalesce(r ->> 'shoot_order', '') <> '' and (r ->> 'shoot_order') !~ '^[1-9][0-9]?$' then
      errors := errors || jsonb_build_object('row', i, 'message', 'Shooting order must be a number from 1 to 99.');
    end if;
  end loop;

  -- Duplicate shooting positions inside the file.
  errors := errors || coalesce((
    select jsonb_agg(jsonb_build_object('row', x.ord, 'message', format('Squad %s already has a shooter in position %s.', x.squad, x.pos)))
    from (
      select e.ord, e.v ->> 'squad' as squad, e.v ->> 'shoot_order' as pos,
             row_number() over (partition by e.v ->> 'squad', e.v ->> 'shoot_order' order by e.ord) as n
      from jsonb_array_elements(p_rows) with ordinality as e(v, ord)
      where coalesce(e.v ->> 'squad', '') <> '' and coalesce(e.v ->> 'shoot_order', '') <> ''
    ) x where x.n > 1), '[]'::jsonb);

  if jsonb_array_length(errors) > 0 then
    return jsonb_build_object('ok', false, 'errors', errors);
  end if;

  select count(*) into v_teams_before from public.teams where event_id = p_event;
  select count(*) into v_squads_before from public.squads where event_id = p_event;

  -- Pass 2: save.
  for r in select * from jsonb_array_elements(p_rows) loop
    v_div := null; v_team := null; v_squad := null;

    if coalesce(r ->> 'division', '') <> '' then
      select d.id into v_div from public.divisions d where d.event_id = p_event and lower(d.name) = lower(trim(r ->> 'division'));
    end if;

    if length(trim(coalesce(r ->> 'team', ''))) > 0 then
      insert into public.teams (event_id, name) values (p_event, trim(r ->> 'team'))
      on conflict (event_id, name) do nothing;
      select t.id into v_team from public.teams t where t.event_id = p_event and t.name = trim(r ->> 'team');
    end if;

    insert into public.shooters (event_id, first_name, last_name, is_minor, division_id, team_id, registration_ref)
    values (p_event, trim(r ->> 'first_name'), trim(coalesce(r ->> 'last_name', '')),
            coalesce((r ->> 'is_minor')::boolean, false), v_div, v_team, nullif(trim(coalesce(r ->> 'registration_ref', '')), ''))
    returning id into v_shooter;

    if coalesce(r ->> 'email', '') <> '' or coalesce(r ->> 'phone', '') <> '' then
      insert into public.shooter_contacts (shooter_id, event_id, email, phone)
      values (v_shooter, p_event, nullif(trim(coalesce(r ->> 'email', '')), ''), nullif(trim(coalesce(r ->> 'phone', '')), ''));
    end if;

    if coalesce(r ->> 'squad', '') <> '' then
      insert into public.squads (event_id, number) values (p_event, (r ->> 'squad')::int)
      on conflict (event_id, number) do nothing;
      select q.id into v_squad from public.squads q where q.event_id = p_event and q.number = (r ->> 'squad')::int;

      if coalesce(r ->> 'shoot_order', '') <> ''
         and not exists (select 1 from public.squad_members m where m.squad_id = v_squad and m.shoot_order = (r ->> 'shoot_order')::int) then
        v_order := (r ->> 'shoot_order')::int;
      else
        select coalesce(max(m.shoot_order), 0) + 1 into v_order from public.squad_members m where m.squad_id = v_squad;
      end if;
      insert into public.squad_members (squad_id, shooter_id, shoot_order) values (v_squad, v_shooter, v_order);
    end if;

    v_shooters := v_shooters + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'shooters', v_shooters,
    'teams_created', (select count(*) from public.teams where event_id = p_event) - v_teams_before,
    'squads_created', (select count(*) from public.squads where event_id = p_event) - v_squads_before
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: change the volunteer PINs
-- ---------------------------------------------------------------------------
create or replace function public.set_event_pins(p_event uuid, p_scorer_pin text, p_referee_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin(p_event) then
    raise exception 'Only an event admin can change PINs.' using errcode = '42501';
  end if;
  if p_scorer_pin !~ '^[0-9]{4,8}$' or p_referee_pin !~ '^[0-9]{4,8}$' then
    raise exception 'PINs must be 4 to 8 digits.' using errcode = '22023';
  end if;
  if p_scorer_pin = p_referee_pin then
    raise exception 'The scorer and referee PINs must differ.' using errcode = '22023';
  end if;
  update public.events
     set scorer_pin_hash = crypt(p_scorer_pin, gen_salt('bf')),
         referee_pin_hash = crypt(p_referee_pin, gen_salt('bf'))
   where id = p_event;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: open disputes for the referee queue
-- ---------------------------------------------------------------------------
create or replace function public.open_disputes(p_event uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.has_role(p_event, array['admin', 'referee']::public.staff_role[]) then
    null
  else coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'raised_at', d.raised_at, 'note', d.note,
      'squad_id', d.squad_id, 'squad_number', q.number,
      'station_id', d.station_id, 'station_number', st.number, 'station_name', st.name, 'target_count', st.target_count,
      'shooter_id', d.shooter_id, 'first_name', sh.first_name, 'last_name', sh.last_name, 'is_minor', sh.is_minor,
      'raised_by', coalesce(s.display_name, '')
    ) order by d.raised_at)
    from public.disputes d
    join public.squads q on q.id = d.squad_id
    join public.stations st on st.id = d.station_id
    join public.shooters sh on sh.id = d.shooter_id
    left join public.staff s on s.id = d.raised_by
    where d.event_id = p_event and d.resolved_at is null), '[]'::jsonb)
  end;
$$;

-- Effective scores for one shooter at one station (record ids let a referee supersede them).
create or replace function public.shooter_station_scores(p_shooter uuid, p_station uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_event uuid;
begin
  select event_id into v_event from public.stations where id = p_station;
  if v_event is null or not public.has_role(v_event, array['admin', 'referee']::public.staff_role[]) then
    raise exception 'Only a referee can view this.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('target_no', es.target_no, 'result', es.result, 'record_id', es.id) order by es.target_no)
    from public.effective_scores es
    where es.shooter_id = p_shooter and es.station_id = p_station), '[]'::jsonb);
end;
$$;

revoke execute on function public.import_registrations(uuid, jsonb), public.set_event_pins(uuid, text, text),
  public.open_disputes(uuid), public.shooter_station_scores(uuid, uuid) from public, anon;
grant execute on function public.import_registrations(uuid, jsonb), public.set_event_pins(uuid, text, text),
  public.open_disputes(uuid), public.shooter_station_scores(uuid, uuid) to authenticated;
