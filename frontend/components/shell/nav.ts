import {
  Blocks,
  Bot,
  ChartCandlestick,
  ChartColumn,
  ChartNoAxesCombined,
  Cpu,
  Database,
  Gamepad2,
  Globe,
  GraduationCap,
  LayoutDashboard,
  NotebookPen,
  Rewind,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  TestTubeDiagonal,
  Trophy,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/*
 * Single source of truth for the platform navigation: sidebar, mobile drawer, guided tour,
 * command palette (PAGES section), global "g x" shortcuts and the shortcuts help.
 */

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** one Bulgarian sentence (guided tour, command palette) */
  tour: string;
  /** global key sequence, e.g. "g d" */
  shortcut?: string;
  /** extra words the command palette matches (Bulgarian synonyms…) */
  keywords?: string[];
  /** other route prefixes that highlight this item (e.g. the legacy /paper page) */
  also?: string[];
};

export type NavGroupKey = "home" | "trading" | "strategies" | "learn" | "analytics" | "settings";

export type NavGroup = {
  key: NavGroupKey;
  label: string;
  /** guided-tour sentence for the whole group */
  tour: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    key: "home",
    label: "HOME",
    tour: "Начало: обобщение на сметката и прогреса, пазарен explorer, твоят watchlist и графичният терминал.",
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        icon: LayoutDashboard,
        tour: "Обобщение: пазар, сметка, прогрес и AI съвети.",
        shortcut: "g d",
        keywords: ["табло", "начало", "обобщение", "home"],
      },
      {
        href: "/markets",
        label: "Markets",
        icon: Globe,
        tour: "Всички инструменти: крипто, акции, ETF, forex, индекси и суровини — с търсене и филтри.",
        shortcut: "g m",
        keywords: ["пазари", "активи", "инструменти", "explorer", "акции", "крипто"],
      },
      {
        href: "/watchlist",
        label: "Watchlist",
        icon: Star,
        tour: "Активите, които следиш — цена, промяна и бърз достъп до графиката.",
        shortcut: "g w",
        keywords: ["любими", "наблюдение", "favorites"],
      },
      {
        href: "/charts",
        label: "Charts",
        icon: ChartCandlestick,
        tour: "Графичен терминал с индикатори и инструменти за чертане.",
        shortcut: "g c",
        keywords: ["графики", "свещи", "индикатори", "терминал", "chart"],
      },
    ],
  },
  {
    key: "trading",
    label: "TRADING",
    tour: "Практика с виртуални пари: paper trading терминал, симулатор на сделки и Market Replay свещ по свещ.",
    items: [
      {
        href: "/trade",
        label: "Paper Trading",
        icon: Wallet,
        tour: "Виртуална търговия с $10,000 — с реалистични разходи. Без реални пари.",
        shortcut: "g t",
        keywords: ["търговия", "сделка", "поръчка", "paper", "виртуални"],
        also: ["/paper"],
      },
      {
        href: "/simulator",
        label: "Trade Simulator",
        icon: Gamepad2,
        tour: "Упражнявай вход, stop loss и take profit в контролирани сценарии.",
        keywords: ["симулатор", "сценарии", "упражнение"],
      },
      {
        href: "/replay",
        label: "Market Replay",
        icon: Rewind,
        tour: "Исторически пазар свещ по свещ — без да виждаш бъдещето.",
        shortcut: "g r",
        keywords: ["повторение", "история", "replay"],
      },
    ],
  },
  {
    key: "strategies",
    label: "STRATEGIES",
    tour: "Изгради правила, тествай ги върху история и ги пусни като paper бот — без реални поръчки.",
    items: [
      {
        href: "/strategies",
        label: "Strategy Builder",
        icon: Blocks,
        tour: "Визуален builder: IF условия → LONG/SHORT setup.",
        keywords: ["стратегия", "правила", "builder"],
      },
      {
        href: "/backtesting",
        label: "Backtesting",
        icon: TestTubeDiagonal,
        tour: "Тествай стратегия върху история + проверка за overfitting.",
        shortcut: "g b",
        keywords: ["бектест", "тест", "история", "overfitting"],
      },
      {
        href: "/bots",
        label: "Bot Lab",
        icon: Bot,
        tour: "Paper ботове, които следват стратегията ти в симулация.",
        keywords: ["бот", "ботове", "автоматизация"],
      },
    ],
  },
  {
    key: "learn",
    label: "LEARN",
    tour: "Учи от нулата: уроци с quizzes, AI Teacher, упражнения за умения и журнал на сделките. Започни оттук.",
    items: [
      {
        href: "/learn",
        label: "Academy",
        icon: GraduationCap,
        tour: "Trading Academy — уроци от нулата, с quizzes. Започни оттук.",
        shortcut: "g l",
        keywords: ["уроци", "обучение", "академия", "курс", "learn"],
      },
      {
        href: "/ai",
        label: "AI Teacher",
        icon: Sparkles,
        tour: "Анализ на графиката с обяснения и чат с учителя.",
        shortcut: "g a",
        keywords: ["учител", "ai", "анализ", "чат", "въпрос"],
      },
      {
        href: "/challenges",
        label: "Challenges",
        icon: Trophy,
        tour: "Упражнения за умения: тренд, support, дисциплина.",
        keywords: ["предизвикателства", "упражнения", "xp"],
      },
      {
        href: "/journal",
        label: "Journal",
        icon: NotebookPen,
        tour: "Записвай сделките, емоциите и уроците си.",
        shortcut: "g j",
        keywords: ["журнал", "дневник", "бележки"],
      },
    ],
  },
  {
    key: "analytics",
    label: "ANALYTICS",
    tour: "Анализирай резултатите си: статистика, performance report и управление на риска.",
    items: [
      {
        href: "/stats",
        label: "Statistics",
        icon: ChartColumn,
        tour: "Performance report и седмичен преглед от AI Coach.",
        shortcut: "g s",
        keywords: ["статистика", "резултати", "отчет"],
      },
      {
        href: "/performance",
        label: "Performance",
        icon: ChartNoAxesCombined,
        tour: "Equity крива, drawdown и разбивка на резултатите по setup и актив.",
        keywords: ["представяне", "equity", "drawdown"],
      },
      {
        href: "/risk",
        label: "Risk Management",
        icon: ShieldCheck,
        tour: "Position size калкулатор, правила и рисков статус.",
        keywords: ["риск", "position size", "калкулатор", "stop loss"],
      },
    ],
  },
  {
    key: "settings",
    label: "SETTINGS",
    tour: "Режим, реализъм на симулацията, източници на пазарни данни и AI настройки.",
    items: [
      {
        href: "/settings",
        label: "Settings",
        icon: Settings,
        tour: "Режим, реализъм на симулацията, данни и профил.",
        keywords: ["настройки", "профил", "акаунт"],
      },
      {
        href: "/settings/data-sources",
        label: "Data Sources",
        icon: Database,
        tour: "Откъде идват пазарните данни (само за четене) и кои са демо.",
        keywords: ["данни", "източници", "доставчици", "api"],
      },
      {
        href: "/settings/ai",
        label: "AI Settings",
        icon: Cpu,
        tour: "AI доставчик и поведение на AI Teacher.",
        keywords: ["ai", "модел", "доставчик"],
      },
    ],
  },
];

