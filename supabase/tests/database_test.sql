-- Database tests: security rules, RPC validation, idempotency, locking, disputes.
-- Run with supabase/tests/run.sh. Any failed assertion stops the run with an error.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.login(p_uid uuid, p_anon boolean default false) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'is_anonymous', p_anon)::text, false);
end $$;

create function tests.assert(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'ASSERTION FAILED: %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;

create function tests.expect_error(p_sql text, p_pattern text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'ASSERTION FAILED: expected error matching "%" from: %', p_pattern, p_sql;
exception when others then
  if sqlerrm like 'ASSERTION FAILED%' then raise; end if;
  if sqlerrm !~* p_pattern then
    raise exception 'ASSERTION FAILED: expected error matching "%", got "%"', p_pattern, sqlerrm;
  end if;
  raise notice 'ok - rejected: %', p_pattern;
end $$;

create function tests.statuses(p_res jsonb) returns text language sql as $$
  select string_agg(e ->> 'status', ',' order by ord) from jsonb_array_elements(p_res) with ordinality as x(e, ord);
$$;

create function tests.tap(p_shooter text, p_station text, p_squad text, p_target int, p_result text,
                          p_kind text default 'official', p_supersedes uuid default null, p_reason text default null)
returns jsonb language sql volatile as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', gen_random_uuid(), 'shooter_id', p_shooter, 'station_id', p_station, 'squad_id', p_squad,
    'target_no', p_target, 'result', p_result, 'kind', p_kind,
    'device_id', 'cccccccc-0000-4000-8000-000000000001', 'device_ts', now(),
    'supersedes_id', p_supersedes, 'reason', p_reason));
$$;

grant execute on all functions in schema tests to anon, authenticated;

-- Fixed ids from seed.sql
\set ev '''00000000-0000-4000-8000-000000000001'''
\set st1 '''00000000-0000-4000-8000-0000000005a1'''
\set st2 '''00000000-0000-4000-8000-0000000005a2'''
\set sq1 '''00000000-0000-4000-8000-0000000000a1'''
\set sqp '''00000000-0000-4000-8000-0000000000a9'''
\set ray '''00000000-0000-4000-8000-000000000101'''
\set kaden '''00000000-0000-4000-8000-000000000102'''
\set jace '''00000000-0000-4000-8000-000000000105'''

\echo '--- organizers and events'
select tests.login('aaaaaaaa-0000-4000-8000-000000000001', true);
set role authenticated;
select tests.expect_error($$select public.create_event('X', 'ABCD', '1111', '2222')$$, 'organizer account');
reset role;

select tests.login('aaaaaaaa-0000-4000-8000-0000000000ad', false);
set role authenticated;
do $$
declare v uuid;
begin
  v := public.create_event('Test Shoot', 'test01', '1111', '2222', 'Organizer');
  perform tests.assert(public.is_admin(v), 'event creator becomes its admin');
  perform tests.assert((select join_code from public.events where id = v) = 'TEST01', 'join code is upper-cased');
  -- admin can add a station; the QR token default works for API inserts
  insert into public.stations (event_id, course_id, number, name, target_count)
  select v, c.id, 1, 'Other station', 6 from public.courses c where c.event_id = v;
  perform tests.assert((select length(qr_token) from public.stations where event_id = v) >= 8, 'station gets a QR token');
end $$;
select tests.expect_error($$select public.create_event('Bad', 'BAD1', '1111', '1111')$$, 'must differ');
select tests.expect_error($$select public.create_event('Bad', 'BAD2', '12', '3456')$$, '4 to 8 digits');
select tests.expect_error(
  $$insert into public.stations (event_id, course_id, number, target_count) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c1', 9, 8)$$,
  'row-level security');
reset role;

\echo '--- volunteers join with the event code and PIN'
select tests.login('bbbbbbbb-0000-4000-8000-000000000001', true);  -- scorer (anonymous sign-in)
set role authenticated;
select tests.expect_error($$select * from public.join_event('SLAYIN', '0000', 'Pat')$$, 'Invalid event code or PIN');
select tests.expect_error($$select * from public.join_event('NOPE', '1234', 'Pat')$$, 'Invalid event code or PIN');
select tests.expect_error($$select * from public.join_event('SLAYIN', '1234', '  ')$$, 'enter your name');
do $$
declare r record;
begin
  select * into r from public.join_event(' slayin ', '1234', 'Pat');
  perform tests.assert(r.role = 'scorer', 'scorer PIN gives the scorer role');
  select * into r from public.join_event('SLAYIN', '1234', 'Pat S.');
  perform tests.assert((select count(*) from public.staff where user_id = auth.uid()) = 1, 'joining twice keeps one staff row');
