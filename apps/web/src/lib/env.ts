import type { ScoringApi } from './api.ts';
import { createDemoApi } from './demoApi.ts';
import { createSupabaseApi } from './supabaseApi.ts';

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';
/** Event whose standings the public boards show. */
export const PUBLIC_EVENT_ID = (import.meta.env.VITE_PUBLIC_EVENT_ID as string | undefined) ?? '';
export const APP_VERSION = '0.1.0';

export const isDemo = !SUPABASE_URL || !SUPABASE_ANON_KEY;

let api: ScoringApi | null = null;
export function getApi(): ScoringApi {
  api ??= isDemo ? createDemoApi() : createSupabaseApi(SUPABASE_URL, SUPABASE_ANON_KEY);
  return api;
}

/** Public URL of a cached standings file in the `standings` Storage bucket. */
export function standingsUrl(path: string): string | null {
  if (isDemo || !PUBLIC_EVENT_ID) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/standings/${PUBLIC_EVENT_ID}/${path}`;
}
