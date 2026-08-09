import type { CharacterState } from '@/app/(single)/page';
import lzString from 'lz-string';

const SHARE_PREFIX = 'FD-';
const SHARE_VERSION = 3;

const TYPE_MAP: Record<string, string> = { pc: 'p', npc: 'n', mob: 'm' };
const TYPE_REVERSE: Record<string, 'pc' | 'npc' | 'mob'> = { p: 'pc', n: 'npc', m: 'mob' };

export function encodeShareCode(character: CharacterState): string {
  const coreAttrs = character.attributes;
  const attrArr = [
    coreAttrs['力量'] || 0,
    coreAttrs['敏捷'] || 0,
    coreAttrs['意志'] || 0,
    coreAttrs['体质'] || 0,
    coreAttrs['外貌'] || 0,
    coreAttrs['教育'] || 0,
    coreAttrs['体型'] || 0,
    coreAttrs['智力'] || 0,
  ];

  const typeShort = TYPE_MAP[character.type] || 'p';

  const parts: string[] = [
    String(SHARE_VERSION),
    character.name,
    typeShort,
    attrArr.join(','),
  ];

  // Skills: skip if empty
  const skillEntries = Object.entries(character.skills);
  if (skillEntries.length > 0) {
    parts.push(skillEntries.map(([k, v]) => `${k}:${v}`).join('|'));
  } else {
    parts.push('');
  }

  // Derived stats
  parts.push(`${character.hp.current},${character.hp.max}`);
  parts.push(`${character.mp.current},${character.mp.max}`);
  parts.push(`${character.san.current},${character.san.max}`);
  parts.push(`${character.luck.current},${character.luck.max}`);

  // Story: skip entirely if empty
  if (character.story && character.story.trim()) {
    parts.push(character.story);
  }

  const raw = parts.join('\u0001');
  const compressed = lzString.compressToBase64(raw);
  const urlSafe = compressed.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${SHARE_PREFIX}${urlSafe}`;
}

export function decodeShareCode(code: string): Omit<CharacterState, 'id'> {
  const cleanCode = code.trim();
  if (!cleanCode.startsWith(SHARE_PREFIX)) {
    throw new Error('无效的分享码格式');
  }

  const encoded = cleanCode.slice(SHARE_PREFIX.length);
  try {
    // Convert base64url back to standard base64
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    const raw = lzString.decompressFromBase64(padded + padding);
    if (!raw) throw new Error('分享码解析失败');

    const parts = raw.split('\u0001');
    const version = parseInt(parts[0]);

    if (version !== SHARE_VERSION) {
      throw new Error(`不支持的分享版本: ${version}`);
    }

    const name = parts[1];
    const type = TYPE_REVERSE[parts[2]] || 'pc';
    const attrArr = parts[3].split(',').map(Number);

    const skillArr = parts[4]
      ? parts[4].split('|').map(pair => {
          const [k, v] = pair.split(':');
          return [k, parseInt(v) || 0] as const;
        })
      : [];

    const [hpCur, hpMax] = parts[5].split(',').map(Number);
    const [mpCur, mpMax] = parts[6].split(',').map(Number);
    const [sanCur, sanMax] = parts[7].split(',').map(Number);
    const [luckCur, luckMax] = parts[8].split(',').map(Number);
    const story = parts[9] || '';

    return {
      name,
      type,
      plName: '',
      attributes: {
        '力量': attrArr[0],
        '敏捷': attrArr[1],
        '意志': attrArr[2],
        '体质': attrArr[3],
        '外貌': attrArr[4],
        '教育': attrArr[5],
        '体型': attrArr[6],
        '智力': attrArr[7],
      },
      skills: Object.fromEntries(skillArr),
      hp: { current: hpCur, max: hpMax },
      mp: { current: mpCur, max: mpMax },
      san: { current: sanCur, max: sanMax },
      luck: { current: luckCur, max: luckMax },
      story: story || undefined,
      status: [],
    } as Omit<CharacterState, 'id'>;
  } catch (e) {
    if (e instanceof Error) throw e;
    throw new Error('分享码解析失败');
  }
}

export function validateImportType(originalType: string, importAs: string): boolean {
  if (originalType === 'mob') return importAs === 'mob';
  if (originalType === 'pc' || originalType === 'npc') return importAs === 'npc';
  return false;
}
