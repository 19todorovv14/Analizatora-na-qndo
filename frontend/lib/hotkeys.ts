"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

/*
 * Global keyboard shortcuts.
 *
 *   useHotkeys({
 *     "/": openSearch,          // single key
 *     "mod+k": openSearch,      // mod = ⌘ on macOS, Ctrl elsewhere (either is accepted)
 *     "?": openHelp,            // symbols ignore Shift (layouts differ)
 *     "[": toggleSidebar,
 *     "g d": goDashboard,       // sequence: g, then d within 800 ms
 *     "alt+1": setTimeframe1,
 *   });
 *
 * Rules:
 * - Events from <input>, <textarea>, <select> and contentEditable are ignored (unless the combo is
 *   listed in `allowInInputs`), as are IME composition, auto-repeat and already-handled events.
 * - Escape is NEVER handled here — dialogs/popovers own Esc locally. Bindings that use it are dropped.
 * - Letters, digits and common symbols also match by physical key (event.code) when the active
 *   layout produces a non-Latin character (e.g. Bulgarian Cyrillic) or Option-modified characters.
 * - One window listener per hook instance, removed on unmount (safe under StrictMode double mount).
 */

export type HotkeyHandler = (e: KeyboardEvent) => void;

export type HotkeyOptions = {
  /** default true */
  enabled?: boolean;
  /** combos that still fire while focus is in a text field, e.g. ["mod+k"] */
  allowInInputs?: string[];
  /** max gap between sequence steps (ms), default 800 */
  sequenceTimeout?: number;
  /** call preventDefault() when a binding fires (default true) */
  preventDefault?: boolean;
};

type Step = { key: string; mod: boolean; ctrl: boolean; meta: boolean; alt: boolean; shift: boolean };
type Parsed = { combo: string; steps: Step[]; handler: HotkeyHandler };

const ALIASES: Record<string, string> = {
  esc: "escape",
  space: " ",
  spacebar: " ",
  plus: "+",
  slash: "/",
  question: "?",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  return: "enter",
  del: "delete",
};

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "Fn", "OS"]);

function parseStep(raw: string): Step {
  const step: Step = { key: "", mod: false, ctrl: false, meta: false, alt: false, shift: false };
  // a literal "+" key: "+" or "shift++"
  const parts = raw === "+" ? ["+"] : raw.endsWith("++") ? [...raw.slice(0, -2).split("+"), "+"] : raw.split("+");
  for (const p0 of parts) {
    const p = p0.trim().toLowerCase();
    if (p === "mod") step.mod = true;
    else if (p === "ctrl" || p === "control") step.ctrl = true;
    else if (p === "meta" || p === "cmd" || p === "command") step.meta = true;
    else if (p === "alt" || p === "option" || p === "opt") step.alt = true;
    else if (p === "shift") step.shift = true;
    else step.key = ALIASES[p] ?? p;
  }
  return step;
}

export function parseCombo(combo: string): Step[] {
  return combo
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(parseStep);
}

const CODE_SYMBOLS: Record<string, string> = {
  Slash: "/",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
  Space: " ",
};

/** Key a physical key would produce on a US layout. */
function keyFromCode(code: string, shift: boolean): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
  if (code === "Slash" && shift) return "?";
  return CODE_SYMBOLS[code] ?? null;
}

const isLetterOrDigit = (k: string) => /^[a-z0-9]$/.test(k);
const isAsciiPrintable = (k: string) => k.length === 1 && k >= " " && k <= "~";

function matchStep(step: Step, e: KeyboardEvent): boolean {
  if (step.mod) {
    if (!(e.ctrlKey || e.metaKey)) return false;
  } else if (e.ctrlKey !== step.ctrl || e.metaKey !== step.meta) {
    return false;
  }
  if (e.altKey !== step.alt) return false;
  // Shift is significant for letters/digits/named keys; symbols ("?", "/", "[") ignore it because
  // different layouts need Shift for different symbols.
  const symbol = step.key.length === 1 && !isLetterOrDigit(step.key);
  if (!symbol && e.shiftKey !== step.shift) return false;
  if (symbol && step.shift && !e.shiftKey) return false;

  if (e.key.toLowerCase() === step.key) return true;
  // layout-independent fallback: non-Latin layouts (Cyrillic) or Option/Alt-produced characters
  if (!isAsciiPrintable(e.key) || e.altKey) {
    const fromCode = keyFromCode(e.code, e.shiftKey);
    if (fromCode !== null && fromCode === step.key) return true;
  }
  return false;
}

