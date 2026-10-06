"use client";

import { X } from "lucide-react";
import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  resolveAnchor,
  useAnchoredPosition,
  useFocusTrap,
  useIsClient,
  usePresence,
  useScrollLock,
  type Align,
  type AnchorLike,
  type Side,
} from "@/components/ui/floating";
import { cx } from "@/lib/format";

/* ───────────────────────────────────────────────────────────── Tooltip */

export type TooltipProps = {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: Side;
  align?: Align;
  /** hover delay before opening (ms) */
  delay?: number;
  disabled?: boolean;
  /** keep open while the pointer is over the bubble (for links inside, e.g. glossary cards) */
  interactive?: boolean;
  /** click on the anchor pins the bubble open (touch-friendly); outside click / Esc closes it */
  pinOnClick?: boolean;
  /** class of the wrapper around `children` (replaces the default "inline-flex") */
  className?: string;
  /** class of the bubble (e.g. "p-0 w-80" for rich cards) */
  contentClassName?: string;
  maxWidth?: number;
};

/**
 * Portal tooltip — rendered into <body> with fixed coordinates from the anchor rect, so it is never
 * clipped by overflow containers. Opens on hover (mouse) and keyboard focus; Esc closes it.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  delay = 120,
  disabled,
  interactive,
  pinOnClick,
  className,
  contentClassName,
  maxWidth = 300,
}: TooltipProps) {
  const id = useId();
  const isClient = useIsClient();
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [anchorEl, setAnchorEl] = useState<HTMLSpanElement | null>(null);
  const [floatEl, setFloatEl] = useState<HTMLDivElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const empty = content === null || content === undefined || content === false || content === "";
  const open = isClient && !disabled && !empty && (hover || pinned);

  const clear = () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  const show = (ms = delay) => {
    clear();
    timer.current = window.setTimeout(() => setHover(true), ms);
  };
  const hide = () => {
    clear();
    timer.current = window.setTimeout(() => setHover(false), interactive ? 140 : 40);
  };
  const closeNow = () => {
    clear();
    setHover(false);
    setPinned(false);
  };

  useEffect(() => () => clear(), []);
  useAnchoredPosition(open, anchorEl, floatEl, side, align, 8);

  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (anchorEl?.contains(t) || floatEl?.contains(t)) return;
      setPinned(false);
      setHover(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [pinned, anchorEl, floatEl]);

  const child =
    isValidElement(children) && typeof children.type === "string"
      ? cloneElement(children as React.ReactElement<Record<string, unknown>>, { "aria-describedby": open ? id : undefined })
      : children;

  return (
    <>
      <span
        ref={setAnchorEl}
        className={className ?? "inline-flex"}
        onPointerEnter={(e) => e.pointerType === "mouse" && show()}
        onPointerLeave={(e) => e.pointerType === "mouse" && hide()}
        onPointerDown={() => {
          if (!pinOnClick) closeNow();
        }}
        onClick={pinOnClick ? () => setPinned((p) => !p) : undefined}
        onFocus={(e) => {
          let visible = true;
          try {
            visible = (e.target as HTMLElement).matches(":focus-visible");
          } catch {
            /* old browsers */
          }
          if (visible) show(0);
        }}
        onBlur={(e) => {
          if (floatEl && e.relatedTarget instanceof Node && floatEl.contains(e.relatedTarget)) return;
          if (!pinned) hide();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            closeNow();
          }
        }}
      >
        {child}
      </span>
      {open &&
        createPortal(
          <div
            ref={setFloatEl}
            id={id}
            role="tooltip"
            style={{ maxWidth }}
            onPointerEnter={interactive ? clear : undefined}
            onPointerLeave={interactive && !pinned ? hide : undefined}
            onBlur={(e) => {
              if (!interactive || pinned) return;
              if (e.relatedTarget instanceof Node && (e.currentTarget.contains(e.relatedTarget) || anchorEl?.contains(e.relatedTarget))) return;
              hide();
            }}
            className={cx(
              "invisible fixed left-0 top-0 z-[120] animate-pop-in rounded-lg border border-white/10 bg-popover px-2.5 py-1.5 text-xs font-normal normal-case leading-relaxed tracking-normal text-text shadow-pop",
              !interactive && "pointer-events-none",
              contentClassName,
            )}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}

/* ───────────────────────────────────────────────────────────── Popover */

export type PopoverProps = {
  open: boolean;
  onClose: () => void;
  /** element or ref the popover is positioned against */
  anchor?: AnchorLike;
  /** alternatively: inline trigger node; it is wrapped and used as the anchor (toggle `open` from its onClick) */
  trigger?: React.ReactNode;
  children: React.ReactNode;
  side?: Side;
  align?: Align;
  offset?: number;
  className?: string;
  /** class of the inline wrapper around `trigger` */
  triggerClassName?: string;
  role?: "dialog" | "menu" | "listbox";
  ariaLabel?: string;
  /** focus the first focusable element inside when opened */
  autoFocus?: boolean;
  /** make the popover at least as wide as the anchor */
  matchAnchorWidth?: boolean;
};

/**
 * Floating glass panel anchored to an element (portal, fixed coordinates, auto-flip). Closes on
 * outside pointer-down and Esc (Esc is handled only while open and does not reach outer dialogs).
 */
export function Popover({
  open,
  onClose,
  anchor,
  trigger,
  children,
  side = "bottom",
  align = "start",
  offset = 6,
  className,
  triggerClassName,
  role = "dialog",
  ariaLabel,
  autoFocus,
  matchAnchorWidth,
}: PopoverProps) {
  const isClient = useIsClient();
  const [triggerEl, setTriggerEl] = useState<HTMLSpanElement | null>(null);
  const [floatEl, setFloatEl] = useState<HTMLDivElement | null>(null);
  const anchorLike: AnchorLike = trigger !== undefined ? triggerEl : anchor;
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useAnchoredPosition(open && isClient, anchorLike, floatEl, side, align, offset, matchAnchorWidth);

  useEffect(() => {
    if (!open || !floatEl) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (floatEl.contains(t) || resolveAnchor(anchorLike)?.contains(t)) return;
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeRef.current();
      const back = resolveAnchor(anchorLike);
      const focusTarget = back?.matches("button, a, [tabindex]") ? back : back?.querySelector<HTMLElement>("button, a, [tabindex]");
      focusTarget?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    let t: number | undefined;
    if (autoFocus) {
      t = window.setTimeout(() => {
        floatEl.querySelector<HTMLElement>("[data-autofocus], input, button, a[href], [tabindex]:not([tabindex='-1'])")?.focus({ preventScroll: true });
      }, 0);
    }
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      if (t !== undefined) window.clearTimeout(t);
    };
  }, [open, floatEl, anchorLike, autoFocus]);

  const panel =
    open && isClient
      ? createPortal(
          <div
            ref={setFloatEl}
            role={role}
            aria-label={ariaLabel}
            className={cx(
              "glass-strong invisible fixed left-0 top-0 z-[110] min-w-44 animate-scale-in rounded-xl p-1.5 text-sm text-text outline-none",
              className,
            )}
          >
            {children}
          </div>,
          document.body,
        )
      : null;

  if (trigger === undefined) return panel;
  return (
    <>
      <span ref={setTriggerEl} className={cx("inline-flex", triggerClassName)}>
        {trigger}
      </span>
      {panel}
    </>
  );
}

