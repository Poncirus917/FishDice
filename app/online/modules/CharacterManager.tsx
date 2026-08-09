"use client";
import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import Swal from 'sweetalert2';
import ImportView from './ImportView';
import AvatarCropper from './AvatarCropper';
import { encodeShareCode } from './shareCode';
import { CharacterState } from '../../(single)/page';
import { supabase } from '../../lib/supabase';

type SidebarTab = 'create' | 'pc' | 'npc' | 'mob';

const ATTRIBUTE_NAMES = ['力量', '敏捷', '意志', '体质', '外貌', '教育', '体型', '智力', '幸运'];

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
        toast.error('保存到服务器失败');
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
          {character.avatar ? (
            <img src={character.avatar} alt={character.name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-white">{character.name[0]}</span>
          )}
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

  const handleExport = () => {
    try {
      const code = encodeShareCode(character);
      Swal.fire({
        title: "分享角色",
        html: `
          <div class="text-left text-sm text-slate-600 mb-3">
            将此分享码发给好友，他们可以导入该角色。<br/>
            <span class="text-amber-600 font-bold">注意：</span> PC/NPC 角色导入后将变为 NPC（仅可由使用者作为 GM 操作）。
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
    setEditTempSkills({ ...character.attributes, ...character.skills });
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
              {(isEditing ? editAvatar : character.avatar) ? (
                <img src={isEditing ? editAvatar! : character.avatar!} alt={character.name} className="w-full h-full object-cover" />
              ) : (
                <span className="text-white">{character.name[0]}</span>
              )}
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
