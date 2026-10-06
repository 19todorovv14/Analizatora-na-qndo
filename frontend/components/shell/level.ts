/** XP → level, mirroring the backend (learning_service.progress: level = 1 + xp // 250). */
export const XP_PER_LEVEL = 250;

export type LevelInfo = { level: number; xp: number; into: number; toNext: number; pct: number };

export function levelInfo(xp: number | null | undefined): LevelInfo {
  const v = Math.max(0, Math.floor(Number.isFinite(xp as number) ? (xp as number) : 0));
  const into = v % XP_PER_LEVEL;
  return { level: 1 + Math.floor(v / XP_PER_LEVEL), xp: v, into, toNext: XP_PER_LEVEL - into, pct: (into / XP_PER_LEVEL) * 100 };
}
