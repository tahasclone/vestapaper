import { Link } from 'react-router-dom';
import { FULL_BOARD } from '../../shared/charset';
import { SplitFlapBoard } from '../board/SplitFlapBoard';
import { useSequence } from '../board/useSequence';
import '../landing.css';

// The hero does its job, then invites you. Finite: it stops on the last frame.
const HERO_FRAMES = [
  '{yellow} DUBAI {yellow}\n26° CLEAR SKY\nHIGH 33° LOW 24°',
  '{blue} OVERHEAD NOW {blue}\nEK203 AIRBUS A380\n38,000 FT  902 KM/H',
  '{yellow}{yellow}{yellow}\nSET UP YOURS NOW\n{yellow}{yellow}{yellow}',
];

// The demo loops, because showing variety is the whole point of the section.
const DEMO_FRAMES = [
  '{green} DUBAI PRAYERS {green}\nFAJR      04:24\nDHUHR     12:19\nASR       15:42',
  '{blue} ISS RIGHT NOW {blue}\nOVER ALGERIA\n29.7°N 5.0°E\nALT 423 KM',
  '{orange} HACKER NEWS {orange}\nPOSITION: LLMS\nCANNOT JUMP',
  '{blue} WORD OF THE DAY {blue}\nMELLIFLUOUS\n(ADJECTIVE) FLOWING\nLIKE HONEY',
  '{yellow} BITCOIN {yellow}\n$104,820\n24H +1.4% {green}',
];

const SOURCES = [
  ['WEATHER', 'Open-Meteo, anywhere in the world'],
  ['FLIGHT OVERHEAD', 'The nearest aircraft, with its route'],
  ['PRAYER TIMES', 'Five daily times, next one marked'],
  ['ISS TRACKER', 'Where the station is right now'],
  ['WORD OF THE DAY', 'One word and its definition'],
  ['NEWS HEADLINES', 'Top stories from Hacker News'],
  ['CRYPTO PRICE', 'Spot price and the 24-hour move'],
  ['QUOTE OF THE DAY', 'One quote, refreshed daily'],
  ['RANDOM FACT', 'Something new on every refresh'],
];

const STEPS = [
  ['Sign in', 'One click with Google. Nothing to install, nothing to configure.'],
  ['Pick your sources', 'Choose one, or rotate through several on a timer you set.'],
  ['Point Plash at it', 'Copy your board URL into Plash and it becomes your wallpaper.'],
];

function Wordmark() {
  return (
    <span className="wm">
      SOLARIS
      <i className="wm-chip" aria-hidden />
    </span>
  );
}

export function LandingPage() {
  const heroCells = useSequence(HERO_FRAMES, { holdMs: 2600 });
  // Long hold so the board is settled and readable most of the time, rather
  // than caught mid-flip whenever someone happens to look at it.
  const demoCells = useSequence(DEMO_FRAMES, { holdMs: 6500, loop: true });

  return (
    <div className="lp">
      <header className="lp-nav">
        <Wordmark />
        <nav>
          <Link to="/login">Sign in</Link>
        </nav>
      </header>

      <section className="lp-hero">
        <h1>
          A split-flap board,
          <br />
          living on your desktop.
        </h1>
        <p className="lp-lede">
          Weather, the flight passing overhead, prayer times, a word a day. It flips when something
          changes.
        </p>
        <Link className="lp-cta" to="/login">
          Set up yours
        </Link>

        <div className="lp-hero-board">
          <SplitFlapBoard cells={heroCells} {...FULL_BOARD} maxCellH={34} />
        </div>
      </section>

      <section className="lp-demo">
        <div className="lp-demo-board">
          <SplitFlapBoard cells={demoCells} {...FULL_BOARD} maxCellH={26} />
        </div>
        <div className="lp-demo-copy">
          <h2>Nine things it can show you.</h2>
          <p>
            All of them free and keyless. Show one, or let the board rotate through the ones you
            care about.
          </p>
          <ul className="lp-sources">
            {SOURCES.map(([name, desc]) => (
              <li key={name}>
                <b>{name}</b>
                <span>{desc}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="lp-msg">
        <h2>Or write to it yourself.</h2>
        <div className="lp-msg-grid">
          <article className="lp-msg-primary">
            <h3>Telegram</h3>
            <p>
              Paste a bot token and we wire up the webhook for you. Message your bot and the board
              takes it over for a minute, then flips back to whatever it was showing.
            </p>
            <span className="lp-tag">Set up in about a minute</span>
          </article>
          <article>
            <h3>Slack</h3>
            <p>Post in a channel your bot can see.</p>
          </article>
          <article>
            <h3>Discord</h3>
            <p>
              Run <code>/board</code> anywhere your bot lives.
            </p>
          </article>
        </div>
      </section>

      <section className="lp-steps">
        {STEPS.map(([title, body]) => (
          <div key={title}>
            <h3>{title}</h3>
            <p>{body}</p>
          </div>
        ))}
      </section>

      <footer className="lp-foot">
        <Wordmark />
        <p className="lp-byline">
          a project by{' '}
          <a href="https://thirtydays.ai" target="_blank" rel="noopener noreferrer">
            thirtydays.ai
          </a>
        </p>
      </footer>
    </div>
  );
}
