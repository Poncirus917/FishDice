import type { CharacterState, Weapon, Spell } from '@/app/(single)/page';
import lzString from 'lz-string';

const SHARE_PREFIX = 'FD-';
// v6：二进制打包 + deflate-raw 压缩（大幅缩短），新增 backgrounds/possessions/spells 字段
// v5：技能短码字典 + 数值单字符化
// v4：新增武器（weapons）字段；story 段恒定占位
// v3：无武器字段，story 段可选（解码时保持兼容）
const SHARE_VERSION = 5; // 旧版（lz-string 路径）最高版本；v6 走二进制路径

const TYPE_MAP: Record<string, string> = { pc: 'p', npc: 'n', mob: 'm' };
const TYPE_REVERSE: Record<string, 'pc' | 'npc' | 'mob'> = { p: 'pc', n: 'npc', m: 'mob' };

// ---------- 调查员背景 8 栏（与 CharacterManager 保持一致，顺序固定） ----------
export const BG_FIELDS = [
  '形象描述', '思想与信念', '重要之人', '意义非凡之地', '宝贵之物', '特质', '伤口和疤痕', '恐惧症和狂躁症',
] as const;

// ---------- 数值编码表（0-100 → 单字符，v5 用） ----------
// 取 ASCII 可打印字符并排除结构分隔符（',' ':' '|' '~'），不足部分用 Unicode 补足
const VAL_CHARS: string[] = (() => {
  const skip = new Set([44, 58, 124, 126]); // , : | ~
  const chars: string[] = [];
  for (let c = 32; c <= 126; c++) {
    if (!skip.has(c)) chars.push(String.fromCharCode(c));
  }
  for (let c = 0x0100; c <= 0x010a; c++) chars.push(String.fromCharCode(c));
  return chars;
})(); // 共 101 个，索引 0-100

const encVal = (v: number): string => VAL_CHARS[Math.max(0, Math.min(100, Math.round(v || 0)))];
const decVal = (s: string, i: number): number => {
  const idx = VAL_CHARS.indexOf(s[i]);
  return idx >= 0 ? idx : 0;
};

// ---------- COC 标准技能短码字典（顺序即编码，不可改动） ----------
const SKILL_DICT: string[] = [
  '斗殴', '手枪', '步枪/霰弹枪', '霰弹枪', '冲锋枪', '机枪', '弓', '斧', '链锯', '剑', '鞭', '长矛',
  '会计', '人类学', '估价', '考古学', '攀爬', '计算机使用', '信用评级', '克苏鲁神话', '乔装', '闪避',
  '汽车驾驶', '电气维修', '电子学', '话术', '急救', '历史', '恐吓', '跳跃', '法律', '图书馆使用',
  '聆听', '锁匠', '机械维修', '医学', '博物学', '导航', '神秘学', '操作重型机械', '说服', '心理学',
  '心理分析', '骑术', '妙手', '侦查', '潜行', '游泳', '投掷', '追踪', '驯兽', '潜水', '爆破', '读唇', '母语',
];
const SKILL_INDEX = new Map(SKILL_DICT.map((name, i) => [name, i]));

// 技能 → 编码：标准技能 1 字符短码；非标准 '*' + 全名（v5 用）
const encSkillName = (name: string): string => {
  const idx = SKILL_INDEX.get(name);
  return idx !== undefined ? VAL_CHARS[idx] : `*${name}`;
};
// 编码 → 技能名
const decSkillName = (code: string): string | null => {
  if (code.startsWith('*')) return code.slice(1) || null;
  if (code.length !== 1) return null;
  const idx = VAL_CHARS.indexOf(code);
  return idx >= 0 && idx < SKILL_DICT.length ? SKILL_DICT[idx] : null;
};

// ---------- 武器编解码（v4/v5 旧格式） ----------
// v4 字面量格式：name~skill~melee/ranged~1D3+1D6~attacks~multi~malfunction
const decodeWeaponV4 = (s: string): Weapon | null => {
  const seg = s.split('~');
  if (seg.length < 7) return null;
  const [name, skill, type, dmg, attacks, multi, mal] = seg;

  const damage = parseDamage(dmg);
  return {
    name,
    skill,
    type: type === 'melee' ? 'melee' : 'ranged',
    damage: damage.length ? damage : [{ count: 1, sides: 3 }],
    attacks: parseInt(attacks) || 1,
    multi: multi === '1',
    malfunction: mal === '' || mal === undefined ? null : parseInt(mal) || null,
  };
};

