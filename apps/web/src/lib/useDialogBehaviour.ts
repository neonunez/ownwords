import { useEffect, useRef, type RefObject } from "react";
import { focusableWithin } from "./focus";

/**
 * Modal behaviour for an overlay that lives inside the app frame rather than
 * at the top of the viewport: Escape closes it, Tab stays inside it, and focus
 * returns to whatever opened it.
 */
export function useDialogBehaviour(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onClose: () => void,
): void {
  // Held in a ref so a caller re-rendering does not re-run the effect, which
  // would otherwise lose track of the element focus has to return to.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  // The element focus returns to. It is recorded while the overlay is still
  // closed, because opening one seals the screen behind it with `inert`, and
  // the browser blurs whatever was focused there before any of this can read it.
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (active) return;
    const remember = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && target !== document.body) trigger.current = target;
    };
    document.addEventListener("focusin", remember);
    return () => document.removeEventListener("focusin", remember);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const panel = ref.current;
    if (!panel) return;

    const first = focusableWithin(panel)[0];
    (first ?? panel).focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableWithin(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const firstNode = focusable[0]!;
      const lastNode = focusable[focusable.length - 1]!;
      const current = document.activeElement;
      if (event.shiftKey && (current === firstNode || current === panel)) {
        event.preventDefault();
        lastNode.focus();
      } else if (!event.shiftKey && current === lastNode) {
        event.preventDefault();
        firstNode.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Focus cannot land in an inert subtree, and the shell lifts `inert` in
      // a render scheduled after this cleanup. Rather than guess when that
      // lands, ask for the focus each frame until it takes, and give up.
      const restore = (attempt: number) => {
        const node = trigger.current;
        if (!node) return;
        node.focus({ preventScroll: true });
        if (
          document.activeElement !== node &&
          attempt < 5 &&
          typeof requestAnimationFrame === "function"
        ) {
          requestAnimationFrame(() => restore(attempt + 1));
        }
      };
      if (typeof requestAnimationFrame === "function")
        requestAnimationFrame(() => restore(0));
      else restore(0);
    };
  }, [ref, active]);
}
