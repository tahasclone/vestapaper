import { memo, useEffect, useRef, useState } from 'react';
import { CHARSET, CHAR_INDEX, COLOR_HEX, type ColorToken } from '../../shared/charset';
import { flap } from './sound';

const STEP_MS = 110; // one full flap = two 55ms half-turns
const HALF_MS = STEP_MS / 2;
const MAX_STEPS = 14; // cap drum travel so long jumps stay snappy

// Both glyphs and color chips live on a full-cell-height plane that each half
// crops with overflow:hidden — so top/bottom/flap faces always line up exactly.
function FaceContent({ char }: { char: string }) {
  const hex = COLOR_HEX[char as ColorToken];
  if (hex) {
    return (
      <span className="glyph">
        <i className="chip-full" style={{ background: hex }} />
      </span>
    );
  }
  return <span className="glyph">{char === ' ' ? '' : char}</span>;
}

function Face({ char, position }: { char: string; position: 'top' | 'bottom' }) {
  return (
    <div className={`half ${position}`}>
      <FaceContent char={char} />
    </div>
  );
}

function FlapFace({ char, position }: { char: string; position: 'top' | 'bottom' }) {
  return (
    <div className={`flap flap-${position}`}>
      <div
        className={`half ${position}`}
        style={{ position: 'absolute', top: 0, bottom: 0, height: '100%' }}
      >
        <FaceContent char={char} />
      </div>
    </div>
  );
}

interface Props {
  target: string;
  delayMs: number; // stagger offset before this cell starts flipping
  index: number; // stable cell index, used to vary the flip distance
}

export const SplitFlapCell = memo(function SplitFlapCell({ target, delayMs, index }: Props) {
  const [prev, setPrev] = useState(target);
  const [cur, setCur] = useState(target);
  const [flipId, setFlipId] = useState(0);
  const curRef = useRef(target);
  const targetRef = useRef(target);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    targetRef.current = target;
    if (target === curRef.current) return;
    clearTimeout(timerRef.current);

    const n = CHARSET.length;
    const targetIdx = CHAR_INDEX.get(target) ?? 0;
    const curIdx = CHAR_INDEX.get(curRef.current) ?? 0;
    const distance = (targetIdx - curIdx + n) % n;
    if (distance > MAX_STEPS) {
      // silently rewind the drum so the visible travel is 6..MAX_STEPS flaps
      const travel = 6 + ((index * 7 + targetIdx) % (MAX_STEPS - 5));
      curRef.current = CHARSET[(targetIdx - travel + n) % n];
    }

    const step = () => {
      const c = curRef.current;
      const t = targetRef.current;
      if (c === t) return;
      const next = CHARSET[((CHAR_INDEX.get(c) ?? 0) + 1) % n];
      setPrev(c);
      setCur(next);
      curRef.current = next;
      setFlipId((f) => f + 1);
      flap();
      if (next !== t) timerRef.current = setTimeout(step, STEP_MS);
      // once the final flap has landed, drop it from the DOM so the cell rests clean
      else timerRef.current = setTimeout(() => setPrev(next), STEP_MS + 40);
    };
    timerRef.current = setTimeout(step, delayMs);
    return () => clearTimeout(timerRef.current);
  }, [target, delayMs, index]);

  const flipping = prev !== cur;
  return (
    <div className="cell" style={{ '--half-ms': `${HALF_MS}ms` } as React.CSSProperties}>
      {/* static faces: top shows incoming char, bottom shows outgoing until the flap lands */}
      <Face char={cur} position="top" />
      <Face char={flipping ? prev : cur} position="bottom" />
      {flipping && (
        <span key={flipId}>
          <FlapFace char={prev} position="top" />
          <FlapFace char={cur} position="bottom" />
        </span>
      )}
    </div>
  );
});