// v5 短码格式：name~skillEnc~m/r~1D3+1D6~encVal~multi~encVal(''=无)
const decodeWeaponV5 = (s: string): Weapon | null => {
  const seg = s.split('~');
  if (seg.length < 7) return null;
  const [name, skillEnc, typeChar, dmg, attacksEnc, multi, malEnc] = seg;

  const skill = decSkillName(skillEnc);
  const damage = parseDamage(dmg);
  return {
    name,
    skill: skill || '',
    type: typeChar === 'r' ? 'ranged' : 'melee',
    damage: damage.length ? damage : [{ count: 1, sides: 3 }],
    attacks: Math.max(1, decVal(attacksEnc, 0) || 1),
    multi: multi === '1',
    malfunction: malEnc === '' || malEnc === undefined ? null : decVal(malEnc, 0) || null,
  };
};

// "1D3+1D6" → [{count:1,sides:3},{count:1,sides:6}]
const parseDamage = (dmg: string): Array<{ count: number; sides: number }> =>
  dmg
    .split('+')
    .map(p => {
      const m = p.trim().match(/^(\d+)D(\d+)$/i);
      return m ? { count: parseInt(m[1]), sides: parseInt(m[2]) } : null;
    })
    .filter((d): d is { count: number; sides: number } => d !== null);

const encodeWeaponV5 = (w: Weapon): string => [
  w.name,
  encSkillName(w.skill),
  w.type === 'melee' ? 'm' : 'r',
  w.damage.map(d => `${d.count}D${d.sides}`).join('+'),
  encVal(w.attacks),
  w.multi ? '1' : '0',
  w.malfunction == null ? '' : encVal(w.malfunction),
].join('~');