/* ─────────────────────────────────────────────────── Drawer & Modal */

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Затвори"
      title="Затвори (Esc)"
      className="-mr-1.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-white/[0.06] hover:text-text"
    >
      <X size={16} strokeWidth={2} aria-hidden />
    </button>
  );
}

/** Keeps the last children while an exit animation plays (parents often clear the data on close). */
function useStickyChildren(open: boolean, children: React.ReactNode): React.ReactNode {
  const [sticky, setSticky] = useState<React.ReactNode>(children);
  if (open && sticky !== children) setSticky(children);
  return open ? children : sticky;
}

/* Esc closes the top-most dialog only: open Drawers/Modals form a stack and a single window
 * listener calls the newest one. Popovers/Tooltips handle Esc earlier (document / React tree)
 * and stop propagation, so an Esc that closes a popover never also closes its dialog. */
const escStack: { current: () => void }[] = [];
function onWindowEscape(e: KeyboardEvent) {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  const top = escStack[escStack.length - 1];
  if (!top) return;
  e.preventDefault();
  top.current();
}

function useEscape(active: boolean, onClose: () => void) {
  const ref = useRef(onClose);
  useEffect(() => {
    ref.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!active) return;
    const entry = ref;
    escStack.push(entry);
    if (escStack.length === 1) window.addEventListener("keydown", onWindowEscape);
    return () => {
      const i = escStack.lastIndexOf(entry);
      if (i >= 0) escStack.splice(i, 1);
      if (escStack.length === 0) window.removeEventListener("keydown", onWindowEscape);
    };
  }, [active]);
}

