"use client";

import { Compass } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import useSWR from "swr";

import { NAV_GROUPS } from "@/components/shell/nav";
import { Button } from "@/components/ui";
import { useFocusTrap } from "@/components/ui/floating";
import { fetcher, put } from "@/lib/api";
import { cx } from "@/lib/format";

type Settings = { settings: { tour_done: boolean } };
type Step = { title: string; text: string; target?: string; chips?: string[] };

const INTRO: Step = {
  title: "Добре дошъл в Trading Academy",
  text: "Това е образователна платформа. Всички пари тук са ВИРТУАЛНИ — можеш да грешиш без последствия. Ще ти покажа основните секции за 30 секунди.",
};

const STEPS: Step[] = [
  INTRO,
  // one step per navigation group, spotlighting the group's first item
  ...NAV_GROUPS.map((g) => ({ title: g.label, text: g.tour, target: g.items[0].href, chips: g.items.map((i) => i.label) })),
  {
    title: "LEARN | TRADE",
    text: "Две работни пространства: LEARN — уроци, подсказки и обяснения; TRADE — плътен paper trading терминал. И в двете парите са виртуални.",
    target: "workspace",
  },
  {
    title: "Търсене навсякъде",
    text: "Натисни / или Ctrl + K, за да намериш актив (BTC, Apple, Gold), урок или страница. С ? виждаш всички клавишни комбинации.",
    target: "search",
  },
  {
    title: "Препоръчан път",
    text: "1) Academy → Level 0. 2) Charts → разгледай свещите. 3) Paper Trading → първа сделка СЪС stop loss. 4) AI Teacher → 'Защо загубих?'. 5) Strategy Builder → Backtesting → Bot Lab. Режимът Beginner/Advanced е горе вдясно.",
    target: "mode",
  },
];

const CARD_W = 320;
const GAP = 14;
const PAD = 10;

type Placement = { rect: { left: number; top: number; width: number; height: number } | null; left: number; top: number; centered: boolean };

/** Measures the spotlight target and places the card next to it (right of it, else below/above). */
function place(target: string | undefined, card: HTMLElement | null): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cw = Math.min(CARD_W, vw - 2 * PAD);
  const ch = card?.offsetHeight ?? 220;
  const el = target ? document.querySelector<HTMLElement>(`[data-tour="${target}"]`) : null;
  const r = el?.getBoundingClientRect();
  // hidden (display:none on this breakpoint) or off-screen → centred card, no spotlight
  if (!r || r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) {
    return { rect: null, left: (vw - cw) / 2, top: Math.max(PAD, vh * 0.28 - ch / 3), centered: true };
  }
  const rect = { left: r.left - 4, top: r.top - 4, width: r.width + 8, height: r.height + 8 };
  let left: number;
  let top: number;
  // left-side targets (sidebar) → card to their right; top-bar / content targets → below (or above)
  if (r.left < vw * 0.3 && r.right + GAP + cw + PAD <= vw) {
    left = r.right + GAP;
    top = r.top - 8;
  } else {
    left = r.left;
    top = r.bottom + GAP + ch + PAD <= vh ? r.bottom + GAP : r.top - GAP - ch;
  }
  left = Math.max(PAD, Math.min(left, vw - cw - PAD));
  top = Math.max(PAD, Math.min(top, vh - ch - PAD));
  return { rect, left, top, centered: false };
}

/**
 * First-run tour on /dashboard: intro → one step per nav group → LEARN/TRADE switch → search →
 * recommended path. Shown until settings.tour_done; "Пропусни"/"Готово" (and Esc) finish it.
 */
