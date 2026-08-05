import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getMe,
  rotateBoardToken,
  saveConfig,
  sendMessage,
  testSource,
  type Me,
} from '../api/client';
import { SplitFlapBoard } from '../board/SplitFlapBoard';
import { formatToCells } from '../../shared/format';

type TestState = { status: 'idle' | 'busy' | 'ok' | 'err'; detail?: string };

const COINS = [
  ['bitcoin', 'BITCOIN (BTC)'],
  ['ethereum', 'ETHEREUM (ETH)'],
  ['solana', 'SOLANA (SOL)'],
  ['dogecoin', 'DOGECOIN (DOGE)'],
  ['ripple', 'XRP'],
  ['cardano', 'CARDANO (ADA)'],
] as const;

const MAIN_OPTIONS = [
  { key: 'weather', name: 'WEATHER', desc: 'Open-Meteo · current conditions, no key needed' },
  { key: 'quotes', name: 'QUOTE OF THE DAY', desc: 'ZenQuotes · one quote, refreshed daily' },
  { key: 'news', name: 'NEWS HEADLINES', desc: 'Hacker News · top stories' },
  { key: 'crypto', name: 'CRYPTO PRICE', desc: 'CoinGecko · spot price + 24h change' },
  { key: 'word', name: 'WORD OF THE DAY', desc: 'Free Dictionary · one word + definition daily' },
  { key: 'iss', name: 'ISS TRACKER', desc: 'wheretheiss.at · live position, altitude, speed' },
  { key: 'prayer', name: 'PRAYER TIMES', desc: 'Aladhan · today’s times, next prayer marked' },
  { key: 'facts', name: 'RANDOM FACT', desc: 'uselessfacts · a new fact every refresh' },
  { key: 'flights', name: 'FLIGHT OVERHEAD', desc: 'adsb.lol · nearest aircraft, route + distance' },
] as const;

const WORDMARK_SIZE = { rows: 1, cols: 12 };
const WORDMARK_CELLS = formatToCells('SOLARIS {yellow}', WORDMARK_SIZE);

/** A real one-row board instead of the old fake decorative strip. */
function Wordmark() {
  return (
    <div className="wordmark" aria-hidden>
      <SplitFlapBoard cells={WORDMARK_CELLS} {...WORDMARK_SIZE} maxCellH={26} bare />
    </div>
  );
}

