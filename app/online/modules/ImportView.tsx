"use client";
import Swal from 'sweetalert2';
import { useState, useRef, useEffect } from 'react';
import { parseCharacterText } from '../../utils/parser';
import { CharacterState } from '../../(single)/page';
import AvatarCropper from './AvatarCropper';
import { decodeShareCode, validateImportType } from './shareCode';

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
          <span class="font-bold text-cyan-600">•</span> PC/NPC 角色将变为 NPC（由您作为 GM 操作）<br/>
          <span class="font-bold text-red-600">•</span> 怪物角色保持为怪物
        </div>
        <textarea id="import-code" class="w-full p-3 border-2 border-slate-300 rounded-xl text-xs font-mono bg-slate-50 text-slate-800" rows="4" placeholder="粘贴 COC- 开头的分享码..."></textarea>
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
    }).then((result) => {
      if (!result.isConfirmed || !result.value) return;
      
      try {
        const data = decodeShareCode(result.value);
        const originalType = data.type as 'pc' | 'npc' | 'mob';
        const importAs = originalType === 'mob' ? 'mob' : 'npc';
        
        Swal.fire({
          title: "选择导入类型",
          html: `
            <p class="text-sm text-slate-600 mb-4">
              分享的角色 "<span class="font-bold">${data.name}</span>" 原本是 <b>${originalType === 'pc' ? 'PC' : originalType === 'npc' ? 'NPC' : '怪物'}</b>。<br/>
              导入类型必须为：<b class="${originalType === 'mob' ? 'text-red-600' : 'text-emerald-600'}">${importAs === 'mob' ? '怪物' : 'NPC'}</b>
            </p>
          `,
          icon: 'info',
          confirmButtonText: `以 ${importAs === 'mob' ? '怪物' : 'NPC'} 身份导入`,
          confirmButtonColor: '#0891b2'
        }).then((importResult) => {
          if (!importResult.isConfirmed) return;
          
          if (!validateImportType(originalType, importAs)) {
            Swal.fire({ icon: 'error', title: '导入失败', text: '无效的类型组合' });
            return;
          }
          
          const newChar: CharacterState = {
            id: Date.now().toString(),
            name: data.name,
            type: importAs,
            plName: importAs === 'npc' ? 'GM操作' : '未知PL',
            avatar: data.avatar,
            story: data.story,
            hp: data.hp,
            mp: data.mp,
            san: data.san,
            luck: data.luck,
            skills: data.skills,
            attributes: data.attributes,
            status: [],
          };
          
          onConfirm(newChar);
          Swal.fire({
            icon: 'success',
            title: '导入成功',
            text: `"${data.name}" 已成功导入为 ${importAs === 'mob' ? '怪物' : 'NPC'}`,
            timer: 2000,
            showConfirmButton: false,
          });
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
    setStep(2);
  };

  const handleFinalConfirm = () => {
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
    
    const excludedFromSkills = ["力量", "敏捷", "意志", "体质", "外貌", "教育", "体型", "智力", "体力（HP）", "魔法（MP）", "理智", "幸运"];
    
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
      status: []
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
    setStep(1);
  };

  const handleEdit = (char: CharacterState) => {
    setEditingId(char.id);
    setActiveTab(char.type);
    setName(char.name);
    setPlName(char.plName || "");
    setAvatar(char.avatar || null);
    setStory(char.story || "");
    setTempSkills({ ...char.attributes, ...char.skills });
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
            <span className={step === 2 ? "text-cyan-400" : "text-slate-500"}>2. 数值校对</span>
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

            return (
              <div className="space-y-8 animate-in slide-in-from-right-4 duration-500">
                <div className="flex justify-between items-center">
                  <h3 className="text-xl font-bold text-white">数值校对</h3>
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