/** Flat list of every navigation item (derived from NAV_GROUPS). */
export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Group of a nav item by href. */
export const NAV_GROUP_OF: Record<string, NavGroup> = Object.fromEntries(NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.href, g])));

/**
 * Routes rendered edge-to-edge (no main padding, height = viewport − top bar) — terminal layouts.
 * Later pages can opt in by adding their prefix here.
 */
export const FULL_BLEED_PREFIXES: string[] = ["/charts", "/trade"];

/** True when `pathname` is `prefix` or below it ("/learn" matches "/learn/rsi", not "/learning"). */
export function matchesPrefix(pathname: string, prefix: string): boolean {
  if (prefix === "/") return pathname === "/";
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * The nav href to highlight for `pathname`: the LONGEST matching prefix, so /learn/candlesticks
 * highlights only Academy and /settings/ai only AI Settings. Null when nothing matches.
 */
export function activeHref(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  let best: string | null = null;
  let bestLen = -1;
  for (const item of NAV) {
    for (const prefix of [item.href, ...(item.also ?? [])]) {
      if (prefix.length > bestLen && matchesPrefix(pathname, prefix)) {
        best = item.href;
        bestLen = prefix.length;
      }
    }
  }
  return best;
}

export function isFullBleed(pathname: string | null | undefined): boolean {
  return !!pathname && FULL_BLEED_PREFIXES.some((p) => matchesPrefix(pathname, p));
}
