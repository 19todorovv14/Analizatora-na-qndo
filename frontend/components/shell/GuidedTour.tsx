"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import useSWR from "swr";

import { NAV } from "@/components/shell/nav";
import { Button } from "@/components/ui";
import { fetcher, put } from "@/lib/api";

type Settings = { settings: { tour_done: boolean } };

const INTRO = {
  title: "Добре дошъл в Trading Academy 👋",
  text: "Това е образователна платформа. Всички пари тук са ВИРТУАЛНИ — можеш да грешиш без последствия. Ще ти покажа основните секции за 30 секунди.",
};
const OUTRO = {
  title: "Препоръчан път",
  text: "1) Learn → Level 0. 2) Charts → разгледай свещите. 3) Paper Trading → първа сделка СЪС stop loss. 4) AI Teacher → 'Защо загубих?'. 5) Strategies → Backtesting → Bot Lab. Режимът Beginner/Advanced е горе вдясно.",
};

export function GuidedTour() {
  const pathname = usePathname();
  const { data, mutate } = useSWR<Settings>("/settings", fetcher, { revalidateOnFocus: false });
  const [step, setStep] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const steps = [INTRO, ...NAV.slice(0, 13).map((n) => ({ title: n.label, text: n.tour, target: n.href })), OUTRO];
  const current = steps[step] as { title: string; text: string; target?: string };
  const show = !hidden && pathname === "/dashboard" && data && !data.settings.tour_done;

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = show && current.target ? document.querySelector(`[data-tour="${current.target}"]`) : null;
      setRect(el ? el.getBoundingClientRect() : null);
    });
    return () => cancelAnimationFrame(id);
  }, [show, step, current.target]);

  if (!show) return null;

  const finish = async () => {
    setHidden(true);
    await put("/settings", { tour_done: true });
    mutate();
  };

  return (
    <div className="fixed inset-0 z-[90]">
      <div className="absolute inset-0 bg-black/55" />
      {rect && (
        <div
          className="pointer-events-none absolute rounded-md ring-2 ring-accent"
          style={{ left: rect.left - 3, top: rect.top - 3, width: rect.width + 6, height: rect.height + 6 }}
        />
      )}
      <div
        className="glass-strong fade-in absolute w-80 rounded-2xl p-4 shadow-modal"
        style={rect ? { left: Math.min(rect.right + 16, window.innerWidth - 340), top: Math.max(rect.top - 10, 10) } : { left: "50%", top: "30%", transform: "translateX(-50%)" }}
      >
        <div className="text-[11px] uppercase tracking-wider text-muted">
          Guided tour · {step + 1}/{steps.length}
        </div>
        <h3 className="mt-1 font-semibold">{current.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">{current.text}</p>
        <div className="mt-4 flex items-center justify-between">
          <button className="text-xs text-muted hover:text-text" onClick={finish}>
            Пропусни
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button size="sm" variant="outline" onClick={() => setStep(step - 1)}>
                Назад
              </Button>
            )}
            {step < steps.length - 1 ? (
              <Button size="sm" onClick={() => setStep(step + 1)}>
                Напред
              </Button>
            ) : (
              <Button size="sm" onClick={finish}>
                Готово
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
