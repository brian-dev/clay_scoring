import { useEffect, useRef, useState, type FormEvent } from 'react';
import { parseCode } from '../lib/qr.ts';

/**
 * Camera QR scanner with a typed-code fallback (no camera, permission denied, glare).
 * Uses qr-scanner, which works in iOS Safari standalone mode via a JS decoder.
 */
export function QrScan({
  kind,
  prompt,
  onCode,
  busy,
}: {
  kind: 'station' | 'squad';
  prompt: string;
  onCode: (token: string) => void;
  busy?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState<string | null>(null);
  const handled = useRef(false);

  useEffect(() => {
    let scanner: { start(): Promise<void>; stop(): void; destroy(): void } | null = null;
    let cancelled = false;
    handled.current = false;
    (async () => {
      try {
        const { default: QrScanner } = await import('qr-scanner');
        if (cancelled || !videoRef.current) return;
        scanner = new QrScanner(
          videoRef.current,
          (res: { data: string }) => {
            if (handled.current) return;
            const token = parseCode(res.data, kind);
            if (token) {
              handled.current = true;
              onCode(token);
            }
          },
          { preferredCamera: 'environment', highlightScanRegion: false, maxScansPerSecond: 8 },
        );
        await scanner.start();
      } catch {
        if (!cancelled) setCameraError('Camera unavailable. Type the code printed under the QR code instead.');
      }
    })();
    return () => {
      cancelled = true;
      scanner?.stop();
      scanner?.destroy();
    };
  }, [kind, onCode]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const token = parseCode(typed, kind);
    if (!token) {
      setTypedError('That code does not look right.');
      return;
    }
    setTypedError(null);
    onCode(token);
  };

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{prompt}</p>
      {cameraError ? (
        <div className="note">{cameraError}</div>
      ) : (
        <div className="scanner">
          <video ref={videoRef} muted playsInline />
          <div className="frame" />
        </div>
      )}
      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span>Or type the code</span>
          <input
            className="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={kind === 'station' ? 'station-1' : 'squad-1'}
            autoCapitalize="none"
            autoCorrect="off"
          />
        </label>
        {typedError && <div className="error">{typedError}</div>}
        <button className="btn btn-ink" disabled={busy || !typed.trim()}>Continue</button>
      </form>
    </div>
  );
}
