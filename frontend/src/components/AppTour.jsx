import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion'; // eslint-disable-line no-unused-vars
import { X } from 'lucide-react';

// ── Spotlight tour overlay ────────────────────────────────────────
// Dims the whole page with one giant box-shadow and punches a hole around
// the current step's element, so the thing being explained is literally the
// only lit part of the screen. A card sits next to the hole with the
// explanation and Back / Next.
//
// The spotlight is re-measured every frame while a step is open, which is
// what keeps it glued to its target through smooth scrolling, the sidebar
// slide-in, framer-motion view fades and window resizes — no scroll/resize
// listeners and no stale rects.

const GAP = 16;   // space between the spotlight edge and the card
const EDGE = 16;  // minimum distance from the viewport edge
const MOBILE = 900;

const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// Exists and takes up space. Used to decide, once at the start, which steps
// this account actually has — an element that is merely parked off screen
// (the mobile sidebar at translateX(-100%)) still counts as present.
function isLaidOut(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const cs = window.getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
}

// Laid out AND horizontally within the viewport. Used when a step opens, so
// spotlighting a sidebar item waits for the drawer to finish sliding in
// instead of framing a rectangle that is still off screen. Vertically off
// screen is fine — those get scrolled to.
function isOnScreen(el) {
  if (!isLaidOut(el)) return false;
  const r = el.getBoundingClientRect();
  return r.right > 0 && r.left < window.innerWidth;
}

function place(side, spot, w, h) {
  const cx = spot.left + spot.width / 2;
  const cy = spot.top + spot.height / 2;
  if (side === 'top')    return { top: spot.top - GAP - h,            left: cx - w / 2 };
  if (side === 'left')   return { top: cy - h / 2,                    left: spot.left - GAP - w };
  if (side === 'right')  return { top: cy - h / 2,                    left: spot.left + spot.width + GAP };
  return                        { top: spot.top + spot.height + GAP,  left: cx - w / 2 }; // bottom
}

const fits = (p, w, h) =>
  p.top >= EDGE && p.top + h <= window.innerHeight - EDGE &&
  p.left >= EDGE && p.left + w <= window.innerWidth - EDGE;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

// Where the card goes, and where its little arrow sits on the card so it
// points back at the spotlight.
function computeCard(spot, size, placement) {
  const { w, h } = size;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (!spot) {
    return { top: clamp(vh / 2 - h / 2, EDGE, vh - h - EDGE), left: clamp(vw / 2 - w / 2, EDGE, vw - w - EDGE), side: null, arrow: 0 };
  }

  // Narrow screens: sides never have room, so only consider above/below and
  // let the card span the width. Keeps the card off the thing it describes.
  const sides = vw <= MOBILE
    ? ['bottom', 'top']
    : [...new Set([placement, 'bottom', 'top', 'right', 'left'].filter(Boolean))];

  let side = null;
  let pos = null;
  for (const s of sides) {
    const p = place(s, spot, w, h);
    if (fits(p, w, h)) { side = s; pos = p; break; }
  }

  if (!pos) {
    // Nothing fits cleanly — take the roomier vertical side and clamp.
    const roomBelow = vh - (spot.top + spot.height);
    side = roomBelow >= spot.top ? 'bottom' : 'top';
    pos = place(side, spot, w, h);
  }

  const top = clamp(pos.top, EDGE, Math.max(EDGE, vh - h - EDGE));
  const left = clamp(pos.left, EDGE, Math.max(EDGE, vw - w - EDGE));

  // Arrow offset along the card's shared edge, kept away from the corners.
  const arrow = (side === 'left' || side === 'right')
    ? clamp(spot.top + spot.height / 2 - top, 20, Math.max(20, h - 20))
    : clamp(spot.left + spot.width / 2 - left, 20, Math.max(20, w - 20));

  return { top, left, side, arrow };
}

const near = (a, b) => Math.abs(a - b) < 0.5;
function sameLayout(a, b) {
  if (!a || !b) return false;
  if (!!a.spot !== !!b.spot) return false;
  if (a.spot && !(near(a.spot.top, b.spot.top) && near(a.spot.left, b.spot.left) &&
                  near(a.spot.width, b.spot.width) && near(a.spot.height, b.spot.height))) return false;
  return near(a.card.top, b.card.top) && near(a.card.left, b.card.left) &&
         a.card.side === b.card.side && near(a.card.arrow, b.card.arrow);
}

