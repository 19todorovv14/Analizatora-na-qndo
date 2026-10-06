"use client";

import { ChartCandlestick, Compass, Keyboard } from "lucide-react";

import { ShortcutKeys } from "@/components/shell/ShortcutKeys";
import { CHART_SHORTCUTS, GENERAL_SHORTCUTS, NAV_SHORTCUTS, type ShortcutRow } from "@/components/shell/shortcuts";
import { Modal } from "@/components/ui";

function Group({ title, icon: Icon, rows, note }: { title: string; icon: typeof Keyboard; rows: ShortcutRow[]; note?: string }) {
  return (
    <section className="min-w-0">
      <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
        <Icon size={13} strokeWidth={2} className="text-accent2" aria-hidden />
        {title}
      </h4>
      <ul className="divide-y divide-white/[0.05] rounded-xl border border-white/[0.07] bg-white/[0.02]">
        {rows.map((r) => (
          <li key={`${r.combo}-${r.label}`} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0 text-[13px] leading-snug text-text/90">{r.label}</span>
            <ShortcutKeys combo={r.combo} parts={r.display} />
          </li>
        ))}
      </ul>
      {note && <p className="mt-1.5 text-[11px] leading-relaxed text-faint">{note}</p>}
    </section>
  );
}

/** "?" — every global shortcut, the "g x" navigation sequences and the chart terminal keys. */
export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Клавишни комбинации" wide>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-5">
          <Group title="Общи" icon={Keyboard} rows={GENERAL_SHORTCUTS} note="Клавишите не действат, докато пишеш в поле (освен Ctrl/⌘ + K)." />
          <Group
            title="На графиката"
            icon={ChartCandlestick}
            rows={CHART_SHORTCUTS}
            note="Работят в графичния терминал (Charts / Paper Trading / Market Replay)."
          />
        </div>
        <Group title="Навигация" icon={Compass} rows={NAV_SHORTCUTS} note="Натисни G, после буквата (до 0.8 секунди)." />
      </div>
    </Modal>
  );
}
