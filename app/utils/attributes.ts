// app/utils/attributes.ts
// COC 七版属性派生计算（共享给单机版与联机版）

/**
 * 伤害加值（DB）与体格（Build）
 * 由 力量(STR) + 体型(SIZ) 合计查表得出：
 *   2-64    → -2    / -2
 *   65-84   → -1    / -1
 *   85-124  → 0     /  0
 *   125-164 → +1d4  /  1
 *   165-204 → +1d6  /  2
 *   205-284 → +2d6  /  3
 *   285-364 → +3d6  /  4
 *   365-444 → +4d6  /  5
 *   445-524 → +5d6  /  6
 *   超过 524：每超过 80 点（不足 80 按 80 算）额外 +1d6 / +1
 *
 * 返回 db 为展示字符串（如 "-1"、"+1d6"）；合计值不足 2 时视为无效，返回 null。
 */
export function calcDBAndBuild(str: number, siz: number): { db: string; build: number } | null {
  const total = (str || 0) + (siz || 0);
  if (total < 2) return null;

  // 基础档位表：[上限, DB字符串, 体格]
  const table: Array<[number, string, number]> = [
    [64, '-2', -2],
    [84, '-1', -1],
    [124, '0', 0],
    [164, '+1d4', 1],
    [204, '+1d6', 2],
    [284, '+2d6', 3],
    [364, '+3d6', 4],
    [444, '+4d6', 5],
    [524, '+5d6', 6],
  ];

  for (const [max, db, build] of table) {
    if (total <= max) return { db, build };
  }

  // 超过 524：每超过 80（不足 80 按 80 算）加一档
  const extraTiers = Math.ceil((total - 524) / 80);
  const diceCount = 5 + extraTiers;
  return { db: `+${diceCount}d6`, build: 6 + extraTiers };
}