function isEditable(e: KeyboardEvent): boolean {
  const t = (e.composedPath?.()[0] ?? e.target) as HTMLElement | null;
  if (!t || !(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

const warned = new Set<string>();

function parseBindings(bindings: Record<string, HotkeyHandler>): Parsed[] {
  const out: Parsed[] = [];
  for (const [combo, handler] of Object.entries(bindings)) {
    const steps = parseCombo(combo);
    if (!steps.length || steps.some((s) => !s.key)) continue;
    if (steps.some((s) => s.key === "escape")) {
      if (process.env.NODE_ENV !== "production" && !warned.has(combo)) {
        warned.add(combo);
        console.warn(`useHotkeys: "${combo}" ignored — Escape must not be bound globally.`);
      }
      continue;
    }
    out.push({ combo, steps, handler });
  }
  return out;
}

export function useHotkeys(bindings: Record<string, HotkeyHandler>, opts: HotkeyOptions = {}): void {
  const latest = useRef({ bindings, opts });
  useEffect(() => {
    latest.current = { bindings, opts };
  });
  const enabled = opts.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;
    let pending: { candidates: Parsed[]; index: number; at: number } | null = null;

    const fire = (p: Parsed, e: KeyboardEvent) => {
      if (latest.current.opts.preventDefault !== false) e.preventDefault();
      p.handler(e);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      if (e.key === "Escape") {
        pending = null;
        return;
      }
      if (MODIFIER_KEYS.has(e.key) || e.repeat) return;

      const { bindings: b, opts: o } = latest.current;
      const parsed = parseBindings(b);
      const editable = isEditable(e);
      const allowed = (p: Parsed) => !editable || !!o.allowInInputs?.includes(p.combo);
      const now = performance.now();

      if (pending && now - pending.at > (o.sequenceTimeout ?? 800)) pending = null;
      if (pending) {
        const idx = pending.index;
        const next = pending.candidates.filter((p) => allowed(p) && p.steps[idx] && matchStep(p.steps[idx], e));
        if (next.length) {
          const done = next.find((p) => p.steps.length === idx + 1);
          if (done) {
            pending = null;
            fire(done, e);
          } else {
            pending = { candidates: next, index: idx + 1, at: now };
          }
          return;
        }
        pending = null;
      }

      const first = parsed.filter((p) => allowed(p) && matchStep(p.steps[0], e));
      if (!first.length) return;
      const seqs = first.filter((p) => p.steps.length > 1);
      if (seqs.length) pending = { candidates: seqs, index: 1, at: now };
      const single = first.find((p) => p.steps.length === 1);
      if (single) fire(single, e);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

/* ───────────────────────────────────────────────────── display helpers */

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const p = nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(p);
}

const noopSubscribe = () => () => {};

/** Platform check that is safe for hydration (false on the server and during hydration). */
export function useIsMac(): boolean {
  return useSyncExternalStore(noopSubscribe, isMacPlatform, () => false);
}

const KEY_LABEL: Record<string, string> = {
  " ": "Space",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  enter: "Enter",
  escape: "Esc",
  delete: "Del",
  backspace: "⌫",
  tab: "Tab",
};

/**
 * Display parts for a combo: one array of key labels per sequence step.
 * hotkeyParts("mod+k", true) → [["⌘", "K"]]; hotkeyParts("g d") → [["G"], ["D"]].
 */
export function hotkeyParts(combo: string, isMac = false): string[][] {
  return parseCombo(combo).map((s) => {
    const keys: string[] = [];
    if (s.mod) keys.push(isMac ? "⌘" : "Ctrl");
    if (s.ctrl) keys.push(isMac ? "⌃" : "Ctrl");
    if (s.meta) keys.push(isMac ? "⌘" : "Win");
    if (s.alt) keys.push(isMac ? "⌥" : "Alt");
    if (s.shift) keys.push(isMac ? "⇧" : "Shift");
    keys.push(KEY_LABEL[s.key] ?? (s.key.length === 1 ? s.key.toUpperCase() : s.key[0].toUpperCase() + s.key.slice(1)));
    return keys;
  });
}

/** Compact one-line label: "mod+k" → "Ctrl+K" (or "⌘K" on macOS), "g d" → "G D". */
export function hotkeyLabel(combo: string, isMac = false): string {
  return hotkeyParts(combo, isMac)
    .map((k) => k.join(isMac ? "" : "+"))
    .join(" ");
}
