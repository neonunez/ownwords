import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

/*
 * Touch gestures, built on pointer events so a finger, a pen and a mouse all
 * reach them. Each one is an accelerator for something a control on screen
 * already does: nothing here is the only way to do anything.
 *
 * The surface a gesture lives on declares which axis the browser keeps
 * (`touch-action`), so a vertical swipe still scrolls the screen and the
 * gesture only ever sees the other axis.
 */

/** How far a press may wander before it counts as a scroll or a drag. */
export const SLOP_PX = 10;

/** How long a press is held before it opens a row's options. */
export const LONG_PRESS_MS = 450;

/**
 * How long a press waits before showing the hold building. Most presses that
 * last this long were not the start of a scroll, so rows do not twitch as a
 * finger begins to scroll the list.
 */
export const HOLD_FEEDBACK_MS = 150;

/**
 * How long after a finger lifts the tap it may still produce is ignored, when
 * that lift ended a hold or a drag. Bounded, so a later tap or a keyboard
 * press on the same control is never swallowed.
 */
const SWALLOW_MS = 300;

/**
 * Swallows the next click, for a short while only. Caught on the way down
 * from the window, since the click may land on whatever the gesture put under
 * the finger (the scrim of the sheet a hold just opened), not the control. A
 * new press anywhere is a new tap of its own, so it lets that tap through.
 */
function useClickSwallow() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armed = useRef<((event: MouseEvent) => void) | null>(null);
  const disarm = useCallback(function disarm() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (armed.current) {
      window.removeEventListener("click", armed.current, true);
      window.removeEventListener("pointerdown", disarm, true);
    }
    armed.current = null;
  }, []);
  useEffect(() => disarm, [disarm]);
  const arm = useCallback(() => {
    disarm();
    const swallow = (event: MouseEvent) => {
      disarm();
      event.preventDefault();
      event.stopPropagation();
    };
    armed.current = swallow;
    window.addEventListener("click", swallow, true);
    window.addEventListener("pointerdown", disarm, true);
  }, [disarm]);
  /** Called as the finger lifts: the click, if any, comes within moments. */
  const expire = useCallback(() => {
    if (!armed.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(disarm, SWALLOW_MS);
  }, [disarm]);
  return { arm, expire, disarm };
}

/**
 * A short tick on the phones that have it. iOS Safari has no Vibration API,
 * so there it is simply nothing; it is never what tells a person something
 * happened, only an echo of what the screen already shows.
 */
export function haptic(pattern: number | number[] = 10): void {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // A browser may refuse it outside a user gesture; nothing depends on it.
  }
}

/** Whether the person has asked the system for less motion. */
export function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * A motion token in milliseconds, as the stylesheet resolves it now, so an
 * exit waits exactly as long as it plays: 0 under reduced motion.
 */
export function motionMs(token: "fast" | "base" | "slow" | "screen"): number {
  if (typeof getComputedStyle !== "function") return 0;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(`--motion-${token}`)
    .trim();
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return value.endsWith("ms") ? parsed : parsed * 1000;
}

/* ---- press and hold --------------------------------------------------- */

export interface LongPressOptions {
  /** Opens the options. Also reached by a right click or the menu key. */
  onLongPress: () => void;
  delay?: number;
  enabled?: boolean;
}

export interface LongPressBindings {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}

/**
 * Press and hold on a touch screen; a right click or the keyboard's menu key
 * elsewhere, which the browser reports as `contextmenu`. While a finger is
 * held, `holding` is true so the control can show the hold building. Moving
 * past the slop, lifting early or the browser starting a scroll all cancel it,
 * and the tap that ends a completed hold does not also count as a tap.
 */
export function useLongPress({
  onLongPress,
  delay = LONG_PRESS_MS,
  enabled = true,
}: LongPressOptions): { holding: boolean; bind: LongPressBindings } {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedback = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  // Armed once a hold has opened the options, for the tap its lift makes.
  const swallow = useClickSwallow();
  const fired = useRef(false);
  const callback = useRef(onLongPress);
  useEffect(() => {
    callback.current = onLongPress;
  }, [onLongPress]);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (feedback.current) clearTimeout(feedback.current);
    timer.current = null;
    feedback.current = null;
    start.current = null;
    setHolding(false);
  }, []);

  useEffect(() => cancel, [cancel]);

  const { arm } = swallow;
  const hold = useCallback(() => {
    fired.current = true;
    arm();
    cancel();
    haptic();
    callback.current();
  }, [arm, cancel]);

  const bind: LongPressBindings = {
    onPointerDown: (event) => {
      fired.current = false;
      swallow.disarm();
      // A mouse has a right button for this; holding the left one is a click.
      if (!enabled || event.pointerType === "mouse" || event.button !== 0)
        return;
      start.current = { x: event.clientX, y: event.clientY };
      feedback.current = setTimeout(
        () => setHolding(true),
        Math.min(HOLD_FEEDBACK_MS, delay),
      );
      timer.current = setTimeout(hold, delay);
    },
    onPointerMove: (event) => {
      const origin = start.current;
      if (!origin) return;
      if (
        Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > SLOP_PX
      )
        cancel();
    },
    onPointerUp: () => {
      cancel();
      swallow.expire();
    },
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (event) => {
      if (!enabled) return;
      // Android reports its own long press as a context menu too, after the
      // hold has already opened the options: take it, but only once.
      event.preventDefault();
      if (fired.current) return;
      // A right click or the menu key: no tap follows it to swallow.
      cancel();
      callback.current();
    },
  };

  return { holding, bind };
}

