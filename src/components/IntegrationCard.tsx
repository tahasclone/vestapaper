import { useState, type ReactNode } from 'react';
import { deleteIntegration, saveIntegration, type Integration } from '../api/client';

export interface FieldSpec {
  name: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
}

interface Props {
  kind: 'telegram' | 'slack' | 'discord';
  title: string;
  blurb: string;
  fields: FieldSpec[];
  steps: ReactNode[];
  integration?: Integration;
  onChanged: () => void;
  /** Rendered under the steps, e.g. a caveat specific to this provider. */
  note?: ReactNode;
}

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

export function IntegrationCard({
  kind,
  title,
  blurb,
  fields,
  steps,
  integration,
  onChanged,
  note,
}: Props) {
  const configured = !!integration?.configured;
  const [open, setOpen] = useState(configured);
  const [showSteps, setShowSteps] = useState(!configured);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await saveIntegration(kind, values);
      setResult({ ok: true, text: r.detail ?? 'Saved' });
      setValues({});
      onChanged();
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!confirm(`Disconnect ${title}?`)) return;
    setBusy(true);
    try {
      await deleteIntegration(kind);
      setResult(null);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = () => {
    if (!integration || !configured) return null;
    if (integration.status === 'ok') return <span className="test-result ok">✓ CONNECTED</span>;
    if (integration.status === 'pending')
      return <span className="test-result">WAITING FOR FIRST MESSAGE</span>;
    if (integration.status === 'error')
      return <span className="test-result err">✕ {integration.statusDetail}</span>;
    return null;
  };

  return (
    <div className={`card ${configured ? 'active' : ''}`}>
      <div className="card-head" onClick={() => setOpen(!open)}>
        <span className={`pip ${configured ? 'on' : ''}`} />
        <div>
          <div className="name">{title}</div>
          <div className="desc">{blurb}</div>
        </div>
        <span className="spacer" />
        {statusLabel()}
      </div>

      {open && (
        <div className="card-body">
          {integration?.webhookUrl && (
            <div className="field">
              <label>
                {kind === 'telegram'
                  ? 'YOUR WEBHOOK URL — WE REGISTER THIS FOR YOU, NOTHING TO PASTE'
                  : kind === 'slack'
                    ? 'REQUEST URL — PASTE THIS INTO SLACK'
                    : 'INTERACTIONS ENDPOINT URL — PASTE THIS INTO DISCORD'}
              </label>
              <CopyRow value={integration.webhookUrl} />
            </div>
          )}

          <button className="linkish" onClick={() => setShowSteps(!showSteps)}>
            {showSteps ? 'HIDE SETUP STEPS' : 'SHOW SETUP STEPS'}
          </button>

          {showSteps && (
            <ol className="steps">
              {steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          )}

          {note && <p className="save-note">{note}</p>}

          {fields.map((f) => (
            <div className="field" key={f.name}>
              <label>
                {f.label}
                {configured && ' — LEAVE BLANK TO KEEP THE SAVED VALUE'}
              </label>
              <input
                type={f.secret ? 'password' : 'text'}
                autoComplete="off"
                placeholder={f.placeholder}
                value={values[f.name] ?? ''}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              />
            </div>
          ))}

          <div className="actions">
            <button className="primary" onClick={save} disabled={busy}>
              {busy ? 'SAVING…' : configured ? 'UPDATE' : 'CONNECT'}
            </button>
            {configured && (
              <button onClick={disconnect} disabled={busy}>
                DISCONNECT
              </button>
            )}
            {result && (
              <span className={`test-result ${result.ok ? 'ok' : 'err'}`}>
                {result.ok ? '✓ ' : '✕ '}
                {result.text}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