export function SettingsPage() {
  const [cfg, setCfg] = useState<any>(null);
  const [board, setBoard] = useState<Me['board'] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [customText, setCustomText] = useState('');
  const [sendState, setSendState] = useState<TestState>({ status: 'idle' });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getMe()
      .then((me) => {
        setCfg(me.config);
        setBoard(me.board);
      })
      .catch((e) => setLoadError(e.message));
  }, []);

  if (loadError) {
    return (
      <div className="settings">
        <div className="settings-inner">
          <p className="subtitle">COULD NOT LOAD YOUR BOARD: {loadError.toUpperCase()}</p>
        </div>
      </div>
    );
  }

  if (!cfg || !board) {
    return (
      <div className="settings">
        <div className="settings-inner">
          <p className="subtitle">CONNECTING TO BOARD…</p>
        </div>
      </div>
    );
  }

  const patch = (fn: (draft: any) => void) => {
    const draft = structuredClone(cfg);
    fn(draft);
    setCfg(draft);
  };

  const save = async (label: string) => {
    try {
      const { config } = await saveConfig({ main: cfg.main, sound: cfg.sound });
      setCfg(config);
      setSavedFlash(label);
      setTimeout(() => setSavedFlash(null), 2200);
    } catch (e) {
      setSavedFlash(null);
      setTests((t) => ({ ...t, _save: { status: 'err', detail: (e as Error).message } }));
    }
  };

  const runTest = async (key: string) => {
    setTests((t) => ({ ...t, [key]: { status: 'busy' } }));
    try {
      const r = await testSource(key, { main: cfg.main });
      setTests((t) => ({
        ...t,
        [key]: r.ok ? { status: 'ok', detail: r.detail } : { status: 'err', detail: r.error },
      }));
    } catch (e) {
      setTests((t) => ({ ...t, [key]: { status: 'err', detail: (e as Error).message } }));
    }
  };

  const sendCustom = async () => {
    if (!customText.trim()) return;
    setSendState({ status: 'busy' });
    const r = await sendMessage(customText);
    setSendState(
      r.ok
        ? { status: 'ok', detail: 'On the board for the next 60 seconds' }
        : { status: 'err', detail: r.error },
    );
    setTimeout(() => setSendState({ status: 'idle' }), 3000);
  };

  const TestResult = ({ id }: { id: string }) => {
    const t = tests[id];
    if (!t || t.status === 'idle') return null;
    if (t.status === 'busy') return <span className="test-result">TESTING…</span>;
    return (
      <span className={`test-result ${t.status}`}>
        {t.status === 'ok' ? '✓ ' : '✕ '}
        {t.detail}
      </span>
    );
  };

  const selected = cfg.main.selected;
  const rotate: boolean = !!cfg.main.rotate;
  const rotation: string[] = cfg.main.rotationSources ?? [];
  const isActive = (key: string) => (rotate ? rotation.includes(key) : selected === key);
  const pickSource = (key: string) =>
    patch((d) => {
      if (rotate) {
        const set = new Set(d.main.rotationSources ?? []);
        set.has(key) ? set.delete(key) : set.add(key);
        d.main.rotationSources = [...set];
      } else {
        d.main.selected = key;
      }
    });

  return (
    <div className="settings">
      <div className="settings-inner">
        <Link to={`/b/${board.token}`} className="back-link">← BACK TO BOARD</Link>
        <Wordmark />
        <h1>SETTINGS</h1>
        <p className="subtitle">
          One main source feeds the board. Messages interrupt it for 60 seconds, then it flips back.
        </p>

        {/* -------------------------------------------------- board URL */}
        <div className="section">
          <div className="section-label">
            YOUR BOARD <span className="hint">point Plash at this URL</span>
          </div>
          <div className="card active">
            <div className="field">
              <label>BOARD URL</label>
              <div className="row" style={{ gap: 8 }}>
                <input readOnly value={board.boardUrl} onFocus={(e) => e.currentTarget.select()} />
                <button
                  onClick={async () => {
                    await navigator.clipboard?.writeText(board.boardUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? 'COPIED' : 'COPY'}
                </button>
              </div>
            </div>
            <p className="save-note">
              Anyone with this link can see your board, so keep it to yourself. Regenerating it
              breaks the old link, and your wallpaper stays blank until you re-point Plash.
            </p>
            <div className="actions">
              <button
                onClick={async () => {
                  if (!confirm('Generate a new board URL? The current one stops working.')) return;
                  const r = await rotateBoardToken();
                  setBoard({ ...board, token: r.token, boardUrl: r.boardUrl });
                }}
              >
                REGENERATE URL
              </button>
            </div>
          </div>
        </div>

        {/* ------------------------------------------------ main source */}
        <div className="section">
          <div className="section-label">
            MAIN SOURCE{' '}
            <span className="hint">
              {rotate ? 'rotating — pick any combination' : 'single select'}
            </span>
          </div>

          <div className={`card ${rotate ? 'active' : ''}`}>
            <div
              className="card-head"
              onClick={() => patch((d) => (d.main.rotate = !d.main.rotate))}
              role="switch"
              aria-checked={rotate}
            >
              <span className={`pip ${rotate ? 'on' : ''}`} />
              <div>
                <div className="name">ROTATE BETWEEN SOURCES</div>
                <div className="desc">
                  Cycle through the checked sources below, advancing every refresh interval
                </div>
              </div>
            </div>
          </div>

          {MAIN_OPTIONS.map((opt) => (
            <div key={opt.key} className={`card ${isActive(opt.key) ? 'active' : ''}`}>
              <div
                className="card-head"
                onClick={() => pickSource(opt.key)}
                role={rotate ? 'checkbox' : 'radio'}
                aria-checked={isActive(opt.key)}
              >
                <span className={`pip ${isActive(opt.key) ? 'on' : ''}`} />
                <div>
                  <div className="name">{opt.name}</div>
                  <div className="desc">{opt.desc}</div>
                </div>
              </div>

              {isActive(opt.key) && (
                <div className="card-body">
                  {opt.key === 'weather' && (
                    <div className="field">
                      <label>LOCATION — CITY NAME OR "LAT, LON"</label>
                      <input
                        value={cfg.main.weather.location}
                        onChange={(e) => patch((d) => (d.main.weather.location = e.target.value))}
                        placeholder="Dubai"
                      />
                    </div>
                  )}
                  {opt.key === 'crypto' && (
                    <div className="field">
                      <label>COIN</label>
                      <select
                        value={cfg.main.crypto.coin}
                        onChange={(e) => patch((d) => (d.main.crypto.coin = e.target.value))}
                      >
                        {COINS.map(([id, label]) => (
                          <option key={id} value={id}>{label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {opt.key === 'prayer' && (
                    <div className="field">
                      <label>LOCATION — CITY NAME</label>
                      <input
                        value={cfg.main.prayer?.location ?? ''}
                        onChange={(e) => patch((d) => (d.main.prayer.location = e.target.value))}
                        placeholder="Dubai"
                      />
                    </div>
                  )}
                  {opt.key === 'flights' && (
                    <div className="row">
                      <div className="field">
                        <label>LOCATION — CITY NAME OR "LAT, LON"</label>
                        <input
                          value={cfg.main.flights?.location ?? ''}
                          onChange={(e) => patch((d) => (d.main.flights.location = e.target.value))}
                          placeholder="Dubai"
                        />
                      </div>
                      <div className="actions" style={{ marginTop: 18 }}>
                        <button
                          onClick={() =>
                            navigator.geolocation?.getCurrentPosition(
                              (pos) =>
                                patch(
                                  (d) =>
                                    (d.main.flights.location = `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`),
                                ),
                              () => setTests((t) => ({
                                ...t,
                                flights: { status: 'err', detail: 'Location permission denied' },
                              })),
                            )
                          }
                        >
                          USE MY LOCATION
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="actions">
                    <button
                      onClick={() => runTest(opt.key)}
                      disabled={tests[opt.key]?.status === 'busy'}
                    >
                      TEST
                    </button>
                    <TestResult id={opt.key} />
                  </div>
                </div>
              )}
            </div>
          ))}

          <div className="card">
            <div className="row">
              <div className="field">
                <label>REFRESH INTERVAL — MINUTES</label>
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={cfg.main.refreshMinutes}
                  onChange={(e) =>
                    patch((d) => (d.main.refreshMinutes = Math.max(1, Number(e.target.value) || 5)))
                  }
                />
              </div>
              <div className="actions" style={{ marginTop: 18 }}>
                <button className="primary" onClick={() => save('main')}>
                  SAVE MAIN SOURCE
                </button>
                {savedFlash === 'main' && <span className="test-result ok">✓ SAVED — BOARD UPDATING</span>}
              </div>
            </div>
          </div>
        </div>

        {/* --------------------------------------------------- sound */}
        <div className="section">
          <div className="section-label">
            SOUND <span className="hint">mechanical flap clatter</span>
          </div>
          <div className={`card ${cfg.sound?.enabled ? 'active' : ''}`}>
            <div
              className="card-head"
              onClick={() => patch((d) => (d.sound.enabled = !d.sound.enabled))}
              role="switch"
              aria-checked={!!cfg.sound?.enabled}
            >
              <span className={`pip ${cfg.sound?.enabled ? 'on' : ''}`} />
              <div>
                <div className="name">FLIP SOUND</div>
                <div className="desc">
                  Synthesized clicks as the flaps cycle. Browsers may stay silent until the page is
                  clicked once; in Plash it plays if Plash's own mute is off.
                </div>
              </div>
            </div>
            {cfg.sound?.enabled && (
              <div className="card-body">
                <div className="row">
                  <div className="field">
                    <label>VOLUME — {Math.round((cfg.sound?.volume ?? 0.4) * 100)}%</label>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={cfg.sound?.volume ?? 0.4}
                      onChange={(e) => patch((d) => (d.sound.volume = Number(e.target.value)))}
                    />
                  </div>
                  <div className="actions" style={{ marginTop: 18 }}>
                    <button className="primary" onClick={() => save('sound')}>SAVE</button>
                    {savedFlash === 'sound' && <span className="test-result ok">✓ SAVED</span>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ------------------------------------------------- messages */}
        <div className="section">
          <div className="section-label">
            MESSAGES <span className="hint">newest message wins, shows for 60 seconds</span>
          </div>

          {/* Custom message */}
          <div className="card active">
            <div className="card-head" style={{ cursor: 'default' }}>
              <span className="pip on" />
              <div>
                <div className="name">CUSTOM MESSAGE</div>
                <div className="desc">Type anything and put it on the board for 60 seconds</div>
              </div>
            </div>
            <div className="card-body">
              <div className="field">
                <label>MESSAGE — SUPPORTS {'{RED}'} {'{ORANGE}'} {'{YELLOW}'} {'{GREEN}'} {'{BLUE}'} {'{VIOLET}'} {'{WHITE}'} COLOR CHIPS</label>
                <textarea
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  placeholder="HELLO WORLD {yellow}"
                />
              </div>
              <div className="actions">
                <button
                  className="primary"
                  onClick={sendCustom}
                  disabled={sendState.status === 'busy' || !customText.trim()}
                >
                  SEND TO BOARD
                </button>
                {sendState.status === 'ok' && <span className="test-result ok">✓ {sendState.detail}</span>}
                {sendState.status === 'err' && <span className="test-result err">✕ {sendState.detail}</span>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
