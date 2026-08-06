import { useEffect } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SplitFlapBoard } from '../board/SplitFlapBoard';
import { formatToCells } from '../../shared/format';
import '../landing.css';

const CELLS = formatToCells('{yellow} SIGN IN {yellow}', { rows: 1, cols: 18 });

export function LoginPage() {
  const { status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const failed = params.get('error') === '1';

  const from = (location.state as { from?: string } | null)?.from ?? '/app';

  // Already signed in (e.g. came back to /login by hand): go straight through.
  useEffect(() => {
    if (status === 'authed') navigate(from, { replace: true });
  }, [status, from, navigate]);

  return (
    <div className="lp">
      <header className="lp-nav">
        <Link to="/" className="wm" style={{ textDecoration: 'none' }}>
          SOLARIS
          <i className="wm-chip" aria-hidden />
        </Link>
      </header>

      <section className="login-panel">
        <div className="login-board" aria-hidden>
          <SplitFlapBoard cells={CELLS} rows={1} cols={18} maxCellH={30} bare />
        </div>
        <h1>Your board is one click away.</h1>
        <p className="lp-lede">
          We use your Google account so there is no password to forget. We read your email address
          and name, nothing else.
        </p>

        {failed && (
          <p className="login-error">
            That sign-in did not complete. Please try again.
          </p>
        )}

        {/* A real link, not a fetch: the OAuth flow is a browser redirect. */}
        <a className="lp-cta" href={`/auth/google?return_to=${encodeURIComponent(from)}`}>
          Continue with Google
        </a>

        <p className="login-fine">
          By continuing you agree that your board content is fetched from the public APIs you
          choose. You can delete your account at any time from settings.
        </p>
      </section>
    </div>
  );
}
