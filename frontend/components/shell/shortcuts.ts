import { NAV } from "@/components/shell/nav";

/** One row of the shortcuts help. `combo` uses the useHotkeys syntax ("mod+k", "g d"). */
export type ShortcutRow = { combo: string; label: string; /** display-only key caps, e.g. [["Alt", "1…8"]] */ display?: string[][] };

export const GENERAL_SHORTCUTS: ShortcutRow[] = [
  { combo: "/", label: "Търсене: актив, урок или страница" },
  { combo: "mod+k", label: "Търсене (работи и от поле за писане)" },
  { combo: "?", label: "Тази помощ" },
  { combo: "e", label: "Explain mode — вкл. / изкл. обясненията на термините" },
  { combo: "[", label: "Свий / разгъни страничното меню" },
  { combo: "esc", label: "Затвори прозорец, меню или търсене" },
];

/** "g x" navigation shortcuts, derived from the nav items that declare one. */
export const NAV_SHORTCUTS: ShortcutRow[] = NAV.filter((i) => i.shortcut).map((i) => ({
  combo: i.shortcut as string,
  label: i.label,
}));

/** Chart / terminal shortcuts (implemented by the chart terminal). */
export const CHART_SHORTCUTS: ShortcutRow[] = [
  { combo: "alt+1", label: "Timeframe 1 … 8 (1m → 1W)", display: [["Alt", "1…8"]] },
  { combo: "h", label: "Horizontal line" },
  { combo: "t", label: "Trend line" },
  { combo: "esc", label: "Cursor (прекрати чертането)" },
  { combo: "space", label: "Следваща свещ в Market Replay" },
];