export function GuidedTour() {
  const pathname = usePathname();
  const onDashboard = pathname === "/dashboard";
  const { data, mutate } = useSWR<Settings>(onDashboard ? "/settings" : null, fetcher, { revalidateOnFocus: false });
  const [step, setStep] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [seen, setSeen] = useState<Settings | undefined>(undefined);
  const [pos, setPos] = useState<Placement | null>(null);
  const [card, setCard] = useState<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  // `hidden` only bridges the gap until the server confirms tour_done. Once the settings say
  // "done", drop the local flag, so a later reset ("show the tour again" in Settings) shows it again.
  if (data !== seen) {
    setSeen(data);
    if (data?.settings.tour_done && (hidden || step !== 0)) {
      setHidden(false);
      setStep(0);
    }
  }

  const show = !hidden && onDashboard && !!data && !data.settings.tour_done;
  const current = STEPS[Math.min(step, STEPS.length - 1)];
  // trap focus only once the card is positioned (a visibility:hidden element cannot take focus)
  useFocusTrap(show && pos !== null, card);

  useEffect(() => {
    if (!show) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setPos(place(current.target, cardRef.current)));
    };
    // bring the target into view inside its scroll container (e.g. the sidebar nav) once per step
    const el = current.target ? document.querySelector<HTMLElement>(`[data-tour="${current.target}"]`) : null;
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
    update();
    // the shell may still be settling (fonts, sidebar width) — measure again shortly after
    const t = window.setTimeout(update, 260);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [show, step, current.target]);

  if (!show) return null;

  const finish = async () => {
    setHidden(true);
    try {
      await put("/settings", { tour_done: true });
      await mutate();
    } catch {
      /* not saved — the tour simply shows again next time */
    }
  };

  const last = step === STEPS.length - 1;
  const rect = pos?.rect ?? null;

  return (
    <div className="fixed inset-0 z-[90]" role="presentation">
      {/* click shield + dimming (the spotlight cuts a hole with a huge box-shadow) */}
      <div className={cx("absolute inset-0 transition-colors duration-200", rect ? "bg-transparent" : "bg-overlay")} aria-hidden />
      {rect && (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-xl ring-2 ring-accent/80 transition-[left,top,width,height] duration-300 ease-out-quart"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            boxShadow: "0 0 0 9999px rgb(2 4 10 / 0.62), 0 0 24px 2px rgb(59 130 246 / 0.35)",
          }}
        />
      )}
      <div
        ref={(el) => {
          cardRef.current = el;
          setCard(el);
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            void finish();
          } else if (e.key === "ArrowRight" && !last) setStep((s) => s + 1);
          else if (e.key === "ArrowLeft" && step > 0) setStep((s) => s - 1);
        }}
        className="glass-strong absolute animate-scale-in rounded-2xl p-4 shadow-modal outline-none transition-[left,top] duration-300 ease-out-quart"
        style={{
          width: `min(${CARD_W}px, calc(100vw - ${2 * PAD}px))`,
          left: pos?.left ?? "50%",
          top: pos?.top ?? "28%",
          transform: pos ? undefined : "translateX(-50%)",
          visibility: pos ? "visible" : "hidden",
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">
            <Compass size={13} strokeWidth={2} className="text-accent2" aria-hidden />
            Guided tour · {step + 1}/{STEPS.length}
          </div>
          <div className="flex gap-1" aria-hidden>
            {STEPS.map((_, i) => (
              <span key={i} className={cx("h-1 rounded-full transition-all duration-200", i === step ? "w-4 bg-accent2" : "w-1 bg-white/15")} />
            ))}
          </div>
        </div>
        <h3 id={titleId} className="mt-2 text-[15px] font-semibold tracking-[-0.01em] text-text">
          {current.title}
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">{current.text}</p>
        {current.chips && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {current.chips.map((c) => (
              <span key={c} className="rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[11px] font-medium text-text/85">
                {c}
              </span>
            ))}
          </div>
        )}
        <div className="mt-4 flex items-center justify-between">
          <button type="button" className="rounded text-xs text-muted transition-colors hover:text-text" onClick={() => void finish()}>
            Пропусни
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button type="button" size="sm" variant="outline" onClick={() => setStep(step - 1)}>
                Назад
              </Button>
            )}
            <Button type="button" size="sm" data-autofocus onClick={() => (last ? void finish() : setStep(step + 1))}>
              {last ? "Готово" : "Напред"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
