/*
 * Lesson URLs. Two lesson slugs collide with static lab pages (/learn/leverage is the Leverage Lab,
 * /learn/market-structure the Market Structure Lab), so those lessons live at alias routes.
 * Mirrors backend app/academy/levels.py LESSON_ROUTE_ALIASES (a backend test keeps them in sync).
 * Pure module — safe in Server Components and unit tests.
 */
export const LESSON_ROUTE_ALIASES: Readonly<Record<string, string>> = {
  leverage: "leverage-basics",
  "market-structure": "market-structure-basics",
};

/** Route segment under /learn for a lesson slug (alias-aware). */
export function lessonRoute(slug: string): string {
  return LESSON_ROUTE_ALIASES[slug] ?? slug;
}

/** Lesson URL: the API `href` when present, else /learn/<route> (alias-aware). */
export function lessonHref(slug: string, href?: string | null): string {
  return href || `/learn/${encodeURIComponent(lessonRoute(slug))}`;
}
