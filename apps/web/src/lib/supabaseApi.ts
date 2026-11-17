import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { toDispute, toSquad, toStation, UserFacingError, type RawDispute, type RawSquad, type RawStation, type ScoringApi, type StaffSession } from './api.ts';
import type { ConfirmPayload, DisputePayload, TapPayload } from './outbox.ts';
import { TransportError, type TapResult, type Transport } from './sync.ts';

/**
 * status 0  = fetch failed (no signal)      -> retry
 * 401/408/429/5xx = session, timeout, busy  -> retry
 * other 4xx = the database refused the call -> show the message
 */
const isRetryable = (status: number) => status === 0 || status === 401 || status === 408 || status === 429 || status >= 500;

function check<T>(res: { data: T | null; error: { message: string } | null; status: number }): T {
  if (res.error) throw new TransportError(res.error.message, isRetryable(res.status));
  return res.data as T;
}

class SupabaseTransport implements Transport {
  constructor(private readonly client: SupabaseClient) {}

  async recordTaps(taps: TapPayload[]): Promise<TapResult[]> {
    return check(await this.client.rpc('record_taps', { p_taps: taps })) as TapResult[];
  }
  async confirmStation(p: ConfirmPayload): Promise<void> {
    check(await this.client.rpc('confirm_station', { p_squad_id: p.squad_id, p_station_id: p.station_id }));
  }
  async raiseDispute(p: DisputePayload): Promise<void> {
    check(
      await this.client.rpc('raise_dispute', {
        p_squad_id: p.squad_id,
        p_station_id: p.station_id,
        p_shooter_id: p.shooter_id,
        p_note: p.note || null,
      }),
    );
  }
}

export function createSupabaseApi(url: string, anonKey: string): ScoringApi {
  const client = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cs.auth' },
  });

  async function ensureSignedIn() {
    const { data } = await client.auth.getSession();
    if (data.session) return;
    const { error } = await client.auth.signInAnonymously();
    if (error) throw new UserFacingError('Could not sign in. Check your signal and try again.');
  }

  const userError = (e: { message: string } | null) => new UserFacingError(e?.message ?? 'Something went wrong.');

  return {
    mode: 'supabase',
    transport: new SupabaseTransport(client),

    async join(joinCode, pin, displayName): Promise<StaffSession> {
      await ensureSignedIn();
      const { data, error } = await client.rpc('join_event', {
        p_join_code: joinCode,
        p_pin: pin,
        p_display_name: displayName,
      });
      if (error) throw userError(error);
      const row = (data as { event_id: string; staff_id: string; role: StaffSession['role']; event_name: string }[])[0];
      if (!row) throw new UserFacingError('Could not join the event.');
      return { eventId: row.event_id, eventName: row.event_name, staffId: row.staff_id, role: row.role, displayName };
    },

    async startStation(stationToken, deviceId, appVersion) {
      const { data, error } = await client.rpc('start_station_session', {
        p_station_token: stationToken,
        p_device_id: deviceId,
        p_app_version: appVersion,
      });
      if (error) throw userError(error);
      return toStation(data as RawStation);
    },

    async squadByToken(squadToken) {
      const { data, error } = await client.rpc('squad_by_token', { p_squad_token: squadToken });
      if (error) throw userError(error);
      return toSquad(data as RawSquad);
    },

    async listDisputes(eventId) {
      const { data, error } = await client.rpc('open_disputes', { p_event: eventId });
      if (error) throw userError(error);
      if (data === null) throw new UserFacingError('Sign in with the referee PIN to see disputes.');
      return (data as RawDispute[]).map(toDispute);
    },

    async stationScores(shooterId, stationId) {
      const { data, error } = await client.rpc('shooter_station_scores', { p_shooter: shooterId, p_station: stationId });
      if (error) throw userError(error);
      return (data as { target_no: number; result: 'hit' | 'miss'; record_id: string }[]).map((r) => ({
        targetNo: r.target_no,
        result: r.result,
        recordId: r.record_id,
      }));
    },

    async resolveDispute(disputeId, resolution, reason) {
      const { error } = await client.rpc('resolve_dispute', { p_dispute_id: disputeId, p_resolution: resolution, p_reason: reason });
      if (error) throw userError(error);
    },
  };
}
