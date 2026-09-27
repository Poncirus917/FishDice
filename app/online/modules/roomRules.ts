// ---------- 房规配置：单一映射层 ----------
// 创建房间时由 KP 设定，存入 rooms 表；掷骰阶段读取阈值与开关。
// 所有默认值 / API 读写转换集中在此，禁止在各组件分散兜底。

// PC 角色卡分区（头像与姓名不在此列——始终对所有人可见）
export type CardSection =
  | 'story'        // 角色故事
  | 'possessions'  // 随身物品
  | 'backgrounds'  // 角色设定（形象描述等 8 栏）
  | 'core'         // 核心数值（HP/MP/SAN/LUCK + 8 属性）
  | 'skills'       // 技能
  | 'weapons'      // 武器
  | 'spells';      // 法术

// 创建房间弹窗中的展示顺序（按用户描述）
export const CARD_SECTION_OPTIONS: { key: CardSection; label: string; hint?: string }[] = [
  { key: 'story', label: '角色故事' },
  { key: 'possessions', label: '随身物品' },
  { key: 'backgrounds', label: '角色设定', hint: '形象描述、思想与信念等 8 栏' },
  { key: 'core', label: '核心数值' },
  { key: 'skills', label: '技能' },
  { key: 'weapons', label: '武器' },
  { key: 'spells', label: '法术' },
];

export type CardSectionsState = Record<CardSection, boolean>;

export interface RoomRules {
  card_sections: CardSectionsState;
  enable_push: boolean;       // 孤注一掷
  enable_burn_luck: boolean;  // 燃烧幸运
  crit_threshold: number;     // 大成功阈值（1-5，默认 3）
  fumble_threshold: number;   // 大失败阈值（96-100，默认 98）
}

export const CRIT_MIN = 1, CRIT_MAX = 5, CRIT_DEFAULT = 3;
export const FUMBLE_MIN = 96, FUMBLE_MAX = 100, FUMBLE_DEFAULT = 98;

export const DEFAULT_CARD_SECTIONS: CardSectionsState = {
  story: true,
  possessions: true,
  backgrounds: true,
  core: true,
  skills: true,
  weapons: true,
  spells: true,
};

export const DEFAULT_RULES: RoomRules = {
  card_sections: { ...DEFAULT_CARD_SECTIONS },
  enable_push: true,
  enable_burn_luck: true,
  crit_threshold: CRIT_DEFAULT,
  fumble_threshold: FUMBLE_DEFAULT,
};

const clampInt = (v: number, min: number, max: number, dft: number) =>
  Number.isInteger(v) && v >= min && v <= max ? v : dft;

// API rooms 行 → RoomRules（老房间/缺字段时回退默认）
export const rulesFromRoom = (row: Record<string, any> | null | undefined): RoomRules => {
  if (!row) return { ...DEFAULT_RULES, card_sections: { ...DEFAULT_CARD_SECTIONS } };
  const rawSections = row.card_sections;
  const card_sections: CardSectionsState = { ...DEFAULT_CARD_SECTIONS };
  if (rawSections && typeof rawSections === 'object') {
    (Object.keys(card_sections) as CardSection[]).forEach(k => {
      if (typeof rawSections[k] === 'boolean') card_sections[k] = rawSections[k];
    });
  }
  return {
    card_sections,
    enable_push: typeof row.enable_push === 'boolean' ? row.enable_push : true,
    enable_burn_luck: typeof row.enable_burn_luck === 'boolean' ? row.enable_burn_luck : true,
    crit_threshold: clampInt(row.crit_threshold, CRIT_MIN, CRIT_MAX, CRIT_DEFAULT),
    fumble_threshold: clampInt(row.fumble_threshold, FUMBLE_MIN, FUMBLE_MAX, FUMBLE_DEFAULT),
  };
};

// RoomRules → rooms 插入 payload
export const rulesToInsert = (rules: RoomRules) => ({
  card_sections: rules.card_sections,
  enable_push: rules.enable_push,
  enable_burn_luck: rules.enable_burn_luck,
  crit_threshold: rules.crit_threshold,
  fumble_threshold: rules.fumble_threshold,
});

// room_members.revealed_sections（JSONB 数组）→ CardSection[]
export const revealedFromMember = (raw: any): CardSection[] =>
  Array.isArray(raw)
    ? raw.filter((k): k is CardSection => typeof k === 'string' && k in DEFAULT_CARD_SECTIONS)
    : [];

// 房规默认可见性 + KP 已揭示的分区 → 其他 PL 的实际可见性（揭示只能增不能减）
export const sectionsForViewer = (rules: RoomRules, revealed: CardSection[]): CardSectionsState => {
  const result = { ...rules.card_sections };
  revealed.forEach(k => { result[k] = true; });
  return result;
};