export default function AppTour({ steps, tourId, onStepEnter, onClose }) {
  // Steps pointing at something that isn't on screen right now are dropped
  // up front, so "Step 3 of 8" is honest and no card ever points at nothing.
  const [liveSteps] = useState(() =>
    steps.filter(s => !s.target || isLaidOut(document.querySelector(s.target)))
  );

  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [layout, setLayout] = useState(null);

  const targetRef = useRef(null);
  const cardRef = useRef(null);
  const dirRef = useRef(1);           // which way the last move went, so an
                                      // unreachable step is skipped onward
  const closedRef = useRef(false);    // guards double-fires from key + click
  const indexRef = useRef(0);         // read by go()/finish() without making
                                      // them change identity every step

  const step = liveSteps[index];
  const total = liveSteps.length;
  const isLast = index === total - 1;

  const finish = useCallback((reason) => {
    if (closedRef.current) return;
    closedRef.current = true;
    onClose?.(reason, liveSteps[indexRef.current]?.id, indexRef.current);
  }, [onClose, liveSteps]);

  const go = useCallback((delta) => {
    dirRef.current = delta >= 0 ? 1 : -1;
    const next = indexRef.current + delta;
    if (next >= liveSteps.length) { finish('completed'); return; }
    indexRef.current = Math.max(0, next);
    setIndex(indexRef.current);
  }, [liveSteps.length, finish]);

  // Nothing survived the filter (an app shell that changed shape) — bail out
  // rather than render an empty overlay.
  useEffect(() => {
    if (total === 0) finish('empty');
  }, [total, finish]);

  // ── Resolve the step's target ───────────────────────────────────
  // The host may need a beat to open the sidebar, and the element may need
  // scrolling into view, so poll briefly before giving up on a step.
  useEffect(() => {
    if (!step) return;
    onStepEnter?.(step);

    if (!step.target) {
      targetRef.current = null;
      setLayout(null);
      setReady(true);
      return;
    }

    setReady(false);
    let cancelled = false;
    let timer;
    let tries = 0;

    const attempt = () => {
      if (cancelled) return;
      const el = document.querySelector(step.target);
      if (isOnScreen(el)) {
        targetRef.current = el;
        const r = el.getBoundingClientRect();
        if (r.top < EDGE || r.bottom > window.innerHeight - EDGE) {
          el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
        }
        setReady(true);
        return;
      }
      if (++tries > 24) { // ~1.2s — the sidebar transition is 0.25s
        targetRef.current = null;
        go(dirRef.current);
        return;
      }
      timer = setTimeout(attempt, 50);
    };
    attempt();

    return () => { cancelled = true; clearTimeout(timer); };
    // onStepEnter is stable (useCallback in the host); re-running on every
    // render would restart the scroll animation mid-step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, go]);

  // ── Keep the spotlight and card glued to the target ─────────────
  useEffect(() => {
    if (!ready || !step) return;
    let raf;
    const tick = () => {
      const el = targetRef.current;
      let spot = null;
      if (el && el.isConnected) {
        const r = el.getBoundingClientRect();
        const pad = step.padding ?? 8;
        spot = { top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
      }
      const card = cardRef.current;
      const size = { w: card?.offsetWidth || 340, h: card?.offsetHeight || 200 };
      const next = { spot, card: computeCard(spot, size, step.placement) };
      setLayout(prev => (sameLayout(prev, next) ? prev : next));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, step]);

  // ── Keyboard ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape')                       { e.preventDefault(); finish('skipped'); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft')               { e.preventDefault(); go(-1); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [go, finish]);

  // Move focus onto the card so screen readers and the keyboard follow along.
  useEffect(() => {
    if (ready) cardRef.current?.focus({ preventScroll: true });
  }, [ready, index]);

  if (!step || total === 0) return null;

  const pos = layout?.card ?? { top: -9999, left: -9999, side: null, arrow: 0 };
  const spot = layout?.spot;
  const soft = reducedMotion();
  const glide = soft ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 40, mass: 0.7 };
  const arrowStyle = pos.side === 'left' || pos.side === 'right'
    ? { top: pos.arrow, marginTop: -8 }
    : { left: pos.arrow, marginLeft: -8 };

  return createPortal(
    <div className="tour-root" data-tour-id={tourId}>
      {/* Swallows every click on the app underneath; clicking through it
          advances, which is what most people try first. */}
      <div
        className={`tour-block ${spot ? '' : 'dim'}`}
        onClick={() => go(1)}
        aria-hidden="true"
      />

      {spot && (
        <motion.div
          className="tour-spot"
          initial={false}
          animate={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
          transition={glide}
          style={{ borderRadius: step.radius ?? 14 }}
          aria-hidden="true"
        />
      )}

      <motion.div
        ref={cardRef}
        className={`tour-card ${ready ? 'shown' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        tabIndex={-1}
        initial={false}
        animate={{ top: pos.top, left: pos.left }}
        transition={glide}
      >
        {pos.side && <span className={`tour-arrow point-${pos.side}`} style={arrowStyle} aria-hidden="true" />}

        <button className="tour-close" onClick={() => finish('skipped')} aria-label="Close the guide">
          <X size={15} strokeWidth={2.5} />
        </button>

        <div className="tour-progress" aria-hidden="true">
          <div className="tour-progress-fill" style={{ width: `${((index + 1) / total) * 100}%` }} />
        </div>

        <div className="tour-body" aria-live="polite">
          <div className="tour-count">Step {index + 1} of {total}</div>
          <h3 className="tour-title" id="tour-title">{step.title}</h3>
          <p className="tour-text">{step.body}</p>

          {step.points && (
            <ul className="tour-points">
              {step.points.map(p => (
                <li key={p.text}><span className="tour-point-icon">{p.icon}</span><span>{p.text}</span></li>
              ))}
            </ul>
          )}

          {step.hint && <div className="tour-hint">⌨ {step.hint}</div>}
        </div>

        <div className="tour-actions">
          <button className="tour-btn-skip" onClick={() => finish('skipped')}>
            {isLast ? 'Close' : 'Skip guide'}
          </button>
          <div className="tour-nav">
            {index > 0 && (
              <button className="tour-btn-back" onClick={() => go(-1)}>Back</button>
            )}
            <button className="tour-btn-next" onClick={() => go(1)}>
              {isLast ? 'Got it' : 'Next'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
