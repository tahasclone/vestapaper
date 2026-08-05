import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { COLOR_HEX } from '../../shared/charset';

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

async function api(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

function MiniBoard() {
  const word = 'SPLITFLAP'.split('');
  return (
    <div className="mini-board" aria-hidden>
      {word.map((c, i) => (
        <span key={i} className="mini-cell">{c}</span>
      ))}
      <span className="mini-cell chip-cell">
        <i style={{ background: COLOR_HEX['{yellow}'] }} />
      </span>
    </div>
  );
}

export function SettingsPage() {
  const [cfg, setCfg] = useState<any>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [customText, setCustomText] = useState('');
  const [sendState, setSendState] = useState<TestState>({ status: 'idle' });

  useEffect(() => {
    api('/api/config').then(setCfg).catch(() => {});
  }, []);

  if (!cfg) {
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
    const fresh = await api('/api/config', cfg);
    setCfg(fresh);
    setSavedFlash(label);
    setTimeout(() => setSavedFlash(null), 2200);
  };

  const runTest = async (key: string, extra: Record<string, unknown> = {}) => {
    setTests((t) => ({ ...t, [key]: { status: 'busy' } }));
    try {
      const r = await api(`/api/test/${key}`, { messages: cfg.messages, ...extra });
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
    const r = await api('/api/message', { text: customText });
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
        <Link to="/" className="back-link">← BACK TO BOARD</Link>
        <MiniBoard />
        <h1>SETTINGS</h1>
        <p className="subtitle">
          One main source feeds the board. Messages interrupt it for 60 seconds, then it flips back.
        </p>

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
                      onClick={() =>
                        runTest(opt.key, {
                          location: cfg.main.weather.location,
                          coin: cfg.main.crypto.coin,
                          prayerLocation: cfg.main.prayer?.location,
                          flightsLocation: cfg.main.flights?.location,
                        })
                      }
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

        {/* ------------------------------------------------- messages */}
        <div className="section">
          <div className="section-label">
            MESSAGE INTEGRATIONS <span className="hint">any combination · newest message wins</span>
          </div>

          {/* Telegram */}
          <div className={`card ${cfg.messages.telegram.enabled ? 'active' : ''}`}>
            <div
              className="card-head"
              onClick={() => patch((d) => (d.messages.telegram.enabled = !d.messages.telegram.enabled))}
            >
              <span className={`pip ${cfg.messages.telegram.enabled ? 'on' : ''}`} />
              <div>
                <div className="name">TELEGRAM BOT</div>
                <div className="desc">Long-polling — works locally, no public URL needed</div>
              </div>
            </div>
            {cfg.messages.telegram.enabled && (
              <div className="card-body">
                <div className="field">
                  <label>BOT TOKEN — FROM @BOTFATHER</label>
                  <input
                    type="password"
                    value={cfg.messages.telegram.botToken}
                    onChange={(e) => patch((d) => (d.messages.telegram.botToken = e.target.value))}
                    placeholder="123456:ABC-DEF…"
                    autoComplete="off"
                  />
                </div>
                <div className="actions">
                  <button onClick={() => runTest('telegram')} disabled={tests.telegram?.status === 'busy'}>
                    TEST CONNECTION
                  </button>
                  <button className="primary" onClick={() => save('telegram')}>SAVE</button>
                  {savedFlash === 'telegram' && <span className="test-result ok">✓ SAVED</span>}
                  <TestResult id="telegram" />
                </div>
              </div>
            )}
          </div>

          {/* Discord */}
          <div className={`card ${cfg.messages.discord.enabled ? 'active' : ''}`}>
            <div
              className="card-head"
              onClick={() => patch((d) => (d.messages.discord.enabled = !d.messages.discord.enabled))}
            >
              <span className={`pip ${cfg.messages.discord.enabled ? 'on' : ''}`} />
              <div>
                <div className="name">DISCORD BOT</div>
                <div className="desc">Gateway connection — listens to one channel</div>
              </div>
            </div>
            {cfg.messages.discord.enabled && (
              <div className="card-body">
                <div className="row">
                  <div className="field">
                    <label>BOT TOKEN</label>
                    <input
                      type="password"
                      value={cfg.messages.discord.botToken}
                      onChange={(e) => patch((d) => (d.messages.discord.botToken = e.target.value))}
                      autoComplete="off"
                    />
                  </div>
                  <div className="field">
                    <label>CHANNEL ID</label>
                    <input
                      value={cfg.messages.discord.channelId}
                      onChange={(e) => patch((d) => (d.messages.discord.channelId = e.target.value))}
                      placeholder="e.g. 1180000000000000000"
                    />
                  </div>
                </div>
                <p className="save-note">
                  Enable MESSAGE CONTENT INTENT for the bot in the Discord developer portal.
                </p>
                <div className="actions">
                  <button onClick={() => runTest('discord')} disabled={tests.discord?.status === 'busy'}>
                    TEST CONNECTION
                  </button>
                  <button className="primary" onClick={() => save('discord')}>SAVE</button>
                  {savedFlash === 'discord' && <span className="test-result ok">✓ SAVED</span>}
                  <TestResult id="discord" />
                </div>
              </div>
            )}
          </div>

          {/* Slack */}
          <div className={`card ${cfg.messages.slack.enabled ? 'active' : ''}`}>
            <div
              className="card-head"
              onClick={() => patch((d) => (d.messages.slack.enabled = !d.messages.slack.enabled))}
            >
              <span className={`pip ${cfg.messages.slack.enabled ? 'on' : ''}`} />
              <div>
                <div className="name">SLACK</div>
                <div className="desc">Socket Mode — inbound messages without a public URL</div>
              </div>
            </div>
            {cfg.messages.slack.enabled && (
              <div className="card-body">
                <div className="row">
                  <div className="field">
                    <label>BOT TOKEN (XOXB-…)</label>
                    <input
                      type="password"
                      value={cfg.messages.slack.botToken}
                      onChange={(e) => patch((d) => (d.messages.slack.botToken = e.target.value))}
                      autoComplete="off"
                    />
                  </div>
                  <div className="field">
                    <label>APP-LEVEL TOKEN (XAPP-…)</label>
                    <input
                      type="password"
                      value={cfg.messages.slack.appToken}
                      onChange={(e) => patch((d) => (d.messages.slack.appToken = e.target.value))}
                      autoComplete="off"
                    />
                  </div>
                </div>
                <p className="save-note">
                  Enable Socket Mode + the connections:write scope on the app-level token, and
                  subscribe the bot to message events.
                </p>
                <div className="actions">
                  <button onClick={() => runTest('slack')} disabled={tests.slack?.status === 'busy'}>
                    TEST CONNECTION
                  </button>
                  <button className="primary" onClick={() => save('slack')}>SAVE</button>
                  {savedFlash === 'slack' && <span className="test-result ok">✓ SAVED</span>}
                  <TestResult id="slack" />
                </div>
              </div>
            )}
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
