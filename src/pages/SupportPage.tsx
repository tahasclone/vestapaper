import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { AppFrame } from '../components/AppFrame';
import { submitSupport } from '../api/client';

const KINDS = [
  ['source', 'A data source you want'],
  ['feature', 'A feature idea'],
  ['bug', 'Something is broken'],
  ['other', 'Something else'],
] as const;

function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="row" style={{ gap: 8 }}>
      <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
      <button
        onClick={async () => {
          await navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? 'COPIED' : 'COPY'}
      </button>
    </div>
  );
}

export function SupportPage() {
  const { board } = useAuth();
  const [kind, setKind] = useState<string>('source');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await submitSupport({ kind, subject, body });
      setResult({ ok: true, text: r.detail ?? 'Sent' });
      setSubject('');
      setBody('');
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppFrame title="SUPPORT" subtitle="How to hang your board on the desktop, and how to reach us.">
      {/* ------------------------------------------------- Plash setup */}
      <div className="section">
        <div className="section-label">
          MAKE IT YOUR WALLPAPER <span className="hint">macOS, about two minutes</span>
        </div>

        <div className="card">
          <ol className="steps steps-lg">
            <li>
              Install <b>Plash</b> from the Mac App Store. It is free, and its whole job is putting a
              web page behind your icons.
            </li>
            <li>
              Copy your board URL:
              {board && <CopyRow value={board.boardUrl} />}
              This link is what makes the board yours, so keep it private. You can regenerate it in
              Settings if it ever leaks.
            </li>
            <li>
              Click the <b>Plash icon</b> in your menu bar, choose <b>Add Website</b>, paste the URL,
              and press Add. Your desktop changes immediately.
            </li>
            <li>
              Paste the same URL on any other Mac to get the same board there. No sign-in needed on
              those machines, and they all stay in step within about ten seconds.
            </li>
          </ol>
        </div>

        <div className="section-label" style={{ marginTop: 30 }}>
          WORTH KNOWING <span className="hint">a few Plash quirks</span>
        </div>

        <div className="card">
          <ul className="notes">
            <li>
              <b>To click anything on the board</b>, turn on <b>Browsing Mode</b> in the Plash menu.
              Without it your clicks go to the desktop, which is usually what you want.
            </li>
            <li>
              <b>The flip sound will not play as a wallpaper.</b> Plash mutes audio system wide and
              offers no per-site exception, so the sound setting only applies when you open the board
              in a normal browser tab.
            </li>
            <li>
              <b>Check Plash's battery setting.</b> It can deactivate itself on battery power, which
              looks like the board freezing. It is in Plash's preferences.
            </li>
            <li>
              <b>Set Plash's reload interval to something long</b>, say six hours. The board keeps
              itself fresh on its own, but a periodic reload is a harmless safety net after your Mac
              sleeps for a long time.
            </li>
            <li>
              <b>Multiple monitors</b> are supported by Plash directly, and it can show a different
              website per display.
            </li>
          </ul>
        </div>
      </div>

      {/* ---------------------------------------------------- feedback */}
      <div className="section">
        <div className="section-label">
          ASK FOR SOMETHING <span className="hint">it reaches a person</span>
        </div>

        <div className="card active">
          <div className="field">
            <label>WHAT IS THIS ABOUT?</label>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>
              {kind === 'source' ? 'WHICH SOURCE, IN A FEW WORDS' : 'SUBJECT'}
            </label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={
                kind === 'source'
                  ? 'Train departures from my station'
                  : kind === 'bug'
                    ? 'The board stops flipping after a while'
                    : 'Short summary'
              }
            />
          </div>

          <div className="field">
            <label>
              {kind === 'source'
                ? 'ANYTHING THAT HELPS — A LINK TO THE API, WHAT YOU WANT ON THE BOARD'
                : 'DETAILS'}
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              placeholder={
                kind === 'source'
                  ? 'Which service, and what the board should show. A link to the API docs helps a lot.'
                  : 'What happened, and what you expected instead.'
              }
            />
          </div>

          <p className="save-note">
            We will see the email address on your account, so there is nothing else to fill in. Three
            messages a day, to keep the inbox usable.
          </p>

          <div className="actions">
            <button
              className="primary"
              onClick={send}
              disabled={busy || subject.trim().length < 3 || body.trim().length < 10}
            >
              {busy ? 'SENDING…' : 'SEND'}
            </button>
            {result && (
              <span className={`test-result ${result.ok ? 'ok' : 'err'}`}>
                {result.ok ? '✓ ' : '✕ '}
                {result.text}
              </span>
            )}
          </div>
        </div>
      </div>
    </AppFrame>
  );
}
