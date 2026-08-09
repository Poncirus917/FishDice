import type { CharacterState } from '@/app/(single)/page';

const SHARE_PREFIX = 'COC-';
const SHARE_VERSION = 1;

export function encodeShareCode(character: CharacterState): string {
  const shareData = {
    v: SHARE_VERSION,
    n: character.name,
    t: character.type,
    a: character.attributes,
    s: character.skills,
    h: character.hp,
    m: character.mp,
    p: character.san,
    l: character.luck,
    st: character.story,
    av: character.avatar,
  };

  const json = JSON.stringify(shareData);
  const base64 = btoa(unescape(encodeURIComponent(json)));
  return `${SHARE_PREFIX}${base64}`;
}

export function decodeShareCode(code: string): Omit<CharacterState, 'id'> {
  const cleanCode = code.trim();
  if (!cleanCode.startsWith(SHARE_PREFIX)) {
    throw new Error('无效的分享码格式');
  }

  const base64 = cleanCode.slice(SHARE_PREFIX.length);
  try {
    const json = decodeURIComponent(escape(atob(base64)));
    const data = JSON.parse(json);

    if (data.v !== SHARE_VERSION) {
      throw new Error(`不支持的分享版本: ${data.v}`);
    }

    return {
      name: data.n,
      type: data.t,
      plName: '',
      attributes: data.a,
      skills: data.s,
      hp: data.h,
      mp: data.m,
      san: data.p,
      luck: data.l,
      story: data.st,
      avatar: data.av,
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
