"use client";
import { useEffect } from 'react';
import type { CharacterState } from '../../(single)/page';
import { DEFAULT_AVATAR } from '../../lib/constants';
import { calcDBAndBuild } from '../../utils/attributes';
import { BG_FIELDS } from './shareCode';
import type { CardSection, CardSectionsState } from './roomRules';

// 房间内角色卡查看浮窗：点击左侧角色栏的 PC/NPC/怪物打开（仅 KP 可打开 NPC/怪物）。
// 居中弹窗 + 内部滚动（带滚轮）+ 右上角圆形 × 关闭。
// visibleSections：其他 PL 视角的实际可见分区（未提供 = 无限制，KP/本人/自己）。
// kpReveal：KP 视角下当前对玩家隐藏的分区及揭示回调（揭示不可逆，由父组件保证）。
// hiddenForOthers：PL 查看自己的卡时，当前对其他 PL 隐藏的分区（仅橙色小字标注，内容照常完整显示）。
export default function CharacterCardModal({
  character,
  onClose,
  visibleSections,
  kpReveal,
  hiddenForOthers,
}: {
  character: CharacterState;
  onClose: () => void;
  visibleSections?: CardSectionsState;
  kpReveal?: { hiddenFromPlayers: CardSection[]; onReveal: (s: CardSection) => void | Promise<void> };
  hiddenForOthers?: CardSection[];
}) {
  // ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const typeColors = {
    pc: { accent: 'text-cyan-400', border: 'border-cyan-700', badge: 'bg-cyan-600', bg: 'bg-cyan-900/20' },
    npc: { accent: 'text-emerald-400', border: 'border-emerald-700', badge: 'bg-emerald-600', bg: 'bg-emerald-900/20' },
    mob: { accent: 'text-red-400', border: 'border-red-700', badge: 'bg-red-600', bg: 'bg-red-900/20' },
  };
  const colors = typeColors[character.type as keyof typeof typeColors] || typeColors.pc;

  // 当前查看者能否看到某分区
  const canSee = (s: CardSection): boolean => !visibleSections || visibleSections[s] === true;
  // KP 视角：该分区当前是否对玩家隐藏
  const hiddenFromPlayers = (s: CardSection): boolean =>
    !!kpReveal && kpReveal.hiddenFromPlayers.includes(s);

  // KP 视角分区标题行上的“🔒 玩家不可见 · 揭示”控件
  const RevealControl = ({ section }: { section: CardSection }) => {
    if (!hiddenFromPlayers(section)) return null;
    return (
      <span className="ml-auto flex items-center gap-2">
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-400 border border-slate-600">
          🔒 玩家不可见
        </span>
        <button
          onClick={() => kpReveal?.onReveal(section)}
          title="揭示后该分区将永久对其他 PL 可见"
          className="text-[10px] px-2.5 py-0.5 rounded-full bg-orange-700 hover:bg-orange-600 text-white font-bold transition"
        >
          揭示给玩家
        </button>
      </span>
    );
  };

  // PL 查看自己的卡：对其他 PL 隐藏的分区标题处用橙色小字标注（与 KP 的揭示控件互斥，不会同时出现）
  const HiddenForOthersMarker = ({ section }: { section: CardSection }) => {
    if (!hiddenForOthers?.includes(section)) return null;
    return (
      <span className="ml-auto text-orange-400 text-[10px] font-bold">
        🔒 其他玩家不可见
      </span>
    );
  };

  const coreAttrs = ['力量', '敏捷', '意志', '体质', '外貌', '教育', '体型', '智力'];
  const derivedDBBuild = calcDBAndBuild(
    character.attributes?.['力量'] || 0,
    character.attributes?.['体型'] || 0
  );
  const skillEntries = Object.entries(character.skills || {});
  // 怪物不使用武器/法术
  const weapons = character.type !== 'mob' ? (character.weapons || []) : [];
  const spells = character.type !== 'mob' ? (character.spells || []) : [];
  const backgrounds = character.type === 'pc' ? character.backgrounds : undefined;
  const possessions = character.type === 'pc' ? (character.possessions || []) : [];

  // 背景/随身物品两列的可见性
  const showBgCol = character.type === 'pc' && canSee('backgrounds');
  const showPosCol = character.type === 'pc' && canSee('possessions');

  const statusBars = [
    { label: 'HP', cur: character.hp?.current || 0, max: character.hp?.max || 0, text: 'text-red-400', bar: 'bg-red-500' },
    { label: 'MP', cur: character.mp?.current || 0, max: character.mp?.max || 0, text: 'text-blue-400', bar: 'bg-blue-500' },
    { label: 'SAN', cur: character.san?.current || 0, max: character.san?.max || 99, text: 'text-emerald-400', bar: 'bg-emerald-500' },
    { label: 'LUCK', cur: character.luck?.current || 0, max: character.luck?.max || 99, text: 'text-amber-400', bar: 'bg-amber-500' },
  ];

  const formatDamage = (w: NonNullable<CharacterState['weapons']>[number]) => {
    const dbType = w.dbType ?? (w.type === 'melee' ? 'full' : 'none');
    const parts = w.damage.map(d => d.bonus ? `${d.count}D${d.sides}+${d.bonus}` : `${d.count}D${d.sides}`);
    if (dbType === 'full') parts.push('DB');
    else if (dbType === 'half') parts.push('0.5DB');
    const se = w.statusEffect ?? 'none';
    if (se === 'burn') parts.push('🔥');
    else if (se === 'stun') parts.push('💫');
    else if (se === 'burn_stun') parts.push('🔥💫');
    return parts.join('+');
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div className="relative w-[92%] max-w-3xl" onClick={e => e.stopPropagation()}>
        {/* 右上角圆形关闭按钮（固定于浮窗，不随内容滚动） */}
        <button
          onClick={onClose}
          title="关闭"
          className="absolute -top-2 -right-2 z-20 w-9 h-9 rounded-full bg-slate-800 border border-slate-600 text-slate-300 hover:text-white hover:bg-red-600 hover:border-red-500 flex items-center justify-center text-lg font-bold transition shadow-lg"
        >
          ×
        </button>

        <div className="max-h-[85vh] overflow-y-auto bg-slate-800 rounded-2xl shadow-2xl border border-slate-700">
          {/* 头部色带：头像 + 名称（+ 角色故事，故事隐藏时不显示右侧栏） */}
          <div className={`${colors.bg} p-6 flex flex-col md:flex-row gap-6`}>
            <div className="flex flex-col items-center shrink-0">
              <div className={`w-24 h-24 rounded-2xl ${colors.badge} flex items-center justify-center text-4xl font-bold overflow-hidden border-4 ${colors.border}`}>
                <img src={character.avatar || DEFAULT_AVATAR} alt={character.name} className="w-full h-full object-cover" />
              </div>
              <div className={`mt-3 px-3 py-1 rounded-lg ${colors.badge} text-white text-xs font-bold`}>
                {character.type === 'mob' ? '怪物' : character.type === 'npc' ? 'NPC' : 'PC'}
              </div>
              <div className="mt-2 text-center">
                <div className="text-lg font-bold text-white">{character.name}</div>
                <div className="text-xs text-slate-400 mt-1">
                  {character.type === 'pc' ? `PL: ${character.plName || '未知'}` : character.type === 'npc' ? 'NPC角色' : ''}
                </div>
              </div>
            </div>

            {/* 角色故事分区 */}
            {canSee('story') && (
              <div className="flex-1 min-w-0">
                <div className="flex items-center mb-2">
                  <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider">角色故事</h4>
                  <RevealControl section="story" />
                  <HiddenForOthersMarker section="story" />
                </div>
                <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-4 min-h-[100px] text-slate-300 whitespace-pre-wrap leading-relaxed">
                  {character.story || <span className="text-slate-600 italic">暂无角色故事</span>}
                </div>
              </div>
            )}
          </div>

          {/* 调查员背景 + 随身物品：仅 PC，按各自分区可见性显示列 */}
          {(showBgCol || showPosCol) && (
            <div className={`${colors.bg} px-6 pb-6 grid grid-cols-1 ${showBgCol && showPosCol ? 'md:grid-cols-2' : ''} gap-6`}>
              {/* 左：调查员背景 8 栏 */}
              {showBgCol && (
                <div className="space-y-3">
                  <div className="flex items-center">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">角色设定</span>
                    <RevealControl section="backgrounds" />
                    <HiddenForOthersMarker section="backgrounds" />
                  </div>
                  {BG_FIELDS.map(field => (
                    <div key={field}>
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">
                        {field}
                      </label>
                      <div className="bg-slate-900/50 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-300 whitespace-pre-wrap leading-relaxed min-h-[38px]">
                        {backgrounds?.[field] || <span className="text-slate-600 italic">未填写</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 右：随身物品 */}
              {showPosCol && (
                <div>
                  <div className="flex items-center mb-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                      随身物品
                    </label>
                    <RevealControl section="possessions" />
                    <HiddenForOthersMarker section="possessions" />
                  </div>
                  {possessions.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-700 px-3 py-4 text-center text-xs text-slate-600 italic">
                      暂无随身物品
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {possessions.map((p, i) => (
                        <div key={i} className="flex items-start gap-1.5">
                          <span className="text-slate-600 text-[10px] w-5 text-right flex-shrink-0 mt-1.5">{i + 1}.</span>
                          <div className="flex-1 bg-slate-900/50 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 whitespace-pre-wrap">
                            {p}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 核心数值分区：状态条 + 8 属性 */}
          {canSee('core') && (
            <div className="p-6 space-y-6">
              <div className="flex items-center">
                <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider">状态</h4>
                <RevealControl section="core" />
                <HiddenForOthersMarker section="core" />
              </div>

              {/* HP/MP/SAN/LUCK 状态条 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {statusBars.map(s => {
                  const pct = s.max > 0 ? Math.max(0, Math.min(100, (s.cur / s.max) * 100)) : 0;
                  return (
                    <div key={s.label} className="bg-slate-900/70 border border-slate-700 rounded-xl p-3 text-center">
                      <div className="text-xs font-bold text-slate-500">{s.label}</div>
                      <div className={`text-lg font-bold ${s.text}`}>
                        {s.cur}<span className="text-xs text-slate-500"> / {s.max}</span>
                      </div>
                      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mt-2">
                        <div className={`h-full ${s.bar}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 8 项属性 + 伤害加值/体格 */}
              <div>
                <h4 className="text-sm font-bold text-slate-400 mb-3 uppercase tracking-wider">核心数值</h4>
                <div className="grid grid-cols-4 sm:grid-cols-5 gap-3">
                  {coreAttrs.map(attr => (
                    <div key={attr} className="p-3 rounded-xl border text-center bg-slate-900/70 border-slate-700">
                      <div className="text-xs font-bold mb-1 text-slate-500">{attr}</div>
                      <div className="text-lg font-bold text-slate-100">{character.attributes?.[attr] || 0}</div>
                    </div>
                  ))}
                  <div className="p-3 rounded-xl border text-center bg-slate-900 border-slate-600">
                    <div className="text-xs font-bold mb-1 text-cyan-400">伤害加值</div>
                    <div className="text-lg font-bold text-cyan-400">{derivedDBBuild ? derivedDBBuild.db : '—'}</div>
                  </div>
                  <div className="p-3 rounded-xl border text-center bg-slate-900 border-slate-600">
                    <div className="text-xs font-bold mb-1 text-cyan-400">体格</div>
                    <div className="text-lg font-bold text-cyan-400">{derivedDBBuild ? derivedDBBuild.build : '—'}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 技能分区 */}
          {canSee('skills') && skillEntries.length > 0 && (
            <div className="px-6 pb-6">
              <div className="flex items-center mb-3">
                <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider">技能</h4>
                <RevealControl section="skills" />
                <HiddenForOthersMarker section="skills" />
              </div>
              <div className="flex flex-wrap gap-2">
                {skillEntries.map(([s, v]) => {
                  const isCthulhu = s === '克苏鲁神话';
                  return (
                    <div
                      key={s}
                      className={`flex items-center gap-1 px-3 py-1.5 border rounded-lg text-sm ${
                        isCthulhu
                          ? 'bg-green-900/40 border-green-700 text-orange-400 font-serif italic'
                          : 'bg-slate-900 border-slate-700 text-slate-300'
                      }`}
                    >
                      <span className={isCthulhu ? 'font-black' : 'font-medium'}>{s}</span>
                      <span className={`ml-1 font-bold ${isCthulhu ? 'text-orange-400' : 'text-cyan-400'}`}>{v}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 武器分区（怪物无武器） */}
          {canSee('weapons') && character.type !== 'mob' && weapons.length > 0 && (
            <div className="px-6 pb-6">
              <div className="flex items-center mb-3">
                <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider">武器</h4>
                <RevealControl section="weapons" />
                <HiddenForOthersMarker section="weapons" />
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-700">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-900/70 text-slate-500 text-xs">
                      <th className="px-3 py-2 text-left font-bold">武器名称</th>
                      <th className="px-3 py-2 text-left font-bold">使用技能</th>
                      <th className="px-3 py-2 text-left font-bold">伤害</th>
                      <th className="px-3 py-2 text-center font-bold">次数</th>
                      <th className="px-3 py-2 text-center font-bold">故障值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weapons.map((w, i) => (
                      <tr key={i} className="border-t border-slate-800">
                        <td className="px-3 py-2 font-medium text-slate-200">{w.name}</td>
                        <td className="px-3 py-2 text-slate-400">{w.skill}</td>
                        <td className="px-3 py-2 text-cyan-400 font-bold">
                          {formatDamage(w)}{w.multi ? ' ×多' : ''}
                        </td>
                        <td className="px-3 py-2 text-center text-slate-300">{w.attacks}</td>
                        <td className="px-3 py-2 text-center text-slate-400">{w.malfunction ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 法术分区（怪物无法术） */}
          {canSee('spells') && character.type !== 'mob' && spells.length > 0 && (
            <div className="px-6 pb-6">
              <div className="flex items-center mb-3">
                <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider">法术</h4>
                <RevealControl section="spells" />
                <HiddenForOthersMarker section="spells" />
              </div>
              <div className="space-y-2">
                {spells.map((sp, i) => (
                  <div key={i} className="bg-slate-900/50 border border-slate-700 rounded-xl px-4 py-3">
                    <div className="font-bold text-purple-300">{sp.name}</div>
                    <div className="text-xs text-slate-400 mt-1 space-y-0.5">
                      {sp.cost && <div>代价：{sp.cost}</div>}
                      {sp.effect && <div>作用：{sp.effect}</div>}
                      {sp.note && <div>备注：{sp.note}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