export type DrawerProps = {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right" | "bottom";
  children: React.ReactNode;
  title?: React.ReactNode;
  /** accessible name when there is no visible title */
  ariaLabel?: string;
  footer?: React.ReactNode;
  className?: string;
  /** padding wrapper around children (default true) */
  padded?: boolean;
};

/** Off-canvas panel with a dimmed overlay (mobile navigation, side details, bottom sheets). */
export function Drawer({ open, onClose, side = "right", children, title, ariaLabel, footer, className, padded = true }: DrawerProps) {
  const isClient = useIsClient();
  const { mounted, closing } = usePresence(open, 190);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const titleId = useId();
  const body = useStickyChildren(open, children);
  useScrollLock(open);
  useFocusTrap(open, panel);
  useEscape(open, onClose);
  if (!isClient || !mounted) return null;

  const pos = {
    left: "inset-y-0 left-0 w-[min(320px,88vw)] rounded-r-2xl border-l-0",
    right: "inset-y-0 right-0 w-[min(420px,92vw)] rounded-l-2xl border-r-0",
    bottom: "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl border-b-0",
  }[side];
  const anim = {
    left: closing ? "animate-slide-out-left" : "animate-slide-in-left",
    right: closing ? "animate-slide-out-right" : "animate-slide-in-right",
    bottom: closing ? "animate-slide-out-down" : "animate-slide-in-up",
  }[side];

  return createPortal(
    <div className="fixed inset-0 z-[80]">
      <div
        className={cx("absolute inset-0 bg-overlay", closing ? "animate-fade-out" : "animate-fade-in")}
        onMouseDown={onClose}
        aria-hidden
      />
      <div
        ref={setPanel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
        tabIndex={-1}
        className={cx("glass-strong absolute flex flex-col outline-none", pos, anim, className)}
      >
        {side === "bottom" && <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/15" aria-hidden />}
        {title && (
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
            <h2 id={titleId} className="text-sm font-semibold text-text">
              {title}
            </h2>
            <CloseButton onClick={onClose} />
          </header>
        )}
        <div className={cx("min-h-0 flex-1 overflow-y-auto overscroll-contain", padded && "p-4")}>{body}</div>
        {footer && <footer className="shrink-0 border-t border-white/[0.06] px-4 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const isClient = useIsClient();
  const { mounted, closing } = usePresence(open, 150);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const titleId = useId();
  const body = useStickyChildren(open, children);
  useScrollLock(open);
  useFocusTrap(open, panel);
  useEscape(open, onClose);
  if (!isClient || !mounted) return null;

  return createPortal(
    <div
      className={cx(
        "fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-overlay p-4 pt-[8vh] sm:pt-[12vh]",
        closing ? "animate-fade-out" : "animate-fade-in",
      )}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={setPanel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          "glass-strong w-full rounded-2xl shadow-modal outline-none",
          closing ? "animate-scale-out" : "animate-scale-in",
          wide ? "max-w-4xl" : "max-w-lg",
        )}
      >
        <header className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3.5">
          <h3 id={titleId} className="text-[15px] font-semibold tracking-tight text-text">
            {title}
          </h3>
          <CloseButton onClick={onClose} />
        </header>
        <div className="max-h-[75vh] overflow-y-auto p-5">{body}</div>
      </div>
    </div>,
    document.body,
  );
}
