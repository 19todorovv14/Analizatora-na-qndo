export type Tool = "cursor" | "crosshair" | "trend" | "hline" | "ray" | "rect" | "text" | "measure";

export type DPoint = { time: number; price: number };

export type Drawing = {
  id: string;
  type: "trend" | "hline" | "ray" | "rect" | "text";
  p1: DPoint;
  p2?: DPoint;
  text?: string;
  color: string;
};

export const TOOL_INFO: { key: Tool; label: string; icon: string; help: string }[] = [
  { key: "cursor", label: "Cursor", icon: "↖", help: "Местене и мащабиране на графиката. Кликни върху рисунка, за да я избереш (Delete я трие)." },
  { key: "crosshair", label: "Crosshair", icon: "✛", help: "Кръстче, което показва точната цена и време." },
  { key: "trend", label: "Trend line", icon: "╱", help: "Линия между две точки — свържи дъна в uptrend или върхове в downtrend." },
  { key: "hline", label: "Horizontal line", icon: "―", help: "Хоризонтално ниво — support или resistance." },
  { key: "ray", label: "Ray", icon: "↗", help: "Лъч от точка през втора точка, продължен надясно." },
  { key: "rect", label: "Rectangle", icon: "▭", help: "Зона — ценовите нива са зони, не точни линии." },
  { key: "text", label: "Text", icon: "T", help: "Бележка върху графиката." },
  { key: "measure", label: "Measure", icon: "⇕", help: "Измерва разлика в цена, %, брой свещи и време между две точки." },
];

export const DRAW_COLORS = ["#f5c542", "#42a5f5", "#ef5350", "#26a69a", "#ab47bc", "#d1d4dc"];

const KEY = (symbol: string) => `ta-drawings:${symbol}`;

export function loadDrawings(symbol: string): Drawing[] {
  try {
    const raw = window.localStorage.getItem(KEY(symbol));
    return raw ? (JSON.parse(raw) as Drawing[]) : [];
  } catch {
    return [];
  }
}

export function saveDrawings(symbol: string, drawings: Drawing[]): void {
  try {
    window.localStorage.setItem(KEY(symbol), JSON.stringify(drawings));
  } catch {
    /* storage unavailable — drawings stay in memory only */
  }
}
