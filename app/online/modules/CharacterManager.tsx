"use client";
import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import Swal from 'sweetalert2';
import ImportView from './ImportView';
import AvatarCropper from './AvatarCropper';
import { encodeShareCode, BG_FIELDS } from './shareCode';
import { CharacterState, Weapon, WeaponDicePart, Spell } from '../../(single)/page';
import { supabase } from '../../lib/supabase';
import { DEFAULT_AVATAR } from '../../lib/constants';
import { calcDBAndBuild } from '../../utils/attributes';

type SidebarTab = 'create' | 'pc' | 'npc' | 'mob';

const ATTRIBUTE_NAMES = ['力量', '敏捷', '意志', '体质', '外貌', '教育', '体型', '智力', '幸运'];

// 默认武器"肉搏"：所有角色自带，不可删除
const DEFAULT_FIGHT_WEAPON: Weapon = {
  name: '肉搏',
  skill: '斗殴',
  type: 'melee',
  damage: [{ count: 1, sides: 3 }],
  dbType: 'full',
  statusEffect: 'none',
  attacks: 1,
  multi: false,
  malfunction: null,
};

// DB / 状态效果下拉选项
const DB_OPTIONS = [
  { value: 'none', label: '无 DB' },
  { value: 'half', label: '0.5DB' },
  { value: 'full', label: '1DB' },
];
const STATUS_OPTIONS = [
  { value: 'none', label: '无' },
  { value: 'burn', label: '燃烧' },
  { value: 'stun', label: '眩晕' },
  { value: 'burn_stun', label: '燃烧+眩晕' },
] as const;

// 武器伤害骰子的可选面数
const DICE_SIDES_OPTIONS = [3, 4, 6, 8, 10, 12, 20, 100];

// 随身物品行数上限
const POSSESSIONS_LIMIT = 20;

// 格式化武器伤害为展示字符串
const formatWeaponDamage = (w: Weapon): string => {
  // 向后兼容：旧数据未填 dbType 时 melee→full, ranged→none
  const dbType = w.dbType ?? (w.type === 'melee' ? 'full' : 'none');
  const parts = w.damage.map(d => d.bonus ? `${d.count}D${d.sides}+${d.bonus}` : `${d.count}D${d.sides}`);
  if (dbType === 'full') parts.push('DB');
  else if (dbType === 'half') parts.push('0.5DB');
  let text = parts.join('+');
  // 状态效果后缀
  const se = w.statusEffect ?? 'none';
  if (se === 'burn') text += ' 🔥';
  else if (se === 'stun') text += ' 💫';
  else if (se === 'burn_stun') text += ' 🔥💫';
  return text;
};

