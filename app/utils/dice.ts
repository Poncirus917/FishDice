// app/utils/dice.ts

export interface RollResult {
  roll: number;
  level: "大成功" | "极难成功" | "困难成功" | "成功" | "失败" | "大失败";
}

// ---------- 通用掷骰（联机版阶段1迁入） ----------

export interface DiceGroup {
  count: number;
  sides: number;
}

export interface DiceRollDetail {
  rolls: number[];   // 每颗骰子的出目
  total: number;     // 本组总点
}

export interface GroupRollDetail {
  group: DiceGroup;
  rolls: number[];
}

export interface DiceGroupsResult {
  parts: GroupRollDetail[]; // 每组的掷骰明细
  diceTotal: number;        // 所有骰子合计（不含加值）
  bonus: number;            // 额外加值
  total: number;            // 最终结果
}

/** 掷一组 count 个 sides 面骰，如 rollDice(2, 6) */
export function rollDice(count: number = 1, sides: number): DiceRollDetail {
  const safeCount = Math.max(1, Math.floor(count));
  const safeSides = Math.max(1, Math.floor(sides));

  const rolls: number[] = [];
  for (let i = 0; i < safeCount; i++) {
    rolls.push(Math.floor(Math.random() * safeSides) + 1);
  }
  return {
    rolls,
    total: rolls.reduce((sum, v) => sum + v, 0),
  };
}

/** 掷多组骰子并统一结算加值，如 rollDiceGroups([{count:2,sides:6},{count:1,sides:4}], 3) */
export function rollDiceGroups(groups: DiceGroup[], bonus: number = 0): DiceGroupsResult {
  const parts: GroupRollDetail[] = groups.map(group => {
    const { rolls } = rollDice(group.count, group.sides);
    return { group, rolls };
  });

  const diceTotal = parts.reduce(
    (sum, part) => sum + part.rolls.reduce((s, v) => s + v, 0),
    0
  );

  return {
    parts,
    diceTotal,
    bonus,
    total: diceTotal + bonus,
  };
}

export function cocCheck(
  target: number, 
  successMax: number = 3, // 房规：大成功上限默认3
  fumbleMin: number = 98  // 房规：大失败下限默认98
): RollResult {
  const roll = Math.floor(Math.random() * 100) + 1;

  if (roll >= fumbleMin) return { roll, level: "大失败" };

  if (roll <= target) {
    if (roll <= successMax) return { roll, level: "大成功" };
    if (roll <= target / 5) return { roll, level: "极难成功" };
    if (roll <= target / 2) return { roll, level: "困难成功" };
    return { roll, level: "成功" };
  }

  return { roll, level: "失败" };
}