import { useEffect, useState } from 'react';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * iPhones never prompt to install a web app, and Safari storage is separate from the
 * home-screen app, so volunteers must add it to the home screen BEFORE signing in.
 * Android gets the browser's own install prompt.
 */
export function InstallBanner() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [standalone] = useState(isStandalone);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (standalone) return null;

  if (isIOS()) {
    return (
      <div className="install">
        <b>First, add this app to your Home Screen.</b>
        <ol>
          <li>Tap the Share button in Safari.</li>
          <li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li>
          <li>Open Clay Scoring from your Home Screen and sign in there.</li>
        </ol>
      </div>
    );
  }

  if (prompt) {
    return (
      <div className="install">
        <b>Install the scoring app</b> so it works without signal.{' '}
        <button className="btn btn-clay btn-sm" onClick={() => void prompt.prompt().then(() => setPrompt(null))}>
          Install
        </button>
      </div>
    );
  }
  return null;
}
