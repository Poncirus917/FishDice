"use client";
import Swal from 'sweetalert2';
import { useState, useRef, useEffect } from 'react';
import { parseCharacterText } from '../../utils/parser';
import { CharacterState, Weapon, WeaponDicePart, Spell } from '../../(single)/page';
import AvatarCropper from './AvatarCropper';
import { decodeShareCode, validateImportType, BG_FIELDS } from './shareCode';

// 默认武器"肉搏"：所有非怪物角色自带，不可删除
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
  const dbType = w.dbType ?? (w.type === 'melee' ? 'full' : 'none');
  const parts = w.damage.map(d => d.bonus ? `${d.count}D${d.sides}+${d.bonus}` : `${d.count}D${d.sides}`);
  if (dbType === 'full') parts.push('DB');
  else if (dbType === 'half') parts.push('0.5DB');
  let text = parts.join('+');
  const se = w.statusEffect ?? 'none';
  if (se === 'burn') text += ' 🔥';
  else if (se === 'stun') text += ' 💫';
  else if (se === 'burn_stun') text += ' 🔥💫';
  return text;
};

interface ImportViewProps {
  onConfirm: (char: CharacterState) => void;
  characters: CharacterState[]; 
  setCharacters: React.Dispatch<React.SetStateAction<CharacterState[]>>; 
  userDisplayName?: string;
}

