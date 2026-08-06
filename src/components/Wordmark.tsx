/**
 * The brand lockup: SOLARIS bright, WALLPAPER dimmer, with a flap chip.
 * One component so the landing page, login and app can never drift apart.
 */
export function Wordmark({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return (
    <span className={`wm wm-${size}`}>
      <b>SOLARIS</b>
      <em>WALLPAPER</em>
      <i className="wm-chip" aria-hidden />
    </span>
  );
}