// 技能模糊匹配输入：只能选择 options 中存在的技能；输入文字后才显示候选（向上展开）
function SkillAutocomplete({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasInput = value.trim() !== '';
  const filtered = options.filter(s => s.toLowerCase().includes(value.trim().toLowerCase()));
  const invalid = hasInput && !options.includes(value.trim());
  const showList = open && hasInput && filtered.length > 0;

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        placeholder="输入或选择技能"
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => { if (value.trim() !== '') setOpen(true); }}
        onBlur={() => setOpen(false)}
        className={`w-full bg-slate-900 border rounded-lg px-2 py-1.5 text-xs outline-none text-slate-100 placeholder-slate-600 ${
          invalid ? 'border-red-600' : 'border-slate-700 focus:border-cyan-500'
        }`}
      />
      {showList && (
        <div className="absolute z-20 left-0 right-0 bottom-full mb-1 max-h-40 overflow-y-auto bg-slate-900 border border-slate-700 rounded-lg shadow-xl">
          {filtered.map(s => (
            <div
              key={s}
              onMouseDown={e => { e.preventDefault(); onChange(s); setOpen(false); }}
              className="px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
            >
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CharacterManager({ userId }: { userId: string }) {
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('pc');
  const [characters, setCharacters] = useState<CharacterState[]>([]);
  const [loaded, setLoaded] = useState(false);
  const rowIdMap = useRef<Map<string, number>>(new Map());
  const [displayName, setDisplayName] = useState("");
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);

  useEffect(() => {
    const name = localStorage.getItem('fish_display_name') || '';
    setDisplayName(name);
  }, []);

  useEffect(() => {
    supabase
      .from('characters')
      .select('id, data')
      .eq('owner_id', userId)
      .then(({ data, error }) => {
        if (error) {
          toast.error('加载角色数据失败');
          setLoaded(true);
          return;
        }
        if (data) {
          const list: CharacterState[] = [];
          data.forEach((row: any) => {
            const char = row.data as CharacterState;
            list.push(char);
            rowIdMap.current.set(char.id, row.id);
          });
          setCharacters(list);
        }
        setLoaded(true);
      });
  }, [userId]);

  const handleAddCharacter = useCallback(async (newChar: CharacterState) => {
    setCharacters(prev => [...prev, newChar]);
    try {
      const { data, error } = await supabase
        .from('characters')
        .insert({ owner_id: userId, data: newChar })
        .select('id')
        .single();

      if (error) {
        console.error('保存角色失败:', error);
        toast.error(`保存到服务器失败: ${error.message || '未知错误'}`);
      } else if (data) {
        rowIdMap.current.set(newChar.id, data.id);
      }
    } catch {
      toast.error('网络错误，角色仅保存在本地');
    }
  }, [userId]);

  const updateCharacter = useCallback((updated: CharacterState) => {
    setCharacters(prev => prev.map(c => c.id === updated.id ? updated : c));
    const rowId = rowIdMap.current.get(updated.id);
    if (rowId) {
      supabase.from('characters').update({ data: updated, updated_at: new Date().toISOString() })
        .eq('id', rowId).then();
    }
  }, []);

  const deleteCharacter = useCallback((id: string) => {
    setCharacters(prev => prev.filter(c => c.id !== id));
    const rowId = rowIdMap.current.get(id);
    if (rowId) {
      supabase.from('characters').delete().eq('id', rowId)
        .then(() => rowIdMap.current.delete(id));
    }
  }, []);

  const handleDeleteClick = useCallback((id: string) => {
    Swal.fire({
      title: "确定要删除吗？",
      text: "删除后将无法恢复该角色数据！",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#64748b",
      confirmButtonText: "确定删除",
      cancelButtonText: "取消",
      reverseButtons: true
    }).then((result) => {
      if (result.isConfirmed) {
        deleteCharacter(id);
        if (selectedCharacterId === id) setSelectedCharacterId(null);
        Swal.fire({
          icon: 'success',
          title: '角色已删除',
          toast: true,
          position: 'top-end',
          showConfirmButton: false,
          timer: 2000,
        });
      }
    });
  }, [deleteCharacter, selectedCharacterId]);

  const wrappedSetCharacters: React.Dispatch<React.SetStateAction<CharacterState[]>> = useCallback(
    (updater) => {
      setCharacters(prev => {
        const next = typeof updater === 'function' ? updater(prev) : updater;

        prev.forEach(p => {
          if (!next.find(n => n.id === p.id)) {
            const rowId = rowIdMap.current.get(p.id);
            if (rowId) {
              supabase.from('characters').delete().eq('id', rowId)
                .then(() => rowIdMap.current.delete(p.id));
            }
          }
        });

        next.forEach(n => {
          const old = prev.find(p => p.id === n.id);
          if (old && JSON.stringify(old) !== JSON.stringify(n)) {
            const rowId = rowIdMap.current.get(n.id);
            if (rowId) {
              supabase.from('characters').update({ data: n, updated_at: new Date().toISOString() })
                .eq('id', rowId).then();
            }
          }
        });

        return next;
      });
    },
    []
  );

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-cyan-400 animate-pulse text-sm tracking-widest">LOADING...</div>
      </div>
    );
  }

  const filteredCharacters = characters.filter(c => c.type === sidebarTab);

  const handleSidebarNav = (tab: SidebarTab) => {
    setSidebarTab(tab);
    setSelectedCharacterId(null);
  };

  const selectedCharacter = selectedCharacterId 
    ? characters.find(c => c.id === selectedCharacterId) || null 
    : null;

  return (
    <div className="flex min-h-screen bg-slate-900 text-white">
      {/* 左侧侧边栏 */}
      <aside className="w-56 bg-slate-800 border-r border-slate-700 flex flex-col">
        <div className="p-4 border-b border-slate-700">
          <h2 className="font-bold text-lg text-cyan-400">角色管理</h2>
          <p className="text-xs text-slate-500 mt-1">创建和管理你的角色</p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          <SidebarButton
            icon="➕"
            label="创建角色"
            active={sidebarTab === 'create'}
            onClick={() => handleSidebarNav('create')}
          />
          <SidebarButton
            icon="👤"
            label={`调查员 (${characters.filter(c => c.type === 'pc').length})`}
            active={sidebarTab === 'pc'}
            onClick={() => handleSidebarNav('pc')}
          />
          <SidebarButton
            icon="🧙"
            label={`NPC (${characters.filter(c => c.type === 'npc').length})`}
            active={sidebarTab === 'npc'}
            onClick={() => handleSidebarNav('npc')}
          />
          <SidebarButton
            icon="👹"
            label={`怪物 (${characters.filter(c => c.type === 'mob').length})`}
            active={sidebarTab === 'mob'}
            onClick={() => handleSidebarNav('mob')}
          />
        </nav>
      </aside>

      {/* 右侧内容区 */}
      <main className="flex-1 overflow-y-auto p-8">
        {sidebarTab === 'create' && (
          <div className="max-w-4xl mx-auto">
            <ImportView
              onConfirm={handleAddCharacter}
              characters={characters}
              setCharacters={wrappedSetCharacters}
              userDisplayName={displayName}
            />
          </div>
        )}

        {sidebarTab !== 'create' && selectedCharacter && (
          <CharacterDetailView
            character={selectedCharacter}
            onBack={() => setSelectedCharacterId(null)}
            onUpdate={updateCharacter}
            onDelete={handleDeleteClick}
          />
        )}

        {sidebarTab !== 'create' && !selectedCharacter && (
          <CharacterGrid
            characters={filteredCharacters}
            typeLabel={
              sidebarTab === 'pc' ? '调查员' :
              sidebarTab === 'npc' ? 'NPC' : '怪物'
            }
            onSelect={(id) => setSelectedCharacterId(id)}
          />
        )}
      </main>
    </div>
  );
}

function SidebarButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ${
        active
          ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-900/30'
          : 'text-slate-400 hover:bg-slate-700 hover:text-white'
      }`}
    >
      <span className="text-lg">{icon}</span>
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

function CharacterGrid({
  characters,
  typeLabel,
  onSelect,
}: {
  characters: CharacterState[];
  typeLabel: string;
  onSelect: (id: string) => void;
}) {
  if (characters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="text-6xl mb-4">📭</div>
        <h3 className="text-xl font-bold text-slate-400 mb-2">暂无{typeLabel}</h3>
        <p className="text-slate-500">点击左侧"创建角色"来创建新的{typeLabel}</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
        <span>{typeLabel}列表</span>
        <span className="text-sm text-slate-500 font-normal">({characters.length})</span>
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {characters.map((char) => (
          <CharacterCard key={char.id} character={char} onClick={() => onSelect(char.id)} />
        ))}
      </div>
    </div>
  );
}

function CharacterCard({ character, onClick }: { character: CharacterState; onClick: () => void }) {
  const typeColors = {
    pc: { bg: 'bg-cyan-900/30', border: 'border-cyan-700', text: 'text-cyan-400', badge: 'bg-cyan-600' },
    npc: { bg: 'bg-emerald-900/30', border: 'border-emerald-700', text: 'text-emerald-400', badge: 'bg-emerald-600' },
    mob: { bg: 'bg-red-900/30', border: 'border-red-700', text: 'text-red-400', badge: 'bg-red-600' },
  };
  const colors = typeColors[character.type as keyof typeof typeColors] || typeColors.pc;

  return (
    <div 
      onClick={onClick}
      className={`bg-slate-800 rounded-2xl border ${colors.border} overflow-hidden hover:border-cyan-600 transition-all hover:shadow-lg hover:shadow-slate-900/30 cursor-pointer`}
    >
      {/* 顶部：头像 + 姓名 */}
      <div className={`${colors.bg} p-4 flex items-center gap-4 ${character.type === 'mob' ? '' : 'border-b border-slate-700'}`}>
        <div className={`w-16 h-16 rounded-xl ${colors.badge} flex items-center justify-center text-2xl font-bold overflow-hidden border-2 ${colors.border}`}>
          <img src={character.avatar || DEFAULT_AVATAR} alt={character.name} className="w-full h-full object-cover" />
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-lg text-white">{character.name}</h3>
        </div>
        <div className={`${colors.badge} px-2 py-1 rounded text-xs font-bold text-white`}>
          {character.type === 'mob' ? '怪物' : character.type === 'npc' ? 'NPC' : 'PC'}
        </div>
      </div>

      {/* 九项基本数值（仅PC和NPC显示） */}
      {character.type !== 'mob' && (
        <div className="p-4 grid grid-cols-3 gap-3">
          {ATTRIBUTE_NAMES.map(attr => (
            <div
              key={attr}
              className="bg-slate-900/50 rounded-xl p-3 text-center border border-slate-700/50"
            >
              <div className="text-xs text-slate-500 mb-1">{attr}</div>
              <div className={`text-lg font-bold ${colors.text}`}>
                {attr === '幸运' ? (character.luck?.current ?? 0) : (character.attributes[attr] || 0)}
              </div>
            </div>
          ))}

          {/* 伤害加值 / 体格：自动计算展示 */}
          {(() => {
            const dbBuild = calcDBAndBuild(character.attributes['力量'] || 0, character.attributes['体型'] || 0);
            if (!dbBuild) return null;
            return (
              <>
                <div className="bg-slate-900/50 rounded-xl p-3 text-center border border-slate-700/50">
                  <div className="text-xs text-slate-500 mb-1">伤害加值</div>
                  <div className={`text-lg font-bold ${colors.text}`}>{dbBuild.db}</div>
                </div>
                <div className="bg-slate-900/50 rounded-xl p-3 text-center border border-slate-700/50">
                  <div className="text-xs text-slate-500 mb-1">体格</div>
                  <div className={`text-lg font-bold ${colors.text}`}>{dbBuild.build}</div>
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function CharacterDetailView({
  character,
  onBack,
  onUpdate,
  onDelete,
}: {
  character: CharacterState;
  onBack: () => void;
  onUpdate: (updated: CharacterState) => void;
  onDelete: (id: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(character.name);
  const [editStory, setEditStory] = useState(character.story || "");
  const [editTempSkills, setEditTempSkills] = useState<Record<string, number>>({
    ...character.attributes,
    ...character.skills
  });
  const [editAvatar, setEditAvatar] = useState<string | null>(character.avatar || null);
  const [cropperSrc, setCropperSrc] = useState<string | null>(null);
  const avatarFileRef = useRef<HTMLInputElement>(null);
  const [newSkillName, setNewSkillName] = useState("");
  const [newSkillValue, setNewSkillValue] = useState<number>(0);
  // 武器编辑（老角色无 weapons 时初始化为默认"肉搏"）
  const [editWeapons, setEditWeapons] = useState<Weapon[]>([]);
  // 调查员背景 8 栏编辑
  const [editBackgrounds, setEditBackgrounds] = useState<Record<string, string>>({});
  // 随身物品编辑（上限 20 行）
  const [editPossessions, setEditPossessions] = useState<string[]>([]);
  // 法术编辑
  const [editSpells, setEditSpells] = useState<Spell[]>([]);

  const typeColors = {
    pc: { accent: 'text-cyan-400', border: 'border-cyan-700', badge: 'bg-cyan-600', bg: 'bg-cyan-900/20', button: 'bg-cyan-700 hover:bg-cyan-600' },
    npc: { accent: 'text-emerald-400', border: 'border-emerald-700', badge: 'bg-emerald-600', bg: 'bg-emerald-900/20', button: 'bg-emerald-700 hover:bg-emerald-600' },
    mob: { accent: 'text-red-400', border: 'border-red-700', badge: 'bg-red-600', bg: 'bg-red-900/20', button: 'bg-red-700 hover:bg-red-600' },
  };
  const colors = typeColors[character.type as keyof typeof typeColors] || typeColors.pc;

  const clamp = (val: number, type?: string) => {
    const max = type === 'mob' ? 9999 : 99; 
    return Math.min(Math.max(val, 0), max);
  };

  const derivedHP = Math.floor(((editTempSkills["体质"] || 0) + (editTempSkills["体型"] || 0)) / 10);
  const derivedMP = Math.floor((editTempSkills["意志"] || 0) / 5);
  const derivedSAN = editTempSkills["意志"] || 0;
  // 伤害加值 / 体格：由力量+体型自动计算，编辑时实时刷新
  const derivedDBBuild = calcDBAndBuild(
    (isEditing ? editTempSkills["力量"] : character.attributes["力量"]) || 0,
    (isEditing ? editTempSkills["体型"] : character.attributes["体型"]) || 0
  );

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      Swal.fire({ icon: 'error', title: '文件过大', text: '头像图片不能超过 5MB' });
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => setCropperSrc(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleCropperConfirm = (croppedDataUrl: string) => {
    setEditAvatar(croppedDataUrl);
    setCropperSrc(null);
  };

  const handleAddNewSkill = () => {
    const trimmedName = newSkillName.trim();
    if (!trimmedName) return;

    if (editTempSkills.hasOwnProperty(trimmedName)) {
      Swal.fire({
        title: "技能已存在",
        text: `"${trimmedName}" 已在列表中，请直接修改数值。`,
        icon: "info",
        confirmButtonText: "知道了"
      });
      return;
    }

    setEditTempSkills(prev => ({
      ...prev,
      [trimmedName]: clamp(newSkillValue, character.type)
    }));
    setNewSkillName("");
    setNewSkillValue(0);
  };

  const handleDeleteSkill = (skillName: string) => {
    const { [skillName]: _, ...rest } = editTempSkills;
    setEditTempSkills(rest);
  };

  // ---------- 武器编辑 ----------
  const updateWeapon = (index: number, patch: Partial<Weapon>) => {
    setEditWeapons(prev => prev.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  };
  const updateWeaponDice = (wIndex: number, dIndex: number, patch: Partial<WeaponDicePart>) => {
    setEditWeapons(prev => prev.map((w, i) => {
      if (i !== wIndex) return w;
      return { ...w, damage: w.damage.map((d, j) => (j === dIndex ? { ...d, ...patch } : d)) };
    }));
  };
  const addWeaponDice = (wIndex: number) => {
    setEditWeapons(prev => prev.map((w, i) => (
      i === wIndex && w.damage.length < 3
        ? { ...w, damage: [...w.damage, { count: 1, sides: 6 }] }
        : w
    )));
  };
  const removeWeaponDice = (wIndex: number, dIndex: number) => {
    setEditWeapons(prev => prev.map((w, i) => (
      i === wIndex ? { ...w, damage: w.damage.filter((_, j) => j !== dIndex) } : w
    )));
  };
  const addWeapon = () => {
    setEditWeapons(prev => prev.length < 6 ? [...prev, {
      name: '', skill: '', type: 'melee', damage: [{ count: 1, sides: 6 }],
      attacks: 1, multi: false, malfunction: null,
    }] : prev);
  };
  const removeWeapon = (index: number) => {
    setEditWeapons(prev => prev.filter((_, i) => i !== index));
  };

  // ---------- 背景栏 / 随身物品 / 法术编辑 ----------
  const updateBackground = (field: string, value: string) =>
    setEditBackgrounds(prev => ({ ...prev, [field]: value }));

  const updatePossession = (index: number, value: string) =>
    setEditPossessions(prev => prev.map((p, i) => (i === index ? value : p)));
  const addPossession = () =>
    setEditPossessions(prev => (prev.length < POSSESSIONS_LIMIT ? [...prev, ''] : prev));
  const removePossession = (index: number) =>
    setEditPossessions(prev => prev.filter((_, i) => i !== index));

  const updateSpell = (index: number, patch: Partial<Spell>) =>
    setEditSpells(prev => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const addSpell = () =>
    setEditSpells(prev => [...prev, { name: '', cost: '', effect: '', note: '' }]);
  const removeSpell = (index: number) =>
    setEditSpells(prev => prev.filter((_, i) => i !== index));

  const handleExport = async () => {
    try {
      const code = await encodeShareCode(character);
      Swal.fire({
        title: "分享角色",
        html: `
          <div class="text-left text-sm text-slate-600 mb-3">
            将此分享码发给好友，他们可以导入该角色。<br/>
            <span class="text-amber-600 font-bold">注意：</span> PC 可由好友选择以 PC 或 NPC 身份导入；NPC/怪物导入后保持原身份。
          </div>
          <textarea id="share-code" class="w-full p-3 border-2 border-slate-300 rounded-xl text-xs font-mono bg-slate-50 text-slate-800 select-all" rows="4" readonly>${code}</textarea>
        `,
        showConfirmButton: true,
        confirmButtonText: "复制分享码",
        cancelButtonText: "关闭",
        confirmButtonColor: '#0891b2',
        preConfirm: () => {
          const textarea = document.getElementById('share-code') as HTMLTextAreaElement;
          if (textarea) {
            textarea.select();
            document.execCommand('copy');
          }
        }
      }).then((result) => {
        if (result.isConfirmed) {
          toast.success('分享码已复制到剪贴板');
        }
      });
    } catch {
      toast.error('生成分享码失败');
    }
  };

  const handleSave = () => {
    Swal.fire({
      title: "保存修改？",
      text: "确认保存对该角色的修改？",
      icon: "question",
      showCancelButton: true,
      confirmButtonColor: "#0891b2",
      cancelButtonColor: "#64748b",
      confirmButtonText: "保存",
      cancelButtonText: "取消",
      reverseButtons: true
    }).then((result) => {
      if (!result.isConfirmed) return;

      // 武器校验：名称非空、伤害至少一段、使用技能必须在技能列表中（默认武器"肉搏"除外）
      const skillKeys = Object.keys(editTempSkills).filter(k => !allAttrs.includes(k));
      for (let i = 1; i < editWeapons.length; i++) {
        const w = editWeapons[i];
        if (!w.name.trim()) {
          Swal.fire({ icon: 'error', title: '武器名称不能为空', text: `第 ${i + 1} 行武器缺少名称。` });
          return;
        }
        if (!w.damage || w.damage.length === 0) {
          Swal.fire({ icon: 'error', title: '武器伤害不能为空', text: `武器「${w.name}」至少需要一段伤害骰子。` });
          return;
        }
        if (!skillKeys.includes(w.skill.trim())) {
          Swal.fire({
            icon: 'error',
            title: '使用技能不存在',
            text: `武器「${w.name}」的使用技能「${w.skill || '空'}」不在技能列表中，请修改。`,
          });
          return;
        }
      }

      // 法术校验：法术名称不可为空
      for (let i = 0; i < editSpells.length; i++) {
        if (!editSpells[i].name.trim()) {
          Swal.fire({ icon: 'error', title: '法术名称不能为空', text: `第 ${i + 1} 行法术缺少名称。` });
          return;
        }
      }

      const con = clamp(editTempSkills["体质"] || 0);
      const siz = clamp(editTempSkills["体型"] || 0);
      const pow = clamp(editTempSkills["意志"] || 0);
      const isMob = character.type === 'mob';

      const finalHP = isMob
        ? clamp(editTempSkills["体力（HP）"] || 0)
        : Math.floor((con + siz) / 10);
      const finalMP = isMob
        ? clamp(editTempSkills["魔法（MP）"] || 0)
        : Math.floor(pow / 5);

      // 第一行强制为默认武器"肉搏"（不可删除、不可修改）
      const finalWeapons: Weapon[] = editWeapons.length
        ? editWeapons.map((w, i) => (i === 0 ? { ...DEFAULT_FIGHT_WEAPON } : w))
        : [DEFAULT_FIGHT_WEAPON];

      const updated: CharacterState = {
        ...character,
        name: editName || character.name,
        story: editStory || undefined,
        avatar: editAvatar || undefined,
        hp: { current: finalHP, max: finalHP },
        mp: { current: finalMP, max: finalMP },
        san: { current: isMob ? clamp(editTempSkills["理智"] || 0) : pow, max: 99 },
        luck: { current: clamp(editTempSkills["幸运"] || 0), max: 99 },
        skills: Object.fromEntries(
          Object.entries(editTempSkills)
            .filter(([k]) => !allAttrs.includes(k))
            .map(([k, v]) => [k, clamp(v)])
        ),
        attributes: {
          "力量": clamp(editTempSkills["力量"] || 0),
          "敏捷": clamp(editTempSkills["敏捷"] || 0),
          "意志": pow,
          "体质": con,
          "外貌": clamp(editTempSkills["外貌"] || 0),
          "教育": clamp(editTempSkills["教育"] || 0),
          "体型": siz,
          "智力": clamp(editTempSkills["智力"] || 0),
        },
        // 怪物不使用武器/法术，PC 专属人物设定；非对应类型保存时清除
        ...(character.type !== 'mob'
          ? { weapons: finalWeapons, spells: editSpells.map(s => ({ ...s, name: s.name.trim() })).filter(s => s.name !== '') }
          : { weapons: undefined, spells: undefined }),
        ...(character.type === 'pc'
          ? { backgrounds: editBackgrounds, possessions: editPossessions.map(p => p.trim()).filter(p => p !== '') }
          : { backgrounds: undefined, possessions: undefined }),
      };

      onUpdate(updated);
      setIsEditing(false);
      toast.success('修改已保存');
    });
  };

  const handleStartEdit = () => {
    setEditName(character.name);
    setEditStory(character.story || "");
    setEditAvatar(character.avatar || null);
    // 幸运的当前值存在 character.luck.current（燃烧幸运等会改变），
    // 老角色/导入角色的 attributes 里可能没有"幸运"键，必须用 luck.current 初始化，否则保存会归 0
    setEditTempSkills({
      ...character.attributes,
      ...character.skills,
      '幸运': character.luck?.current ?? character.attributes['幸运'] ?? 0,
    });
    setEditWeapons(character.weapons?.length ? character.weapons : [DEFAULT_FIGHT_WEAPON]);
    setEditBackgrounds({ ...(character.backgrounds || {}) });
    setEditPossessions([...(character.possessions || [])]);
    setEditSpells([...(character.spells || [])]);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    Swal.fire({
      title: "放弃修改？",
      text: "未保存的修改将会丢失，确认放弃？",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#64748b",
      confirmButtonText: "放弃修改",
      cancelButtonText: "继续编辑",
      reverseButtons: true
    }).then((result) => {
      if (result.isConfirmed) {
        setIsEditing(false);
        setEditName(character.name);
        setEditStory(character.story || "");
        setEditAvatar(character.avatar || null);
        setEditTempSkills({ ...character.attributes, ...character.skills });
        setEditBackgrounds({ ...(character.backgrounds || {}) });
        setEditPossessions([...(character.possessions || [])]);
        setEditSpells([...(character.spells || [])]);
      }
    });
  };

  const coreAttrs = ["力量", "敏捷", "意志", "体质", "外貌", "教育", "体型", "智力"];
  const derivedAttrs = character.type === 'mob' 
    ? ["体力（HP）", "魔法（MP）", "理智"] 
    : ["体力（HP）", "魔法（MP）", "理智"];
  const allAttrs = [...coreAttrs, ...derivedAttrs, "幸运"];

  const skillEntries = Object.entries(editTempSkills).filter(
    ([k]) => !allAttrs.includes(k)
  );

  return (
    <div className="max-w-5xl mx-auto">
      {/* 顶部：返回 */}
      <div className="flex justify-between items-center mb-6">
        <button
          onClick={onBack}
          className="text-slate-400 hover:text-cyan-400 text-sm font-bold transition flex items-center gap-1"
        >
          ← 返回列表
        </button>
      </div>

      {/* 上侧：头像 + 故事 */}
      <div className={`bg-slate-800 rounded-2xl border ${colors.border} overflow-hidden mb-6`}>
        <div className={`${colors.bg} p-6 flex flex-col md:flex-row gap-6`}>
          {/* 左侧：头像 */}
          <div className="flex flex-col items-center shrink-0">
            <div
              className={`w-28 h-28 rounded-2xl ${colors.badge} flex items-center justify-center text-5xl font-bold overflow-hidden border-4 ${colors.border} ${isEditing ? 'cursor-pointer hover:opacity-80 transition' : ''}`}
              onClick={() => isEditing && avatarFileRef.current?.click()}
            >
              <img
                src={(isEditing ? editAvatar : character.avatar) || DEFAULT_AVATAR}
                alt={character.name}
                className="w-full h-full object-cover"
              />
            </div>
            {isEditing && (
              <>
                <input 
                  type="file" 
                  ref={avatarFileRef} 
                  hidden 
                  accept="image/*" 
                  onChange={handleAvatarUpload} 
                />
                <button
                  onClick={() => avatarFileRef.current?.click()}
                  className="mt-2 text-xs text-cyan-400 hover:text-cyan-300 underline"
                >
                  更换头像
                </button>
              </>
            )}
            <div className={`mt-3 px-3 py-1 rounded-lg ${colors.badge} text-white text-xs font-bold`}>
              {character.type === 'mob' ? '怪物' : character.type === 'npc' ? 'NPC' : 'PC'}
            </div>
            <div className="mt-2 text-center">
              <div className="text-lg font-bold text-white">{isEditing ? (
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-center text-white outline-none focus:border-cyan-500"
                />
              ) : character.name}</div>
              <div className="text-xs text-slate-400 mt-1">
                {character.type === 'pc' ? `PL: ${character.plName || '未知'}` : character.type === 'npc' ? 'NPC角色' : ''}
              </div>
            </div>
          </div>

          {/* 右侧：角色故事 */}
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-bold text-slate-400 mb-2 uppercase tracking-wider">角色故事</h4>
            {isEditing ? (
              <textarea
                value={editStory}
                onChange={(e) => setEditStory(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl p-4 min-h-[150px] outline-none text-slate-100 placeholder-slate-500 resize-y focus:border-cyan-500"
                placeholder="描述这个角色的背景故事..."
              />
            ) : (
              <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-4 min-h-[150px] text-slate-300 whitespace-pre-wrap leading-relaxed">
                {character.story || <span className="text-slate-600 italic">暂无角色故事</span>}
              </div>
            )}
          </div>
        </div>

        {/* 背景与随身物品：仅 PC 类型显示（PC 导入为 NPC / NPC / 怪物不显示人物设定） */}
        {character.type === 'pc' && (
        <div className={`${colors.bg} px-6 pb-6 grid grid-cols-1 md:grid-cols-2 gap-6`}>
          {/* 左：调查员背景（竖排 8 栏，输入框高度随内容自适应） */}
          <div className="space-y-3">
            {BG_FIELDS.map(field => (
              <div key={field}>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">
                  {field}
                </label>
                {isEditing ? (
                  <textarea
                    value={editBackgrounds[field] || ''}
                    onChange={e => updateBackground(field, e.target.value)}
                    placeholder="未填写"
                    rows={1}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs outline-none text-slate-100 placeholder-slate-600 focus:border-cyan-500 field-sizing-content min-h-[38px] max-h-48"
                  />
                ) : (
                  <div className="bg-slate-900/50 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-300 whitespace-pre-wrap leading-relaxed min-h-[38px]">
                    {character.backgrounds?.[field] || <span className="text-slate-600 italic">未填写</span>}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 右：随身物品（自由添加多行，上限 20） */}
          <div>
            {(() => {
              const possessions = isEditing ? editPossessions : (character.possessions || []);
              return (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                      随身物品 <span className="text-slate-600 normal-case font-normal">(最多 {POSSESSIONS_LIMIT} 行)</span>
                    </label>
                    {isEditing && possessions.length < POSSESSIONS_LIMIT && (
                      <button
                        onClick={addPossession}
                        className="bg-cyan-600 text-white px-2.5 py-1 rounded-lg text-[10px] font-bold hover:bg-cyan-500 transition-colors"
                      >
                        + 添加物品
                      </button>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    {possessions.length === 0 && (
                      <div className="rounded-xl border border-dashed border-slate-700 px-3 py-4 text-center text-xs text-slate-600 italic">
                        暂无随身物品
                      </div>
                    )}
                    {possessions.map((p, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <span className="text-slate-600 text-[10px] w-5 text-right flex-shrink-0">{i + 1}.</span>
                        {isEditing ? (
                          <>
                            <input
                              type="text"
                              value={p}
                              placeholder="物品名称 / 数量 / 备注"
                              onChange={e => updatePossession(i, e.target.value)}
                              className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs outline-none text-slate-100 placeholder-slate-600 focus:border-cyan-500"
                            />
                            <button
                              onClick={() => removePossession(i)}
                              className="text-slate-500 hover:text-red-400 text-sm flex-shrink-0"
                              title="删除该行"
                            >
                              ✕
                            </button>
                          </>
                        ) : (
                          <div className="flex-1 bg-slate-900/50 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 whitespace-pre-wrap">
                            {p}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
        )}
      </div>

      {/* 下侧：数值 */}
      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6">
        <h4 className="text-sm font-bold text-slate-400 mb-4 uppercase tracking-wider">核心数值</h4>

        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-3 mb-6">
          {allAttrs.map(attr => {
            const isDerived = character.type === 'mob' 
              ? false 
              : ["体力（HP）", "魔法（MP）", "理智"].includes(attr);

            let displayValue = editTempSkills[attr] || 0;
            if (!isEditing && !isDerived) {
              displayValue = character.attributes[attr] || character.skills[attr] || 0;
            }
            if (isEditing && !isDerived) {
              displayValue = editTempSkills[attr] || 0;
            }

            if (isEditing && isDerived) {
              if (attr === "体力（HP）") displayValue = derivedHP;
              if (attr === "魔法（MP）") displayValue = derivedMP;
              if (attr === "理智") displayValue = derivedSAN;
            }

            const finalDisplay = isEditing 
              ? displayValue 
              : (attr === "体力（HP）" ? character.hp.max : 
                 attr === "魔法（MP）" ? character.mp.max : 
                 attr === "理智" ? character.san.current :
                 attr === "幸运" ? character.luck.current :
                 character.attributes[attr] || 0);

            return (
              <div key={attr} className={`p-3 rounded-xl border text-center ${
                isDerived ? 'bg-slate-900 border-slate-600' : 'bg-slate-900/70 border-slate-700'
              }`}>
                <div className={`text-xs font-bold mb-1 ${isDerived ? 'text-cyan-400' : 'text-slate-500'}`}>{attr}</div>
                {isEditing && !isDerived ? (
                  <input
                    type="number"
                    value={editTempSkills[attr] || 0}
                    onChange={(e) => setEditTempSkills({...editTempSkills, [attr]: clamp(parseInt(e.target.value) || 0, character.type)})}
                    className={`w-full text-center text-lg font-bold bg-transparent outline-none ${isDerived ? 'text-cyan-400' : 'text-slate-100'}`}
                  />
                ) : (
                  <div className={`text-lg font-bold ${isDerived ? 'text-cyan-400' : 'text-slate-100'}`}>
                    {finalDisplay}
                  </div>
                )}
              </div>
            );
          })}

          {/* 伤害加值 / 体格：由力量+体型自动计算，不可编辑 */}
          <div className="p-3 rounded-xl border text-center bg-slate-900 border-slate-600">
            <div className="text-xs font-bold mb-1 text-cyan-400">伤害加值</div>
            <div className="text-lg font-bold text-cyan-400">
              {derivedDBBuild ? derivedDBBuild.db : '—'}
            </div>
          </div>
          <div className="p-3 rounded-xl border text-center bg-slate-900 border-slate-600">
            <div className="text-xs font-bold mb-1 text-cyan-400">体格</div>
            <div className="text-lg font-bold text-cyan-400">
              {derivedDBBuild ? derivedDBBuild.build : '—'}
            </div>
          </div>
        </div>

        {/* 技能列表 */}
        {(skillEntries.length > 0 || isEditing) && (
          <>
            <h4 className="text-sm font-bold text-slate-400 mb-3 uppercase tracking-wider">技能</h4>
            {isEditing && (
              <div className="flex gap-2 mb-4 p-3 bg-slate-900/50 rounded-2xl border border-slate-700">
                <input
                  type="text"
                  placeholder="新技能名称..."
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-cyan-500 text-slate-100 placeholder-slate-500"
                  value={newSkillName}
                  onChange={(e) => setNewSkillName(e.target.value)}
                />
                <input
                  type="number"
                  className="w-16 bg-slate-800 border border-slate-700 rounded-xl px-2 py-2 text-sm text-center outline-none focus:ring-1 focus:ring-cyan-500 text-slate-100"
                  value={newSkillValue}
                  onChange={(e) => setNewSkillValue(parseInt(e.target.value) || 0)}
                />
                <button
                  onClick={handleAddNewSkill}
                  className="bg-cyan-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-cyan-500 transition-colors"
                >
                  添加
                </button>
              </div>
            )}
            {skillEntries.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {skillEntries.map(([s, v]) => {
                  const isCthulhu = s === "克苏鲁神话";
                  return (
                    <div
                      key={s}
                      className={`flex items-center gap-1 px-3 py-1.5 border rounded-lg text-sm group ${
                        isCthulhu
                          ? "bg-green-900/40 border-green-700 text-orange-400 font-serif italic"
                          : "bg-slate-900 border-slate-700 text-slate-300"
                      }`}
                    >
                      <span className={isCthulhu ? "font-black" : "font-medium"}>{s}</span>
                      {isEditing ? (
                        <input
                          type="number"
                          value={v}
                          onChange={(e) => setEditTempSkills({...editTempSkills, [s]: clamp(parseInt(e.target.value) || 0, character.type)})}
                          className="w-12 bg-transparent text-right font-bold outline-none text-cyan-400"
                        />
                      ) : (
                        <span className={`ml-1 font-bold ${isCthulhu ? "text-orange-400" : "text-cyan-400"}`}>{v}</span>
                      )}
                      {isEditing && (
                        <button
                          onClick={() => handleDeleteSkill(s)}
                          className="ml-1 text-slate-500 hover:text-red-400 text-xs transition-all opacity-0 group-hover:opacity-100"
                          title="删除技能"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* 武器列表（最多 6 把，默认"肉搏"不可删除/修改；怪物不使用武器） */}
        {character.type !== 'mob' && (() => {
          const weapons: Weapon[] = isEditing
            ? editWeapons
            : (character.weapons?.length ? character.weapons : [DEFAULT_FIGHT_WEAPON]);
          const skillKeys = Object.keys(editTempSkills).filter(k => !allAttrs.includes(k));
          const tableHeaders = ['武器名称', '使用技能', '类型', '伤害', '次数', '状态', '对多', '故障值'];

          return (
            <>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider">
                  武器 <span className="text-slate-600 normal-case font-normal">({weapons.length}/6)</span>
                </h4>
                {isEditing && weapons.length < 6 && (
                  <button
                    onClick={addWeapon}
                    className="bg-cyan-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-cyan-500 transition-colors"
                  >
                    + 添加武器
                  </button>
                )}
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-700">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-900/80 text-slate-500">
                      {tableHeaders.map(h => (
                        <th key={h} className="px-2 py-2 text-left font-bold whitespace-nowrap">{h}</th>
                      ))}
                      {isEditing && <th className="px-2 py-2 text-left font-bold">操作</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {weapons.map((w, wi) => {
                      const isDefault = wi === 0 && !isEditing ? w.name === '肉搏' : wi === 0;
                      return (
                        <tr key={wi} className={`border-t border-slate-800 ${isDefault ? 'bg-slate-900/40' : ''}`}>
                          {/* 武器名称 */}
                          <td className="px-2 py-2 min-w-[90px]">
                            {isEditing && !isDefault ? (
                              <input
                                type="text"
                                value={w.name}
                                placeholder="武器名称"
                                onChange={e => updateWeapon(wi, { name: e.target.value })}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-cyan-500 text-slate-100 placeholder-slate-600"
                              />
                            ) : (
                              <span className="font-bold text-slate-200 flex items-center gap-1">
                                {w.name}
                                {isDefault && <span className="text-[9px] text-slate-500 font-normal">默认</span>}
                              </span>
                            )}
                          </td>

                          {/* 使用技能 */}
                          <td className="px-2 py-2 min-w-[120px]">
                            {isEditing && !isDefault ? (
                              <SkillAutocomplete
                                value={w.skill}
                                options={skillKeys}
                                onChange={v => updateWeapon(wi, { skill: v })}
                              />
                            ) : (
                              <span className="text-slate-300">{w.skill}</span>
                            )}
                          </td>

                          {/* 类型 */}
                          <td className="px-2 py-2">
                            {isEditing && !isDefault ? (
                              <select
                                value={w.type}
                                onChange={e => updateWeapon(wi, { type: e.target.value as Weapon['type'] })}
                                className="bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1.5 text-xs outline-none focus:border-cyan-500 text-slate-100"
                              >
                                <option value="melee">近战</option>
                                <option value="ranged">远程</option>
                              </select>
                            ) : (
                              <span className={w.type === 'melee' ? 'text-amber-400' : 'text-sky-400'}>
                                {w.type === 'melee' ? '近战' : '远程'}
                              </span>
                            )}
                          </td>

                          {/* 伤害 */}
                          <td className="px-2 py-2">
                            {isEditing && !isDefault ? (
                              <div className="flex flex-col gap-1">
                                {/* 骰子段（最多 3 段，每段可 +固定数值） */}
                                <div className="flex flex-wrap items-center gap-1">
                                  {w.damage.map((d, di) => (
                                    <span key={di} className="flex items-center gap-0.5">
                                      {di > 0 && <span className="text-slate-500">+</span>}
                                      <input
                                        type="number"
                                        min={1}
                                        value={d.count}
                                        onChange={e => updateWeaponDice(wi, di, { count: Math.max(1, parseInt(e.target.value) || 1) })}
                                        className="w-10 bg-slate-900 border border-slate-700 rounded-lg px-1 py-1 text-xs text-center outline-none focus:border-cyan-500 text-slate-100"
                                      />
                                      <span className="text-slate-500">D</span>
                                      <select
                                        value={d.sides}
                                        onChange={e => updateWeaponDice(wi, di, { sides: parseInt(e.target.value) })}
                                        className="bg-slate-900 border border-slate-700 rounded-lg px-1 py-1 text-xs outline-none focus:border-cyan-500 text-slate-100"
                                      >
                                        {DICE_SIDES_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                                      </select>
                                      {/* 每段可选固定数值 +X */}
                                      <input
                                        type="number"
                                        value={d.bonus ?? ''}
                                        placeholder="+0"
                                        onChange={e => {
                                          if (e.target.value === '') { updateWeaponDice(wi, di, { bonus: undefined }); return; }
                                          updateWeaponDice(wi, di, { bonus: parseInt(e.target.value) || 0 });
                                        }}
                                        className="w-10 bg-slate-900 border border-slate-700 rounded-lg px-1 py-1 text-xs text-center outline-none focus:border-cyan-500 text-amber-400 placeholder-slate-700"
                                      />
                                      {w.damage.length > 1 && (
                                        <button
                                          onClick={() => removeWeaponDice(wi, di)}
                                          className="text-slate-600 hover:text-red-400 ml-0.5"
                                          title="删除该段骰子"
                                        >
                                          ✕
                                        </button>
                                      )}
                                    </span>
                                  ))}
                                  {w.damage.length < 3 && (
                                    <button
                                      onClick={() => addWeaponDice(wi)}
                                      className="text-cyan-500 hover:text-cyan-300 text-[10px] border border-slate-700 rounded px-1"
                                      title="追加一段骰子（最多 3 段）"
                                    >
                                      +骰
                                    </button>
                                  )}
                                </div>
                                {/* DB 选择（独立于近战/远程） */}
                                <select
                                  value={w.dbType ?? (w.type === 'melee' ? 'full' : 'none')}
                                  onChange={e => updateWeapon(wi, { dbType: e.target.value as Weapon['dbType'] })}
                                  className="bg-slate-900 border border-slate-700 rounded-lg px-1 py-1 text-xs outline-none focus:border-cyan-500 text-slate-100 w-24"
                                  title="伤害加值（DB）类型，近战不一定带 DB、远程也可能带 DB"
                                >
                                  {DB_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                              </div>
                            ) : (
                              <span className="font-mono text-cyan-400">{formatWeaponDamage(w)}</span>
                            )}
                          </td>

                          {/* 次数 */}
                          <td className="px-2 py-2">
                            {isEditing && !isDefault ? (
                              <input
                                type="number"
                                min={1}
                                value={w.attacks}
                                onChange={e => updateWeapon(wi, { attacks: Math.max(1, parseInt(e.target.value) || 1) })}
                                className="w-14 bg-slate-900 border border-slate-700 rounded-lg px-1 py-1.5 text-xs text-center outline-none focus:border-cyan-500 text-slate-100"
                              />
                            ) : (
                              <span className="text-slate-300">{w.attacks}</span>
                            )}
                          </td>

                          {/* 状态效果 */}
                          <td className="px-2 py-2">
                            {isEditing && !isDefault ? (
                              <select
                                value={w.statusEffect ?? 'none'}
                                onChange={e => updateWeapon(wi, { statusEffect: e.target.value as Weapon['statusEffect'] })}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-1 py-1.5 text-xs outline-none focus:border-cyan-500 text-slate-100"
                              >
                                {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            ) : (
                              (() => {
                                const se = w.statusEffect ?? 'none';
                                if (se === 'burn') return <span className="text-orange-400">🔥</span>;
                                if (se === 'stun') return <span className="text-cyan-400">💫</span>;
                                if (se === 'burn_stun') return <span>🔥💫</span>;
                                return <span className="text-slate-600">无</span>;
                              })()
                            )}
                          </td>

                          {/* 对多 */}
                          <td className="px-2 py-2">
                            {isEditing && !isDefault ? (
                              <select
                                value={w.multi ? '1' : '0'}
                                onChange={e => updateWeapon(wi, { multi: e.target.value === '1' })}
                                className="bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1.5 text-xs outline-none focus:border-cyan-500 text-slate-100"
                              >
                                <option value="0">否</option>
                                <option value="1">是</option>
                              </select>
                            ) : (
                              <span className="text-slate-300">{w.multi ? '是' : '否'}</span>
                            )}
                          </td>

                          {/* 故障值 */}
                          <td className="px-2 py-2">
                            {isEditing && !isDefault ? (
                              <input
                                type="number"
                                min={1}
                                max={100}
                                value={w.malfunction ?? ''}
                                placeholder="无"
                                onChange={e => {
                                  if (e.target.value === '') { updateWeapon(wi, { malfunction: null }); return; }
                                  const n = parseInt(e.target.value) || 1;
                                  updateWeapon(wi, { malfunction: Math.min(100, Math.max(1, n)) });
                                }}
                                className="w-14 bg-slate-900 border border-slate-700 rounded-lg px-1 py-1.5 text-xs text-center outline-none focus:border-cyan-500 text-slate-100 placeholder-slate-600"
                              />
                            ) : (
                              <span className="text-slate-300">{w.malfunction ?? '无'}</span>
                            )}
                          </td>

                          {/* 操作 */}
                          {isEditing && (
                            <td className="px-2 py-2">
                              {isDefault ? (
                                <span className="text-slate-600 text-[10px]" title="默认武器不可删除">🔒</span>
                              ) : (
                                <button
                                  onClick={() => removeWeapon(wi)}
                                  className="text-slate-500 hover:text-red-400"
                                  title="删除武器"
                                >
                                  ✕
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {isEditing && (
                <p className="text-[10px] text-slate-600 mt-1.5">
                  伤害最多 3 段 XDX，每段可 +固定数值，骰子下方选择 DB（无 / 0.5DB / 1DB，独立于近战/远程）；状态效果可选燃烧 / 眩晕 / 两者同时；默认"肉搏"武器不可修改或删除。
                </p>
              )}
            </>
          );
        })()}

        {/* 法术列表（武器下方，法术名称必填；怪物不使用法术） */}
        {character.type !== 'mob' && (() => {
          const spells: Spell[] = isEditing ? editSpells : (character.spells || []);
          const spellHeaders = ['法术名称', '使用代价', '作用', '备注'];
          return (
            <div className="mt-8">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider">
                  法术 {spells.length > 0 && (
                    <span className="text-slate-600 normal-case font-normal">({spells.length})</span>
                  )}
                </h4>
                {isEditing && (
                  <button
                    onClick={addSpell}
                    className="bg-cyan-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-cyan-500 transition-colors"
                  >
                    + 添加法术
                  </button>
                )}
              </div>

              {spells.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-700 px-3 py-4 text-center text-xs text-slate-600 italic">
                  暂无法术
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-700">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-900/80 text-slate-500">
                        {spellHeaders.map(h => (
                          <th key={h} className="px-2 py-2 text-left font-bold whitespace-nowrap">{h}</th>
                        ))}
                        {isEditing && <th className="px-2 py-2 text-left font-bold">操作</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {spells.map((s, si) => (
                        <tr key={si} className="border-t border-slate-800">
                          {/* 法术名称（必填） */}
                          <td className="px-2 py-2 min-w-[110px]">
                            {isEditing ? (
                              <input
                                type="text"
                                value={s.name}
                                placeholder="法术名称（必填）"
                                onChange={e => updateSpell(si, { name: e.target.value })}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-cyan-500 text-slate-100 placeholder-slate-600"
                              />
                            ) : (
                              <span className="font-bold text-slate-200">{s.name}</span>
                            )}
                          </td>

                          {/* 使用代价 */}
                          <td className="px-2 py-2 min-w-[110px]">
                            {isEditing ? (
                              <input
                                type="text"
                                value={s.cost}
                                placeholder="如：1D6 SAN"
                                onChange={e => updateSpell(si, { cost: e.target.value })}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-cyan-500 text-slate-100 placeholder-slate-600"
                              />
                            ) : (
                              <span className="text-slate-300">{s.cost || '—'}</span>
                            )}
                          </td>

                          {/* 作用 */}
                          <td className="px-2 py-2 min-w-[180px]">
                            {isEditing ? (
                              <input
                                type="text"
                                value={s.effect}
                                placeholder="作用描述"
                                onChange={e => updateSpell(si, { effect: e.target.value })}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-cyan-500 text-slate-100 placeholder-slate-600"
                              />
                            ) : (
                              <span className="text-slate-300 whitespace-pre-wrap">{s.effect || '—'}</span>
                            )}
                          </td>

                          {/* 备注 */}
                          <td className="px-2 py-2 min-w-[120px]">
                            {isEditing ? (
                              <input
                                type="text"
                                value={s.note}
                                placeholder="备注"
                                onChange={e => updateSpell(si, { note: e.target.value })}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-cyan-500 text-slate-100 placeholder-slate-600"
                              />
                            ) : (
                              <span className="text-slate-300 whitespace-pre-wrap">{s.note || '—'}</span>
                            )}
                          </td>

                          {/* 操作 */}
                          {isEditing && (
                            <td className="px-2 py-2">
                              <button
                                onClick={() => removeSpell(si)}
                                className="text-slate-500 hover:text-red-400"
                                title="删除法术"
                              >
                                ✕
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* 底部按钮 */}
      <div className="flex justify-between mt-6 gap-4">
        {isEditing ? (
          <>
            <button
              onClick={handleSave}
              className="flex-1 py-4 bg-slate-700 hover:bg-cyan-600 rounded-xl font-bold transition-all shadow-lg"
            >
              保存修改
            </button>
            <button
              onClick={handleCancelEdit}
              className="flex-1 py-4 bg-red-900 hover:bg-red-800 rounded-xl font-bold transition-all shadow-lg"
            >
              放弃修改
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => onDelete(character.id)}
              className="flex-1 py-4 bg-red-900/50 hover:bg-red-800 border border-red-800/50 rounded-xl font-bold transition-all text-red-300"
            >
              删除角色
            </button>
            <button
              onClick={handleExport}
              className="flex-1 py-4 bg-slate-700 hover:bg-amber-600 rounded-xl font-bold transition-all shadow-lg"
            >
              分享角色
            </button>
            <button
              onClick={handleStartEdit}
              className={`flex-1 py-4 ${colors.button} text-white rounded-xl font-bold transition-all shadow-lg`}
            >
              编辑角色
            </button>
          </>
        )}
      </div>

      {cropperSrc && (
        <AvatarCropper
          src={cropperSrc}
          onConfirm={handleCropperConfirm}
          onCancel={() => setCropperSrc(null)}
          size={256}
        />
      )}
    </div>
  );
}
