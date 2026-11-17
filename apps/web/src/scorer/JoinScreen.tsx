import { useState, type FormEvent } from 'react';

export function JoinScreen({
  demo,
  onJoin,
}: {
  demo: boolean;
  onJoin: (code: string, pin: string, name: string) => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onJoin(code, pin, name);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <span className="eyebrow">Volunteer sign-in</span>
      <h2>Join the shoot</h2>
      {demo && (
        <div className="note">
          Demo mode: event code <b>SLAYIN</b>, scorer PIN <b>1234</b>. Station codes <b>station-1</b> to <b>station-5</b>,
          squad cards <b>squad-1</b>, <b>squad-2</b>, <b>squad-3</b>, <b>squad-practice</b>.
        </div>
      )}
      <label className="field">
        <span>Event code</span>
        <input className="text" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" autoCorrect="off" required />
      </label>
      <label className="field">
        <span>PIN</span>
        <input className="text" value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" pattern="[0-9]*" required />
      </label>
      <label className="field">
        <span>Your name</span>
        <input className="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
      </label>
      <button className="btn btn-clay btn-block" disabled={busy}>
        {busy ? 'Joining…' : 'Join'}
      </button>
    </form>
  );
}