export default function ImportView({ onConfirm, characters, setCharacters, userDisplayName }: ImportViewProps) {
  const [activeTab, setActiveTab] = useState<'pc' | 'npc' | 'mob'>('pc');
  const [step, setStep] = useState<1 | 2>(1); 
  const [name, setName] = useState("");
  const [plName, setPlName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [rawText, setRawText] = useState("");
  const [story, setStory] = useState("");
  const [tempSkills, setTempSkills] = useState<Record<string, number>>({});
  const [editingId, setEditingId] = useState<string | null>(null); 
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newSkillName, setNewSkillName] = useState("");
  const [newSkillValue, setNewSkillValue] = useState<number>(0);
  const [cropperSrc, setCropperSrc] = useState<string | null>(null);
  // 第二步：武器 / 人物设定（背景+随身物品）/ 法术 编辑
  const [editWeapons, setEditWeapons] = useState<Weapon[]>([]);
  const [editBackgrounds, setEditBackgrounds] = useState<Record<string, string>>({});
  const [editPossessions, setEditPossessions] = useState<string[]>([]);
  const [editSpells, setEditSpells] = useState<Spell[]>([]);
  const clamp = (val: number, type?: string) => {
    const max = type === 'mob' ? 9999 : 99; 
    return Math.min(Math.max(val, 0), max);
  };

  useEffect(() => {
    if (activeTab === 'pc' && userDisplayName) {
      setPlName(userDisplayName);
    }
  }, [activeTab, userDisplayName]);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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
    setAvatar(croppedDataUrl);
    setCropperSrc(null);
  };

  const handleImportClick = () => {
    Swal.fire({
      title: "导入他人分享的角色",
      html: `
        <div class="text-left text-sm text-slate-600 mb-3">
          粘贴好友分享的角色码，导入后：<br/>
          <span class="font-bold text-cyan-600">•</span> PC 可选择以 PC 或 NPC 身份导入<br/>
          <span class="font-bold text-cyan-600">•</span> 以 PC 身份导入保留人物设定；以 NPC 身份导入则不带人物设定<br/>
          <span class="font-bold text-emerald-600">•</span> NPC 保持为 NPC<br/>
          <span class="font-bold text-red-600">•</span> 怪物角色保持为怪物
        </div>
        <textarea id="import-code" class="w-full p-3 border-2 border-slate-300 rounded-xl text-xs font-mono bg-slate-50 text-slate-800" rows="4" placeholder="粘贴 FD- 开头的分享码..."></textarea>
      `,
      showConfirmButton: true,
      showCancelButton: true,
      confirmButtonText: "导入",
      cancelButtonText: "取消",
      confirmButtonColor: '#0891b2',
      preConfirm: () => {
        const textarea = document.getElementById('import-code') as HTMLTextAreaElement;
        return textarea?.value || '';
      }
    }).then(async (result) => {
      if (!result.isConfirmed || !result.value) return;

      try {
        const data = await decodeShareCode(result.value);
        const originalType = data.type as 'pc' | 'npc' | 'mob';

        // 选择导入身份：PC 可选 PC/NPC；NPC / 怪物固定原身份
        let importAs: 'pc' | 'npc' | 'mob';
        if (originalType === 'pc') {
          const choice = await Swal.fire({
            title: "选择导入类型",
            html: `
              <p class="text-sm text-slate-600 mb-4">
                分享的角色 "<span class="font-bold">${data.name}</span>" 原本是 <b class="text-cyan-600">PC（调查员）</b>。<br/>
                请选择导入身份：
              </p>
            `,
            icon: 'info',
            showDenyButton: true,
            confirmButtonText: '以 PC 身份导入',
            confirmButtonColor: '#0891b2',
            denyButtonText: '以 NPC 身份导入',
            denyButtonColor: '#059669',
            showCancelButton: true,
            cancelButtonText: '取消',
            reverseButtons: true
          });
          if (choice.isConfirmed) importAs = 'pc';
          else if (choice.isDenied) importAs = 'npc';
          else return;
        } else {
          importAs = originalType === 'mob' ? 'mob' : 'npc';
          const info = await Swal.fire({
            title: "选择导入类型",
            html: `
              <p class="text-sm text-slate-600 mb-4">
                分享的角色 "<span class="font-bold">${data.name}</span>" 原本是 <b>${originalType === 'mob' ? '怪物' : 'NPC'}</b>。<br/>
                导入身份为：<b class="${originalType === 'mob' ? 'text-red-600' : 'text-emerald-600'}">${importAs === 'mob' ? '怪物' : 'NPC'}</b>
              </p>
            `,
            icon: 'info',
            confirmButtonText: `以 ${importAs === 'mob' ? '怪物' : 'NPC'} 身份导入`,
            confirmButtonColor: '#0891b2'
          });
          if (!info.isConfirmed) return;
        }

        if (!validateImportType(originalType, importAs)) {
          Swal.fire({ icon: 'error', title: '导入失败', text: '无效的类型组合' });
          return;
        }

        // 人物设定（背景 + 随身物品）仅以 PC 身份导入时保留；以 NPC 身份导入不带
        const isPcImport = importAs === 'pc';
        const newChar: CharacterState = {
          id: Date.now().toString(),
          name: data.name,
          type: importAs,
          plName: importAs === 'pc' ? '未知PL' : 'GM操作',
          avatar: data.avatar,
          story: data.story,
          hp: data.hp,
          mp: data.mp,
          san: data.san,
          luck: data.luck,
          skills: data.skills,
          attributes: data.attributes,
          weapons: data.weapons,
          backgrounds: isPcImport ? data.backgrounds : undefined,
          possessions: isPcImport ? data.possessions : undefined,
          spells: data.spells,
          status: [],
        };

        onConfirm(newChar);
        Swal.fire({
          icon: 'success',
          title: '导入成功',
          text: `"${data.name}" 已成功导入为 ${importAs === 'pc' ? 'PC' : importAs === 'npc' ? 'NPC' : '怪物'}`,
          timer: 2000,
          showConfirmButton: false,
        });
      } catch (e) {
        Swal.fire({
          icon: 'error',
          title: '导入失败',
          text: e instanceof Error ? e.message : '无效的分享码',
        });
      }
    });
  };

  const handleToStep2 = () => {
    const parsed = parseCharacterText(rawText);
    const safeParsed = Object.fromEntries(
        Object.entries(parsed).map(([k, v]) => [k, clamp(v)])
    );
    setTempSkills(safeParsed);
    // 首次进入第二步时，武器表先放默认"肉搏"行
    if (editWeapons.length === 0) setEditWeapons([{ ...DEFAULT_FIGHT_WEAPON }]);
    setStep(2);
  };

  const handleFinalConfirm = () => {
    // 武器校验：名称非空、伤害至少一段、使用技能必须在技能列表中（默认武器"肉搏"除外）
    const excludedFromSkills = ["力量", "敏捷", "意志", "体质", "外貌", "教育", "体型", "智力", "体力（HP）", "魔法（MP）", "理智", "幸运"];
    const skillKeys = Object.keys(tempSkills).filter(k => !excludedFromSkills.includes(k));
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

    // 第一行强制为默认武器"肉搏"（不可删除、不可修改）
    const finalWeapons: Weapon[] = editWeapons.length
      ? editWeapons.map((w, i) => (i === 0 ? { ...DEFAULT_FIGHT_WEAPON } : w))
      : [DEFAULT_FIGHT_WEAPON];

    const con = clamp(tempSkills["体质"] || 0);
    const siz = clamp(tempSkills["体型"] || 0);
    const pow = clamp(tempSkills["意志"] || 0);

    const isMob = activeTab === 'mob';
    
    const finalHP = isMob 
      ? clamp(tempSkills["体力（HP）"] || 0)
      : Math.floor((con + siz) / 10);
    const finalMP = isMob 
      ? clamp(tempSkills["魔法（MP）"] || 0)
      : Math.floor(pow / 5);
    
    const newChar: CharacterState = {
      id: editingId || Date.now().toString(),
      name: name || (activeTab === 'pc' ? "未命名调查员" : "未命名生物"),
      type: activeTab,
      plName: activeTab === 'pc' ? (plName || "未知PL") : "GM操作",
      avatar: avatar || undefined,
      story: story || undefined,
      hp: { current: finalHP, max: finalHP },
      mp: { current: finalMP, max: finalMP },
      san: { current: isMob ? clamp(tempSkills["理智"] || 0) : pow , max: 99 },
      luck: { current: clamp(tempSkills["幸运"] || 0), max: 99 },
      skills: Object.fromEntries(
        Object.entries(tempSkills)
          .filter(([k]) => !excludedFromSkills.includes(k))
          .map(([k, v]) => [k, clamp(v)])
      ),
      attributes: {
        "力量": clamp(tempSkills["力量"] || 0),
        "敏捷": clamp(tempSkills["敏捷"] || 0),
        "意志": pow,
        "体质": con,
        "外貌": clamp(tempSkills["外貌"] || 0),
        "教育": clamp(tempSkills["教育"] || 0),
        "体型": siz,
        "智力": clamp(tempSkills["智力"] || 0),
      },
      status: [],
      // 武器/法术：怪物不使用；人物设定（背景+随身物品）仅 PC
      ...(activeTab !== 'mob'
        ? { weapons: finalWeapons, spells: editSpells.map(s => ({ ...s, name: s.name.trim() })).filter(s => s.name !== '') }
        : { weapons: undefined, spells: undefined }),
      ...(activeTab === 'pc'
        ? { backgrounds: { ...editBackgrounds }, possessions: editPossessions.map(p => p.trim()).filter(p => p !== '') }
        : { backgrounds: undefined, possessions: undefined }),
    };

    if (editingId) {
      setCharacters(prev => prev.map(c => c.id === editingId ? newChar : c));
      setEditingId(null);
      Swal.fire({
        icon: 'success',
        title: '修改已保存',
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 2000,
      });
    } else {
      onConfirm(newChar);
      Swal.fire({
        icon: 'success',
        title: '角色创建成功',
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 2000,
      });
    }

    setName("");
    setPlName("");
    setAvatar(null);
    setStory("");
    setRawText("");
    setEditWeapons([]);
    setEditBackgrounds({});
    setEditPossessions([]);
    setEditSpells([]);
    setStep(1);
  };

  const handleEdit = (char: CharacterState) => {
    setEditingId(char.id);
    setActiveTab(char.type);
    setName(char.name);
    setPlName(char.plName || "");
    setAvatar(char.avatar || null);
    setStory(char.story || "");
    setTempSkills({ ...char.attributes, ...char.skills, '幸运': char.luck?.current ?? char.attributes['幸运'] ?? 0 });
    setEditWeapons(char.weapons?.length ? char.weapons : [{ ...DEFAULT_FIGHT_WEAPON }]);
    setEditBackgrounds({ ...(char.backgrounds || {}) });
    setEditPossessions([...(char.possessions || [])]);
    setEditSpells([...(char.spells || [])]);
    setStep(2); 
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = (id: string) => {
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
        setCharacters(prev => prev.filter(char => char.id !== id));
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
  };

  const handleAddNewSkill = () => {
    const trimmedName = newSkillName.trim();
    if (!trimmedName) return;

    if (tempSkills.hasOwnProperty(trimmedName)) {
      Swal.fire({
        title: "技能已存在",
        text: `"${trimmedName}" 已在列表中，请直接修改数值。`,
        icon: "info",
        confirmButtonText: "知道了"
      });
      return;
    }

    setTempSkills(prev => ({
      ...prev,
      [trimmedName]: clamp(newSkillValue)
    }));
    setNewSkillName("");
    setNewSkillValue(0);
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

  return (
    <div className="flex flex-col gap-8 text-white">
      {/* 顶部标签切换 */}
      <div className="flex p-1 bg-slate-800 rounded-2xl w-fit self-center border border-slate-700">
        {[
          { id: 'pc', label: '调查员 (PC)', color: 'text-cyan-400' },
          { id: 'npc', label: 'NPC', color: 'text-emerald-400' },
          { id: 'mob', label: '怪物 ', color: 'text-red-400' }
        ].map(t => (
          <button
            key={t.id}
            onClick={() => { if(!editingId) setActiveTab(t.id as any); }}
            className={`px-6 py-2 rounded-xl text-xs font-black transition-all ${
              activeTab === t.id ? 'bg-slate-700 shadow-sm ' + t.color : 'text-slate-500 hover:text-slate-300'
            } ${editingId ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-slate-800 rounded-3xl shadow-sm border border-slate-700 overflow-hidden">
        <div className="bg-slate-900 px-8 py-4 border-b border-slate-700 flex justify-between items-center">
          <div className="flex gap-4 text-sm font-bold">
            <span className={step === 1 ? "text-cyan-400" : "text-slate-500"}>1. 基础资料</span>
            <span className="text-slate-600">/</span>
            <span className={step === 2 ? "text-cyan-400" : "text-slate-500"}>2. 数值与设定校对</span>
          </div>
          {editingId && <span className="text-xs bg-amber-900/50 text-amber-400 px-2 py-1 rounded-lg font-bold border border-amber-700">正在编辑模式</span>}
        </div>

        <div className="p-8">
          {step === 1 && (
            <div className="space-y-6 animate-in fade-in duration-500">
              <div className="flex flex-col md:flex-row gap-8 items-start">
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="w-32 h-32 rounded-2xl bg-slate-900 border-2 border-dashed border-slate-600 flex flex-col items-center justify-center cursor-pointer hover:border-cyan-500 hover:bg-slate-700 transition-all overflow-hidden group relative"
                >
                  {avatar ? <img src={avatar} alt="预览" className="w-full h-full object-cover" /> : (
                    <div className="text-center p-2">
                      <span className="text-2xl text-slate-500">📷</span>
                      <p className="text-[10px] text-slate-400 mt-1">上传头像</p>
                    </div>
                  )}
                  <input type="file" ref={fileInputRef} hidden accept="image/*" onChange={handleAvatarChange} />
                </div>

                <div className="flex-1 space-y-4 w-full">
                  <input 
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 focus:ring-2 focus:ring-cyan-500 outline-none text-slate-100 placeholder-slate-500"
                    placeholder={activeTab === 'pc' ? "调查员姓名" : (activeTab === 'npc' ? 'NPC姓名' : '怪物名')} value={name} onChange={(e) => setName(e.target.value)}
                  />
                  {activeTab === 'pc' && (
                    <input 
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 outline-none text-slate-400 placeholder-slate-600 font-mono cursor-not-allowed"
                      placeholder="玩家(PL)名称" value={plName ? `玩家名：${plName}` : ''} disabled readOnly
                    />
                  )}
                </div>
              </div>

              {/* 角色故事 */}
              <div>
                <label className="block text-sm font-bold text-slate-400 mb-2">角色故事</label>
                <textarea 
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-4 min-h-[120px] focus:ring-2 focus:ring-cyan-500 outline-none text-slate-100 placeholder-slate-500 resize-y"
                  placeholder="描述这个角色的背景故事、性格特征、经历等..."
                  value={story} onChange={(e) => setStory(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-400 mb-2">粘贴数值文本</label>
                <textarea 
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-4 min-h-[150px] focus:ring-2 focus:ring-cyan-500 outline-none font-mono text-sm text-slate-100 placeholder-slate-500"
                  placeholder={activeTab === 'pc'||'npc' ? "例如：力量50 敏捷60 意志65 体质55 外貌70 教育80 体型60 智力75..." : "在此输入属性或技能，格式：力量80 斗殴60 触手攻击50"}
                  value={rawText} onChange={(e) => setRawText(e.target.value)}
                />
              </div>

              <button 
                onClick={handleToStep2}
                disabled={!name}
                className={`w-full text-white py-4 rounded-xl font-bold transition-all shadow-lg ${
                    activeTab === 'mob' ? 'bg-red-700 hover:bg-red-600' : (activeTab === 'npc' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-cyan-600 hover:bg-cyan-500')
                } disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed`}
              >
                {editingId ? "确认并校对数值" : "解析并进入下一步"}
              </button>
            </div>
          )}

          {step === 2 && (() => {
            const derivedHP = Math.floor(((tempSkills["体质"] || 0) + (tempSkills["体型"] || 0)) / 10);
            const derivedMP = Math.floor((tempSkills["意志"] || 0) / 5);
            const derivedSAN = tempSkills["意志"] || 0;
            // 技能键列表（排除属性），供武器"使用技能"下拉选择
            const skillKeys = Object.keys(tempSkills).filter(k => !["力量", "敏捷", "意志", "体质", "外貌", "教育", "体型", "智力", "体力（HP）", "魔法（MP）", "理智", "幸运"].includes(k));

            return (
              <div className="space-y-8 animate-in slide-in-from-right-4 duration-500">
                <div className="flex justify-between items-center">
                  <h3 className="text-xl font-bold text-white">数值与设定校对</h3>
                  <button onClick={() => setStep(1)} className="text-slate-400 text-xs hover:text-cyan-400">← 返回上一步</button>
                </div>

                <section>
                  <h4 className="text-sm font-bold text-slate-500 mb-4 uppercase">核心属性</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {["力量", "敏捷", "意志", "体质", "外貌", "教育", "体型", "智力", "体力（HP）", "魔法（MP）", "理智", "幸运"].map(attr => {
                      if(attr === "理智" && (activeTab !== 'pc' && activeTab !== 'npc' && activeTab !== 'mob')) return null;
                      
                      const isDerived = activeTab === 'mob' 
                        ? false 
                        : ["体力（HP）", "魔法（MP）", "理智"].includes(attr);

                      let displayValue = tempSkills[attr] || 0;

                      if (activeTab !== 'mob') {
                        if (attr === "体力（HP）") displayValue = derivedHP;
                        if (attr === "魔法（MP）") displayValue = derivedMP;
                        if (attr === "理智") displayValue = derivedSAN;
                      }

                      return (
                        <div key={attr} className={`p-3 rounded-2xl border ${isDerived ? 'bg-slate-900 border-slate-600' : 'bg-slate-900 border-slate-700'}`}>
                          <label className={`text-xs font-bold ${isDerived ? 'text-cyan-400' : 'text-slate-400'}`}>{attr}</label>
                          <input 
                            type="number" 
                            className={`w-12 bg-transparent text-right font-bold outline-none ${isDerived ? 'text-cyan-400 cursor-not-allowed' : 'text-slate-100'}`}
                            value={displayValue} 
                            readOnly={isDerived}
                            onChange={(e) => {
                              if(!isDerived) {
                                setTempSkills({...tempSkills, [attr]: clamp(parseInt(e.target.value) || 0, activeTab)});
                              }
                            }}
                          />
                        </div>
                      );
})}
                  </div>
                </section>

                <section>
                  <h4 className="text-sm font-bold text-slate-500 mb-4 uppercase">技能列表</h4>
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[300px] overflow-y-auto pr-2">
                    {Object.entries(tempSkills).map(([key, value]) => {
                      if (["力量", "敏捷", "意志", "体质", "外貌", "教育", "体型", "智力", "体力（HP）", "魔法（MP）", "理智", "幸运"].includes(key)) return null;
                      return (
                        <div key={key} className="flex items-center justify-between p-3 border rounded-xl bg-slate-800 border-slate-700 group">
                          <span className="text-sm text-slate-300">{key}</span>
                          <div className="flex items-center gap-2">
                            <input 
                              type="number" className="w-12 text-right font-semibold outline-none bg-transparent text-slate-100"
                              value={value} 
                              onChange={(e) => setTempSkills({...tempSkills, [key]: clamp(parseInt(e.target.value) || 0)})}
                            />
                            <button 
                              onClick={() => {
                                const { [key]: _, ...rest } = tempSkills;
                                setTempSkills(rest);
                              }}
                              className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 text-xs transition-all"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* 人物设定：调查员背景 + 随身物品（仅 PC） */}
                {activeTab === 'pc' && (
                  <section>
                    <h4 className="text-sm font-bold text-slate-500 mb-4 uppercase">人物设定</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* 左：调查员背景 8 栏 */}
                      <div className="space-y-3">
                        {BG_FIELDS.map(field => (
                          <div key={field}>
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">{field}</label>
                            <textarea
                              value={editBackgrounds[field] || ''}
                              onChange={e => updateBackground(field, e.target.value)}
                              placeholder="未填写"
                              rows={1}
                              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs outline-none text-slate-100 placeholder-slate-600 focus:border-cyan-500 field-sizing-content min-h-[38px] max-h-48"
                            />
                          </div>
                        ))}
                      </div>

                      {/* 右：随身物品（最多 20 行） */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                            随身物品 <span className="text-slate-600 normal-case font-normal">(最多 {POSSESSIONS_LIMIT} 行)</span>
                          </label>
                          {editPossessions.length < POSSESSIONS_LIMIT && (
                            <button
                              onClick={addPossession}
                              className="bg-cyan-600 text-white px-2.5 py-1 rounded-lg text-[10px] font-bold hover:bg-cyan-500 transition-colors"
                            >
                              + 添加物品
                            </button>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          {editPossessions.length === 0 && (
                            <div className="rounded-xl border border-dashed border-slate-700 px-3 py-4 text-center text-xs text-slate-600 italic">
                              暂无随身物品
                            </div>
                          )}
                          {editPossessions.map((p, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                              <span className="text-slate-600 text-[10px] w-5 text-right flex-shrink-0">{i + 1}.</span>
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
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {/* 武器列表（最多 6 把，默认"肉搏"不可删除/修改；怪物不使用武器） */}
                {activeTab !== 'mob' && (
                  <section>
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-sm font-bold text-slate-500 uppercase">武器 <span className="text-slate-600 normal-case">({editWeapons.length}/6)</span></h4>
                      {editWeapons.length < 6 && (
                        <button onClick={addWeapon} className="bg-cyan-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-cyan-500 transition-colors">
                          + 添加武器
                        </button>
                      )}
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-slate-700">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-900/80 text-slate-500">
                            {['武器名称', '使用技能', '类型', '伤害', '次数', '状态', '对多', '故障值'].map(h => (
                              <th key={h} className="px-2 py-2 text-left font-bold whitespace-nowrap">{h}</th>
                            ))}
                            <th className="px-2 py-2 text-left font-bold">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {editWeapons.map((w, wi) => {
                            const isDefault = wi === 0;
                            const dbVal = w.dbType ?? (w.type === 'melee' ? 'full' : 'none');
                            const seVal = w.statusEffect ?? 'none';
                            return (
                              <tr key={wi} className={`border-t border-slate-800 ${isDefault ? 'bg-slate-900/40' : ''}`}>
                                {/* 武器名称 */}
                                <td className="px-2 py-2 min-w-[90px]">
                                  {isDefault ? (
                                    <span className="font-bold text-slate-200 flex items-center gap-1">
                                      {w.name}
                                      <span className="text-[9px] text-slate-500 font-normal">默认</span>
                                    </span>
                                  ) : (
                                    <input
                                      type="text"
                                      value={w.name}
                                      placeholder="武器名称"
                                      onChange={e => updateWeapon(wi, { name: e.target.value })}
                                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-cyan-500 text-slate-100 placeholder-slate-600"
                                    />
                                  )}
                                </td>
                                {/* 使用技能 */}
                                <td className="px-2 py-2 min-w-[120px]">
                                  {isDefault ? (
                                    <span className="text-slate-300">{w.skill}</span>
                                  ) : (
                                    <select
                                      value={w.skill}
                                      onChange={e => updateWeapon(wi, { skill: e.target.value })}
                                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1.5 text-xs outline-none focus:border-cyan-500 text-slate-100"
                                    >
                                      <option value="">选择技能</option>
                                      {!skillKeys.includes(w.skill) && w.skill && <option value={w.skill}>{w.skill}</option>}
                                      {skillKeys.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                  )}
                                </td>
                                {/* 近战 / 远程类型 */}
                                <td className="px-2 py-2">
                                  {isDefault ? (
                                    <span className={w.type === 'melee' ? 'text-amber-400' : 'text-sky-400'}>{w.type === 'melee' ? '近战' : '远程'}</span>
                                  ) : (
                                    <select
                                      value={w.type}
                                      onChange={e => updateWeapon(wi, { type: e.target.value as Weapon['type'] })}
                                      className="bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1.5 text-xs outline-none focus:border-cyan-500 text-slate-100"
                                    >
                                      <option value="melee">近战</option>
                                      <option value="ranged">远程</option>
                                    </select>
                                  )}
                                </td>
                                {/* 伤害：XDX 段 + 可选 +固定数值 */}
                                <td className="px-2 py-2">
                                  {isDefault ? (
                                    <span className="font-mono text-cyan-400">{formatWeaponDamage(w)}</span>
                                  ) : (
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
                                        value={dbVal}
                                        onChange={e => updateWeapon(wi, { dbType: e.target.value as Weapon['dbType'] })}
                                        className="bg-slate-900 border border-slate-700 rounded-lg px-1 py-1 text-xs outline-none focus:border-cyan-500 text-slate-100 w-24"
                                        title="伤害加值（DB）类型，近战不一定带 DB、远程也可能带 DB"
                                      >
                                        {DB_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                      </select>
                                    </div>
                                  )}
                                </td>
                                {/* 次数 */}
                                <td className="px-2 py-2">
                                  {isDefault ? (
                                    <span className="text-slate-300">{w.attacks}</span>
                                  ) : (
                                    <input
                                      type="number"
                                      min={1}
                                      value={w.attacks}
                                      onChange={e => updateWeapon(wi, { attacks: Math.max(1, parseInt(e.target.value) || 1) })}
                                      className="w-14 bg-slate-900 border border-slate-700 rounded-lg px-1 py-1.5 text-xs text-center outline-none focus:border-cyan-500 text-slate-100"
                                    />
                                  )}
                                </td>
                                {/* 状态效果 */}
                                <td className="px-2 py-2">
                                  <select
                                    value={seVal}
                                    onChange={e => updateWeapon(wi, { statusEffect: e.target.value as Weapon['statusEffect'] })}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-1 py-1.5 text-xs outline-none focus:border-cyan-500 text-slate-100"
                                  >
                                    {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                  </select>
                                </td>
                                {/* 对多 */}
                                <td className="px-2 py-2">
                                  {isDefault ? (
                                    <span className="text-slate-300">{w.multi ? '是' : '否'}</span>
                                  ) : (
                                    <select
                                      value={w.multi ? '1' : '0'}
                                      onChange={e => updateWeapon(wi, { multi: e.target.value === '1' })}
                                      className="bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1.5 text-xs outline-none focus:border-cyan-500 text-slate-100"
                                    >
                                      <option value="0">否</option>
                                      <option value="1">是</option>
                                    </select>
                                  )}
                                </td>
                                {/* 故障值 */}
                                <td className="px-2 py-2">
                                  {isDefault ? (
                                    <span className="text-slate-300">{w.malfunction ?? '无'}</span>
                                  ) : (
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
                                  )}
                                </td>
                                {/* 操作 */}
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
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[10px] text-slate-600 mt-1.5">
                      伤害最多 3 段 XDX，每段可 +固定数值，骰子下方选择 DB（无 / 0.5DB / 1DB，独立于近战/远程）；状态效果可选燃烧 / 眩晕 / 两者同时；默认"肉搏"武器不可修改或删除。
                    </p>
                  </section>
                )}

                {/* 法术列表（怪物不使用法术） */}
                {activeTab !== 'mob' && (
                  <section>
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-sm font-bold text-slate-500 uppercase">
                        法术 {editSpells.length > 0 && <span className="text-slate-600 normal-case">({editSpells.length})</span>}
                      </h4>
                      <button onClick={addSpell} className="bg-cyan-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-cyan-500 transition-colors">
                        + 添加法术
                      </button>
                    </div>
                    {editSpells.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-700 px-3 py-4 text-center text-xs text-slate-600 italic">
                        暂无法术
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-xl border border-slate-700">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-slate-900/80 text-slate-500">
                              {['法术名称', '使用代价', '作用', '备注'].map(h => (
                                <th key={h} className="px-2 py-2 text-left font-bold whitespace-nowrap">{h}</th>
                              ))}
                              <th className="px-2 py-2 text-left font-bold">操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {editSpells.map((s, si) => (
                              <tr key={si} className="border-t border-slate-800">
                                <td className="px-2 py-2 min-w-[110px]">
                                  <input
                                    type="text"
                                    value={s.name}
                                    placeholder="法术名称（必填）"
                                    onChange={e => updateSpell(si, { name: e.target.value })}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-cyan-500 text-slate-100 placeholder-slate-600"
                                  />
                                </td>
                                <td className="px-2 py-2 min-w-[110px]">
                                  <input
                                    type="text"
                                    value={s.cost}
                                    placeholder="如：1D6 SAN"
                                    onChange={e => updateSpell(si, { cost: e.target.value })}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-cyan-500 text-slate-100 placeholder-slate-600"
                                  />
                                </td>
                                <td className="px-2 py-2 min-w-[180px]">
                                  <input
                                    type="text"
                                    value={s.effect}
                                    placeholder="作用描述"
                                    onChange={e => updateSpell(si, { effect: e.target.value })}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-cyan-500 text-slate-100 placeholder-slate-600"
                                  />
                                </td>
                                <td className="px-2 py-2 min-w-[120px]">
                                  <input
                                    type="text"
                                    value={s.note}
                                    placeholder="备注"
                                    onChange={e => updateSpell(si, { note: e.target.value })}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-cyan-500 text-slate-100 placeholder-slate-600"
                                  />
                                </td>
                                <td className="px-2 py-2">
                                  <button
                                    onClick={() => removeSpell(si)}
                                    className="text-slate-500 hover:text-red-400"
                                    title="删除法术"
                                  >
                                    ✕
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                )}

                <button onClick={handleFinalConfirm} className={`w-full text-white py-4 rounded-2xl font-bold transition-all shadow-xl ${
                    activeTab === 'mob' ? 'bg-red-700 hover:bg-red-600' : 'bg-cyan-600 hover:bg-cyan-500'
                }`}>
                  {editingId ? "保存修改" : "完成创建"}
                </button>
              </div>
            );
          })()}
        </div>
      </div>

      {/* 导入他人分享的角色 */}
      <div className="text-center">
        <button
          onClick={handleImportClick}
          className="inline-flex items-center gap-2 px-6 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-600 hover:border-amber-500 rounded-2xl text-sm font-bold text-slate-300 hover:text-amber-400 transition-all"
        >
          <span className="text-lg">📥</span>
          导入他人分享的角色
        </button>
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
