"use client";

import { useEffect, useLayoutEffect, useState, useSyncExternalStore, type RefObject } from "react";

/* Shared plumbing for Tooltip / Popover / Drawer / Modal: positioning, scroll lock, focus
 * management and enter/exit presence. No dependencies. */

export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";

const VIEWPORT_PAD = 8;

const opposite: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

/**
 * Fixed-position coordinates for a floating element next to an anchor rect. Flips to the opposite
 * side when there is not enough room, then clamps into the viewport.
 */
export function computePosition(
  anchor: DOMRect,
  floating: { width: number; height: number },
  side: Side,
  align: Align = "center",
  offset = 8,
): { top: number; left: number; side: Side } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fits = (s: Side) => {
    if (s === "top") return anchor.top - offset - floating.height >= VIEWPORT_PAD;
    if (s === "bottom") return anchor.bottom + offset + floating.height <= vh - VIEWPORT_PAD;
    if (s === "left") return anchor.left - offset - floating.width >= VIEWPORT_PAD;
    return anchor.right + offset + floating.width <= vw - VIEWPORT_PAD;
  };
  let s = side;
  if (!fits(s) && fits(opposite[s])) s = opposite[s];

  let top: number;
  let left: number;
  if (s === "top" || s === "bottom") {
    top = s === "top" ? anchor.top - offset - floating.height : anchor.bottom + offset;
    left =
      align === "start"
        ? anchor.left
        : align === "end"
          ? anchor.right - floating.width
          : anchor.left + anchor.width / 2 - floating.width / 2;
  } else {
    left = s === "left" ? anchor.left - offset - floating.width : anchor.right + offset;
    top =
      align === "start"
        ? anchor.top
        : align === "end"
          ? anchor.bottom - floating.height
          : anchor.top + anchor.height / 2 - floating.height / 2;
  }
  left = Math.max(VIEWPORT_PAD, Math.min(left, vw - floating.width - VIEWPORT_PAD));
  top = Math.max(VIEWPORT_PAD, Math.min(top, vh - floating.height - VIEWPORT_PAD));
  return { top: Math.round(top), left: Math.round(left), side: s };
}

/**
 * Keeps `floating` positioned next to `anchor` while `open` (on mount, scroll in any container,
 * resize and size changes). Writes styles directly — no re-render per frame.
 */
export type AnchorLike = HTMLElement | null | undefined | RefObject<HTMLElement | null>;

/** Resolves an element-or-ref anchor. Only call from effects / event handlers (never in render). */
export function resolveAnchor(a: AnchorLike): HTMLElement | null {
  if (!a) return null;
  if (typeof (a as HTMLElement).getBoundingClientRect === "function") return a as HTMLElement;
  return (a as RefObject<HTMLElement | null>).current ?? null;
}

export function useAnchoredPosition(
  open: boolean,
  anchor: AnchorLike,
  floating: AnchorLike,
  side: Side,
  align: Align,
  offset = 8,
  /** give the floating element at least the anchor's width */
  matchWidth = false,
) {
  useLayoutEffect(() => {
    const anchorEl = resolveAnchor(anchor);
    const floatingEl = resolveAnchor(floating);
    if (!open || !anchorEl || !floatingEl) return;
    let raf = 0;
    const place = () => {
      raf = 0;
      if (!anchorEl.isConnected) return;
      const a = anchorEl.getBoundingClientRect();
      // anchor scrolled out of view → hide instead of sticking to the viewport edge
      if (a.bottom < 0 || a.top > window.innerHeight || a.right < 0 || a.left > window.innerWidth) {
        floatingEl.style.visibility = "hidden";
        return;
      }
      if (matchWidth) floatingEl.style.minWidth = `${Math.round(a.width)}px`;
      const f = floatingEl.getBoundingClientRect();
      const pos = computePosition(a, { width: f.width, height: f.height }, side, align, offset);
      floatingEl.style.top = `${pos.top}px`;
      floatingEl.style.left = `${pos.left}px`;
      floatingEl.dataset.side = pos.side;
      floatingEl.style.visibility = "visible";
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(place);
    };
    place();
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    ro?.observe(floatingEl);
    ro?.observe(anchorEl);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
    };
  }, [open, anchor, floating, side, align, offset, matchWidth]);
}

let scrollLocks = 0;
let savedOverflow = "";
let savedPaddingRight = "";

/** Locks page scroll while `active` (ref-counted, compensates for the scrollbar width). */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const body = document.body;
    if (scrollLocks === 0) {
      savedOverflow = body.style.overflow;
      savedPaddingRight = body.style.paddingRight;
      const sbw = window.innerWidth - document.documentElement.clientWidth;
      body.style.overflow = "hidden";
      if (sbw > 0) body.style.paddingRight = `${sbw}px`;
    }
    scrollLocks++;
    return () => {
      scrollLocks--;
      if (scrollLocks === 0) {
        body.style.overflow = savedOverflow;
        body.style.paddingRight = savedPaddingRight;
      }
    };
  }, [active]);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/**
 * While `active`: moves focus into `container` (first [autofocus]/[data-autofocus] element, else
 * the container itself), keeps Tab cycling inside it, and restores focus to the previously focused
 * element afterwards.
 */
export function useFocusTrap(active: boolean, container: HTMLElement | null) {
  useEffect(() => {
    if (!active || !container) return;
    const previous = document.activeElement as HTMLElement | null;
    const initial = container.querySelector<HTMLElement>("[data-autofocus], [autofocus]");
    // after paint so enter animations do not fight the focus scroll
    const t = window.setTimeout(() => {
      if (!container.contains(document.activeElement)) (initial ?? container).focus({ preventScroll: true });
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusables(container);
      if (!items.length) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const cur = document.activeElement;
      if (e.shiftKey && (cur === first || cur === container)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && cur === last) {
        e.preventDefault();
        first.focus();
      }
    };
    container.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      container.removeEventListener("keydown", onKey);
      if (previous && previous.isConnected && typeof previous.focus === "function") previous.focus({ preventScroll: true });
    };
  }, [active, container]);
}

/**
 * Enter/exit presence: stays mounted for `exitMs` after `open` turns false so an exit animation
 * can play. Returns `mounted` and whether it is currently `closing`.
 */
export function usePresence(open: boolean, exitMs = 180): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setMounted(true);
  }
  useEffect(() => {
    if (open || !mounted) return;
    const t = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(t);
  }, [open, mounted, exitMs]);
  return { mounted: mounted || open, closing: !open && mounted };
}

const noopSubscribe = () => () => {};

/** False on the server and during hydration, true afterwards (portals need document.body). */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