end $$;

\echo '--- what a scorer can and cannot see'
select tests.expect_error($$select scorer_pin_hash from public.events$$, 'permission denied');
select tests.assert((select count(*) from public.events) = 1, 'scorer sees only their own event');
select tests.assert((select count(*) from public.shooters) = 12, 'scorer can read shooter names for their event');
select tests.assert((select count(*) from public.shooter_contacts) = 0, 'scorer cannot read contact details');
select tests.expect_error(
  $$insert into public.score_events (id, event_id, shooter_id, station_id, squad_id, target_no, result, kind, device_ts)
    values (gen_random_uuid(), '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101',
            '00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000000a1', 1, 'hit', 'official', now())$$,
  'permission denied');
select tests.expect_error($$select public.request_standings_build('00000000-0000-4000-8000-000000000001')$$, 'permission denied');

\echo '--- station session and squad lookup'
do $$
declare j jsonb;
begin
  j := public.start_station_session('station-1', 'cccccccc-0000-4000-8000-000000000001', 'test-1.0');
  perform tests.assert((j -> 'station' ->> 'target_count')::int = 8, 'station session returns target count');
  perform tests.assert(jsonb_array_length(j -> 'station' -> 'presentations') = 4, 'station session returns presentations');
  j := public.squad_by_token('squad-1');
  perform tests.assert(jsonb_array_length(j -> 'shooters') = 4, 'squad card returns the roster in order');
  perform tests.assert((j -> 'shooters' -> 0 ->> 'first_name') = 'Ray', 'first shooter in shooting order');
end $$;
select tests.expect_error($$select public.start_station_session('nope', gen_random_uuid())$$, 'Unknown station');
select tests.expect_error(
  $$select public.start_station_session((select qr_token from public.stations where name = 'Other station'), gen_random_uuid())$$,
  'Unknown station');  -- other event's station is invisible to this scorer
select tests.expect_error($$select public.squad_by_token('nope')$$, 'Unknown squad');

\echo '--- recording taps'
select tests.expect_error(
  $$select public.confirm_station('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000005a1')$$,
  'still need a score');

create temp table batch as
select tests.tap(sh::text, '00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000000a1', n,
                 case when n = 3 then 'miss' else 'hit' end) as tap
from unnest(array['00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102',
                  '00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000104']::uuid[]) as sh,
     generate_series(1, 8) as n;

do $$
declare res jsonb; taps jsonb;
begin
  select jsonb_agg(tap) into taps from batch;
  res := public.record_taps(taps);
  perform tests.assert(tests.statuses(res) = repeat('ok,', 31) || 'ok', '32 taps stored');
  res := public.record_taps(taps);
  perform tests.assert(tests.statuses(res) = repeat('duplicate,', 31) || 'duplicate', 're-sending the same batch stores nothing new');
end $$;

do $$
declare res jsonb;
begin
  res := public.record_taps(jsonb_build_array(
    tests.tap('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-0000000005a2', '00000000-0000-4000-8000-0000000000a1', 9, 'hit'),
    tests.tap('00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-0000000005a2', '00000000-0000-4000-8000-0000000000a1', 1, 'hit'),
    tests.tap('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-0000000005a2', '00000000-0000-4000-8000-0000000000a1', 1, 'hit', 'paper'),
    tests.tap('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-0000000005a2', '00000000-0000-4000-8000-0000000000a1', 1, 'hit')
  ));
  perform tests.assert(tests.statuses(res) = 'rejected,rejected,rejected,ok', 'bad taps rejected one by one, good tap kept');
  perform tests.assert(res -> 0 ->> 'reason' like '%out of range%', 'target out of range explained');
  perform tests.assert(res -> 1 ->> 'reason' like '%not in this squad%', 'wrong squad explained');
  perform tests.assert(res -> 2 ->> 'reason' like '%paper%', 'only admins enter paper scores');
end $$;

\echo '--- confirming a station locks it'
select tests.assert(
  (public.confirm_station('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000005a1') ->> 'status') = 'confirmed',
  'complete station confirms');
select tests.assert((select status::text from public.station_confirmations) = 'confirmed', 'confirmation recorded');