/* ---- drag along one axis ---------------------------------------------- */

export interface DragRelease {
  /** Where the drag ended, along its axis, in px from where it began. */
  offset: number;
  /** Its speed at the end, in px per ms; the sign is its direction. */
  velocity: number;
}

/**
 * Whether a released drag commits, and which way: past `distance`, or flicked
 * faster than `flick` px/ms in the direction it travelled. 0 springs back.
 */
export function settle(
  { offset, velocity }: DragRelease,
  distance: number,
  flick = 0.45,
): -1 | 0 | 1 {
  const direction = offset > 0 ? 1 : offset < 0 ? -1 : 0;
  if (direction === 0) return 0;
  if (Math.abs(offset) >= distance) return direction;
  const flung =
    Math.abs(velocity) >= flick &&
    Math.sign(velocity) === direction &&
    Math.abs(offset) >= SLOP_PX * 2;
  return flung ? direction : 0;
}

export interface DragOptions {
  axis: "x" | "y";
  /**
   * The way the drag may travel: 1 toward positive, -1 toward negative,
   * 0 both. The other way follows the finger only reluctantly.
   */
  direction?: -1 | 0 | 1;
  enabled?: boolean;
  onRelease: (release: DragRelease) => void;
}

export interface DragBindings {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
}

interface Track {
  pointerId: number;
  x: number;
  y: number;
  engaged: boolean;
  samples: { at: number; value: number }[];
}

/** How far back the release speed looks, in ms. */
const VELOCITY_WINDOW_MS = 100;

/**
 * Follows one pointer along one axis. It engages only once the pointer has
 * moved past the slop mostly along that axis; a press that moves the other
 * way, or the browser taking the pointer to scroll, leaves everything as it
 * was. Once engaged, the click that would end the press is swallowed, so a
 * drag over a button never also presses it.
 */
export function useDrag({
  axis,
  direction = 0,
  enabled = true,
  onRelease,
}: DragOptions): { offset: number; dragging: boolean; bind: DragBindings } {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const track = useRef<Track | null>(null);
  const swallow = useClickSwallow();

  const reset = useCallback(() => {
    track.current = null;
    setDragging(false);
    setOffset(0);
  }, []);

  const along = (event: { clientX: number; clientY: number }, from: Track) =>
    axis === "x" ? event.clientX - from.x : event.clientY - from.y;
  const across = (event: { clientX: number; clientY: number }, from: Track) =>
    axis === "x" ? event.clientY - from.y : event.clientX - from.x;

  /** Against the allowed direction, the finger meets resistance. */
  const resist = (value: number) =>
    direction !== 0 && Math.sign(value) === -direction ? value * 0.15 : value;

  const bind: DragBindings = {
    onPointerDown: (event) => {
      swallow.disarm();
      // A second finger never takes over a drag already under way.
      if (!enabled || track.current?.engaged) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      track.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        engaged: false,
        samples: [],
      };
    },
    onPointerMove: (event) => {
      const current = track.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (!enabled) {
        reset();
        return;
      }
      const main = along(event, current);
      if (!current.engaged) {
        const cross = across(event, current);
        if (Math.hypot(main, cross) < SLOP_PX) return;
        if (Math.abs(cross) > Math.abs(main)) {
          // Mostly the other axis: that is the browser's, or nobody's.
          track.current = null;
          return;
        }
        current.engaged = true;
        setDragging(true);
        try {
          event.currentTarget.setPointerCapture?.(event.pointerId);
        } catch {
          // Capture is a nicety; the drag still follows inside the element.
        }
      }
      current.samples.push({ at: event.timeStamp, value: main });
      while (
        current.samples.length > 2 &&
        event.timeStamp - current.samples[0]!.at > VELOCITY_WINDOW_MS
      )
        current.samples.shift();
      setOffset(resist(main));
    },
    onPointerUp: (event) => {
      const current = track.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (!current.engaged || !enabled) {
        reset();
        return;
      }
      swallow.arm();
      swallow.expire();
      const final = resist(along(event, current));
      const first = current.samples[0];
      const elapsed = first ? event.timeStamp - first.at : 0;
      const velocity =
        first && elapsed > 0
          ? (along(event, current) - first.value) / elapsed
          : 0;
      reset();
      onRelease({ offset: final, velocity });
    },
    onPointerCancel: reset,
  };

  // A gesture switched off part-way (the card it moved has gone) lets go.
  return {
    offset: enabled ? offset : 0,
    dragging: enabled && dragging,
    bind,
  };
}