// ---------- v6：base64url / deflate 基础工具 ----------
const bytesToBase64Url = (bytes: Uint8Array<ArrayBuffer>): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const base64UrlToBytes = (s: string): Uint8Array<ArrayBuffer> => {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const bin = atob(padded + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

async function deflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

async function inflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(data);
  writer.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

// ---------- v6 编码 ----------
// flags 位定义
const V6_FLAG_STORY = 1;
const V6_FLAG_BACKGROUNDS = 2;
const V6_FLAG_POSSESSIONS = 4;
const V6_FLAG_SPELLS = 8;
const V6_FLAG_WEAPONS = 16;
const V6_CUSTOM_SKILL = 0xff; // 技能索引占位：自定义技能（后跟字符串）
const V6_NO_MALFUNCTION = 0xffff; // 无故障值

const encU16 = (buf: number[], v: number) => {
  const x = Math.max(0, Math.min(65535, Math.round(v || 0)));
  buf.push(x & 0xff, (x >> 8) & 0xff);
};

const encStr = (buf: number[], s: string) => {
  const bytes = new TextEncoder().encode(s || '');
  buf.push(bytes.length & 0xff, (bytes.length >> 8) & 0xff);
  for (let i = 0; i < bytes.length; i++) buf.push(bytes[i]);
};

const ATTR_KEYS = ['力量', '敏捷', '意志', '体质', '外貌', '教育', '体型', '智力'];

async function encodeV6(character: CharacterState): Promise<string> {
  const buf: number[] = [];
  const bg = character.backgrounds || {};
  const poss = character.possessions || [];
  const spells = character.spells || [];
  const weapons = character.weapons || [];

  let flags = 0;
  if (character.story) flags |= V6_FLAG_STORY;
  if (BG_FIELDS.some(f => bg[f])) flags |= V6_FLAG_BACKGROUNDS;
  if (poss.length > 0) flags |= V6_FLAG_POSSESSIONS;
  if (spells.length > 0) flags |= V6_FLAG_SPELLS;
  if (weapons.length > 0) flags |= V6_FLAG_WEAPONS;

  // 头部：版本 + flags + 名称 + 类型
  buf.push(6, flags);
  encStr(buf, character.name || '');
  buf.push(character.type === 'npc' ? 1 : character.type === 'mob' ? 2 : 0);

  // 8 项属性 + HP/MP/SAN/LUCK（current/max）
  for (const k of ATTR_KEYS) encU16(buf, character.attributes[k] || 0);
  encU16(buf, character.hp.current);
  encU16(buf, character.hp.max);
  encU16(buf, character.mp.current);
  encU16(buf, character.mp.max);
  encU16(buf, character.san.current);
  encU16(buf, character.san.max);
  encU16(buf, character.luck.current);
  encU16(buf, character.luck.max);

  // 技能：数量 + [索引/自定义 + 值]
  const skillEntries = Object.entries(character.skills || {});
  buf.push(Math.min(255, skillEntries.length));
  for (const [name, v] of skillEntries) {
    const idx = SKILL_INDEX.get(name);
    if (idx !== undefined) {
      buf.push(idx);
    } else {
      buf.push(V6_CUSTOM_SKILL);
      encStr(buf, name);
    }
    buf.push(Math.max(0, Math.min(255, Math.round(v || 0))));
  }

  // 武器
  if (flags & V6_FLAG_WEAPONS) {
    buf.push(Math.min(255, weapons.length));
    for (const w of weapons) {
      encStr(buf, w.name || '');
      const sidx = SKILL_INDEX.get(w.skill || '');
      if (sidx !== undefined) {
        buf.push(sidx);
      } else {
        buf.push(V6_CUSTOM_SKILL);
        encStr(buf, w.skill || '');
      }
      buf.push(w.type === 'ranged' ? 1 : 0);
      const segs = w.damage.slice(0, 3);
      buf.push(segs.length);
      for (const d of segs) {
        buf.push(Math.max(0, Math.min(255, d.count)), Math.max(0, Math.min(255, d.sides)));
      }
      encU16(buf, w.attacks);
      buf.push(w.multi ? 1 : 0);
      if (w.malfunction == null) {
        buf.push(V6_NO_MALFUNCTION & 0xff, (V6_NO_MALFUNCTION >> 8) & 0xff);
      } else {
        encU16(buf, w.malfunction);
      }
    }
  }

  // 文本块：故事 / 背景 8 栏 / 随身物品 / 法术
  if (flags & V6_FLAG_STORY) encStr(buf, character.story || '');
  if (flags & V6_FLAG_BACKGROUNDS) {
    for (const f of BG_FIELDS) encStr(buf, bg[f] || '');
  }
  if (flags & V6_FLAG_POSSESSIONS) {
    buf.push(Math.min(255, poss.length));
    for (const p of poss) encStr(buf, p || '');
  }
  if (flags & V6_FLAG_SPELLS) {
    buf.push(Math.min(255, spells.length));
    for (const s of spells) {
      encStr(buf, s.name || '');
      encStr(buf, s.cost || '');
      encStr(buf, s.effect || '');
      encStr(buf, s.note || '');
    }
  }

  const deflated = await deflateRaw(new Uint8Array(buf));
  // 首字符 '6' 为 v6 明文标记，便于解码时与旧版 lz-string 格式区分
  return SHARE_PREFIX + '6' + bytesToBase64Url(deflated);
}

// ---------- v6 解码 ----------
// encoded 为 FD- 与版本标记 '6' 之后的部分（纯 base64url 的 deflate 数据）
async function decodeV6(encoded: string): Promise<Omit<CharacterState, 'id'> | null> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64UrlToBytes(encoded);
  } catch {
    return null;
  }

  try {
    const raw = await inflateRaw(bytes);
    if (raw.length < 2 || raw[0] !== 6) return null;

    let pos = 0;
    const rU8 = () => raw[pos++];
    const rU16 = () => {
      const v = raw[pos] | (raw[pos + 1] << 8);
      pos += 2;
      return v;
    };
    const decoder = new TextDecoder();
    const rStr = () => {
      const len = rU16();
      const s = decoder.decode(raw.subarray(pos, pos + len));
      pos += len;
      return s;
    };

    pos = 1; // 跳过版本字节
    const flags = rU8();
    const name = rStr();
    const typeByte = rU8();
    const type = typeByte === 1 ? 'npc' : typeByte === 2 ? 'mob' : 'pc';

    const attributes: Record<string, number> = {};
    for (const k of ATTR_KEYS) attributes[k] = rU16();
    const hp = { current: rU16(), max: rU16() };
    const mp = { current: rU16(), max: rU16() };
    const san = { current: rU16(), max: rU16() };
    const luck = { current: rU16(), max: rU16() };

    const skillCount = rU8();
    const skills: Record<string, number> = {};
    for (let i = 0; i < skillCount; i++) {
      const idx = rU8();
      // 自定义技能（0xFF）：名字字符串在前，数值在后（与编码顺序一致）
      const skillName = idx === V6_CUSTOM_SKILL ? rStr() : (SKILL_DICT[idx] ?? null);
      const value = rU8();
      if (skillName) skills[skillName] = value;
    }

    let weapons: Weapon[] | undefined;
    if (flags & V6_FLAG_WEAPONS) {
      const count = rU8();
      const list: Weapon[] = [];
      for (let i = 0; i < count; i++) {
        const wname = rStr();
        const wsidx = rU8();
        const wskill = wsidx === V6_CUSTOM_SKILL ? rStr() : (SKILL_DICT[wsidx] ?? '');
        const wtype = rU8() === 1 ? 'ranged' : 'melee';
        const segCount = rU8();
        const damage: Array<{ count: number; sides: number }> = [];
        for (let s = 0; s < segCount; s++) damage.push({ count: rU8(), sides: rU8() });
        const attacks = rU16();
        const multi = rU8() === 1;
        const malRaw = rU16();
        list.push({
          name: wname,
          skill: wskill || '',
          type: wtype,
          damage: damage.length ? damage : [{ count: 1, sides: 3 }],
          attacks: Math.max(1, attacks),
          multi,
          malfunction: malRaw === V6_NO_MALFUNCTION ? null : malRaw,
        });
      }
      if (list.length > 0) weapons = list;
    }

    const story = flags & V6_FLAG_STORY ? rStr() : undefined;
    let backgrounds: Record<string, string> | undefined;
    if (flags & V6_FLAG_BACKGROUNDS) {
      backgrounds = {};
      for (const f of BG_FIELDS) backgrounds[f] = rStr();
    }
    let possessions: string[] | undefined;
    if (flags & V6_FLAG_POSSESSIONS) {
      const count = rU8();
      const list: string[] = [];
      for (let i = 0; i < count; i++) list.push(rStr());
      if (list.length > 0) possessions = list;
    }
    let spells: Spell[] | undefined;
    if (flags & V6_FLAG_SPELLS) {
      const count = rU8();
      const list: Spell[] = [];
      for (let i = 0; i < count; i++) {
        list.push({ name: rStr(), cost: rStr(), effect: rStr(), note: rStr() });
      }
      if (list.length > 0) spells = list;
    }

    return {
      name,
      type,
      plName: '',
      attributes,
      skills,
      hp, mp, san, luck,
      story: story || undefined,
      status: [],
      weapons,
      backgrounds,
      possessions,
      spells,
    } as Omit<CharacterState, 'id'>;
  } catch {
    return null;
  }
}

