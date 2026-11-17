/**
 * QR codes are URLs so a phone camera opens the right page:
 *   station sign: https://<site>/score?station=<token>
 *   squad card:   https://<site>/me/<token>   (shooters see their scorecard; scorers' app reads the token)
 * Scanning inside the app, or typing a code, also accepts the bare token.
 */
export function parseCode(raw: string, kind: 'station' | 'squad'): string | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (kind === 'station') return url.searchParams.get('station');
    const m = url.pathname.match(/\/me\/([^/]+)\/?$/);
    return m ? decodeURIComponent(m[1]!) : url.searchParams.get('squad');
  } catch {
    return /^[A-Za-z0-9_-]{3,64}$/.test(text) ? text : null;
  }
}

export const stationQrUrl = (origin: string, token: string) => `${origin}/score?station=${encodeURIComponent(token)}`;
export const squadQrUrl = (origin: string, token: string) => `${origin}/me/${encodeURIComponent(token)}`;