do $$
declare res jsonb; miss_id uuid;
begin
  select id into miss_id from public.score_events
  where shooter_id = '00000000-0000-4000-8000-000000000101' and station_id = '00000000-0000-4000-8000-0000000005a1' and target_no = 3;
  res := public.record_taps(jsonb_build_array(
    tests.tap('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000000a1', 3, 'hit', 'official', miss_id, 'I think it broke')));
  perform tests.assert(tests.statuses(res) = 'rejected', 'scorer cannot change a confirmed station');
end $$;

\echo '--- disputes'
do $$
declare d uuid;
begin
  d := public.raise_dispute('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000005a1',
                            '00000000-0000-4000-8000-000000000101', 'Squad says target 3 broke');
  perform tests.assert((select status::text from public.station_confirmations) = 'disputed', 'dispute marks the station disputed');
  perform tests.expect_error(format($f$select public.resolve_dispute(%L, 'changed', 'nah')$f$, d), 'Only a referee');
  perform set_config('tests.dispute', d::text, false);
end $$;
reset role;

select tests.login('dddddddd-0000-4000-8000-000000000001', true);  -- referee
set role authenticated;
do $$
declare r record; res jsonb; miss_id uuid; d uuid := current_setting('tests.dispute')::uuid;
begin
  select * into r from public.join_event('SLAYIN', '5678', 'Ref Jo');
  perform tests.assert(r.role = 'referee', 'referee PIN gives the referee role');

  select id into miss_id from public.score_events
  where shooter_id = '00000000-0000-4000-8000-000000000101' and station_id = '00000000-0000-4000-8000-0000000005a1' and target_no = 3;
  res := public.record_taps(jsonb_build_array(
    tests.tap('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000000a1', 3, 'hit', 'official', miss_id)));
  perform tests.assert(tests.statuses(res) = 'rejected', 'referee correction needs a reason');

  res := public.record_taps(jsonb_build_array(
    tests.tap('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000000a1', 3, 'hit', 'official', miss_id, 'Visible piece')));
  perform tests.assert(tests.statuses(res) = 'ok', 'referee correction with a reason is accepted');
  perform tests.assert(
    (select result::text from public.effective_scores
     where shooter_id = '00000000-0000-4000-8000-000000000101' and station_id = '00000000-0000-4000-8000-0000000005a1' and target_no = 3) = 'hit',
    'effective score reflects the correction');
  perform tests.assert((select count(*) from public.score_events
     where shooter_id = '00000000-0000-4000-8000-000000000101' and station_id = '00000000-0000-4000-8000-0000000005a1' and target_no = 3) = 2,
    'original record is kept (append-only)');

  perform tests.expect_error(format($f$select public.resolve_dispute(%L, 'changed', '  ')$f$, d), 'give a reason');
  perform public.resolve_dispute(d, 'changed', 'Visible piece confirmed by referee');
  perform tests.assert((select status::text from public.station_confirmations) = 'resolved', 'settling the last dispute resolves the station');
  perform tests.expect_error(format($f$select public.resolve_dispute(%L, 'upheld', 'again')$f$, d), 'already settled');
end $$;

\echo '--- practice squad'
do $$
declare res jsonb;
begin
  res := public.record_taps(jsonb_build_array(
    tests.tap('00000000-0000-4000-8000-000000000111', '00000000-0000-4000-8000-0000000005a2', '00000000-0000-4000-8000-0000000000a9', 1, 'hit', 'practice')));
  perform tests.assert(tests.statuses(res) = 'ok', 'practice taps are accepted');
  perform tests.assert(
    (public.confirm_station('00000000-0000-4000-8000-0000000000a9', '00000000-0000-4000-8000-0000000005a2') ->> 'status') = 'practice',
    'practice squad confirm is a no-op');
  perform tests.assert(not exists (select 1 from public.effective_scores where squad_id = '00000000-0000-4000-8000-0000000000a9'),
    'practice taps never count');
end $$;
reset role;

\echo '--- signed-out visitors see nothing'
set role anon;
select tests.expect_error($$select * from public.shooters$$, 'permission denied');
select tests.expect_error($$select * from public.score_events$$, 'permission denied');
select tests.expect_error($$select public.record_taps('[]'::jsonb)$$, 'permission denied');
reset role;

\echo '--- standings build requests'
select tests.assert((select count(*) from public.standings_builds where event_id = :ev) = 1, 'confirm/dispute/correction requested a standings build');
select tests.assert((select last_seen > now() - interval '1 minute' from public.devices where id = 'cccccccc-0000-4000-8000-000000000001'), 'device check-in recorded');

\echo 'ALL DATABASE TESTS PASSED'