// ---------- 对外接口 ----------
export async function encodeShareCode(character: CharacterState): Promise<string> {
  return encodeV6(character);
}

export async function decodeShareCode(code: string): Promise<Omit<CharacterState, 'id'>> {
  const cleanCode = code.trim();
  if (!cleanCode.startsWith(SHARE_PREFIX)) {
    throw new Error('无效的分享码格式');
  }

  const encoded = cleanCode.slice(SHARE_PREFIX.length);

  // v6（明文标记 '6' + 二进制 deflate）优先；其余回落旧版 lz-string 格式
  if (encoded.startsWith('6')) {
    const v6 = await decodeV6(encoded.slice(1));
    if (v6) return v6;
    throw new Error('分享码解析失败');
  }

  try {
    // Convert base64url back to standard base64
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    const raw = lzString.decompressFromBase64(padded + padding);
    if (!raw) throw new Error('分享码解析失败');

    const parts = raw.split('\u0001');
    const version = parseInt(parts[0]);

    if (version < 3 || version > SHARE_VERSION) {
      throw new Error(`不支持的分享版本: ${version}`);
    }

    const name = parts[1];
    const type = TYPE_REVERSE[parts[2]] || 'pc';
    // v5 段序：6=story；v3/v4 段序：9=story
    const story = (version >= 5 ? parts[6] : parts[9]) || '';

    // v3/v4：旧格式（数字逗号）；v5：短码格式
    let attributes: Record<string, number>;
    let skills: Record<string, number>;
    let hp: { current: number; max: number };
    let mp: { current: number; max: number };
    let san: { current: number; max: number };
    let luck: { current: number; max: number };
    let weapons: Weapon[] | undefined;

    if (version >= 5) {
      const a = parts[3];
      attributes = {
        '力量': decVal(a, 0), '敏捷': decVal(a, 1), '意志': decVal(a, 2), '体质': decVal(a, 3),
        '外貌': decVal(a, 4), '教育': decVal(a, 5), '体型': decVal(a, 6), '智力': decVal(a, 7),
      };
      skills = {};
      if (parts[4]) {
        for (const item of parts[4].split('|')) {
          const sep = item.indexOf(':');
          if (sep < 0) continue;
          const skillName = decSkillName(item.slice(0, sep));
          const v = decVal(item, sep + 1);
          if (skillName && !(skillName in skills)) skills[skillName] = v;
        }
      }
      const d = parts[5];
      hp = { current: decVal(d, 0), max: decVal(d, 1) };
      mp = { current: decVal(d, 2), max: decVal(d, 3) };
      san = { current: decVal(d, 4), max: decVal(d, 5) };
      luck = { current: decVal(d, 6), max: decVal(d, 7) };
      if (parts[7]) {
        const list = parts[7].split('\u0002').map(decodeWeaponV5).filter((w): w is Weapon => w !== null);
        if (list.length > 0) weapons = list;
      }
    } else {
      const attrArr = parts[3].split(',').map(Number);
      attributes = {
        '力量': attrArr[0], '敏捷': attrArr[1], '意志': attrArr[2], '体质': attrArr[3],
        '外貌': attrArr[4], '教育': attrArr[5], '体型': attrArr[6], '智力': attrArr[7],
      };
      const skillArr = parts[4]
        ? parts[4].split('|').map(pair => {
            const [k, v] = pair.split(':');
            return [k, parseInt(v) || 0] as const;
          })
        : [];
      skills = Object.fromEntries(skillArr);
      const [hpCur, hpMax] = parts[5].split(',').map(Number);
      const [mpCur, mpMax] = parts[6].split(',').map(Number);
      const [sanCur, sanMax] = parts[7].split(',').map(Number);
      const [luckCur, luckMax] = parts[8].split(',').map(Number);
      hp = { current: hpCur, max: hpMax };
      mp = { current: mpCur, max: mpMax };
      san = { current: sanCur, max: sanMax };
      luck = { current: luckCur, max: luckMax };
      if (version >= 4 && parts[10]) {
        const list = parts[10].split('\u0002').map(decodeWeaponV4).filter((w): w is Weapon => w !== null);
        if (list.length > 0) weapons = list;
      }
    }

    return {
      name,
      type,
      plName: '',
      attributes,
      skills,
      hp, mp, san, luck,
      story: story || undefined,
      status: [],
      weapons,
    } as Omit<CharacterState, 'id'>;
  } catch (e) {
    if (e instanceof Error && e.message.includes('分享版本')) throw e;
    throw new Error('分享码解析失败');
  }
}

// 导入身份校验：
// - 怪物只能导入为怪物
// - NPC 只能导入为 NPC
// - PC 可选择以 PC 身份导入（保留人物设定），或以 NPC 身份导入（不带人物设定）
export function validateImportType(originalType: string, importAs: string): boolean {
  if (originalType === 'mob') return importAs === 'mob';
  if (originalType === 'npc') return importAs === 'npc';
  if (originalType === 'pc') return importAs === 'pc' || importAs === 'npc';
  return false;
}
