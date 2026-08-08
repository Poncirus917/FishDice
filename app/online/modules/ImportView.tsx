"use client";
import Swal from 'sweetalert2';
import { useState, useRef } from 'react';
import { parseCharacterText } from '../../utils/parser';
import { CharacterState } from '../../(single)/page';

interface ImportViewProps {
  onConfirm: (char: CharacterState) => void;
  characters: CharacterState[]; 
  setCharacters: React.Dispatch<React.SetStateAction<CharacterState[]>>; 
}

export default function ImportView({ onConfirm, characters, setCharacters }: ImportViewProps) {
  const [activeTab, setActiveTab] = useState<'pc' | 'npc' | 'mob'>('pc');
  const [step, setStep] = useState<1 | 2>(1); 
  const [name, setName] = useState("");
  const [plName, setPlName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [rawText, setRawText] = useState("");
  const [tempSkills, setTempSkills] = useState<Record<string, number>>({});
  const [editingId, setEditingId] = useState<string | null>(null); 
  const [expandedId, setExpandedId] = useState<string | null>(null); 
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newSkillName, setNewSkillName] = useState("");
  const [newSkillValue, setNewSkillValue] = useState<number>(0);
  const clamp = (val: number, type?: string) => {
    const max = type === 'mob' ? 9999 : 99; 
    return Math.min(Math.max(val, 0), max);
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setAvatar(reader.result as string);
      reader.readAsDataURL(file);
    }
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

    const finalHP = Math.floor((con + siz) / 10);
    const finalMP = Math.floor(pow / 5);
    
    const newChar: CharacterState = {
      id: editingId || Date.now().toString(),
      name: name || (activeTab === 'pc' ? "未命名调查员" : "未命名生物"),
      type: activeTab, // 核心修改：保存当前选择的类型
      plName: activeTab === 'pc' ? (plName || "未知PL") : "GM操作",
      avatar: avatar || undefined,
      hp: { current: finalHP, max: finalHP },
      mp: { current: finalMP, max: finalMP },
      san: { current: activeTab === 'mob' ? 0 : pow , max: 99 }, // 怪物通常SAN为0
      luck: { current: clamp(tempSkills["幸运"] || 0), max: 99 },
      skills: Object.fromEntries(Object.entries(tempSkills).map(([k, v]) => [k, clamp(v)])),
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
    setRawText("");
    setStep(1);
  };

  const handleEdit = (char: CharacterState) => {
    setEditingId(char.id);
    setActiveTab(char.type); // 同步编辑对象的类型
    setName(char.name);
    setPlName(char.plName || "");
    setAvatar(char.avatar || null);
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
      confirmButtonColor: "#ef4444", // tailwind red-500
      cancelButtonColor: "#64748b",  // tailwind slate-500
      confirmButtonText: "确定删除",
      cancelButtonText: "取消",
      reverseButtons: true // 让确定按钮在右边，符合现代习惯
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
    <div className="flex flex-col gap-8">
      {/* 顶部标签切换 */}
      <div className="flex p-1 bg-slate-200/50 rounded-2xl w-fit self-center">
        {[
          { id: 'pc', label: '调查员 (PC)', color: 'text-blue-600' },
          { id: 'npc', label: 'NPC', color: 'text-emerald-600' },
          { id: 'mob', label: '怪物 ', color: 'text-red-600' }
        ].map(t => (
          <button
            key={t.id}
            onClick={() => { if(!editingId) setActiveTab(t.id as any); }}
            className={`px-6 py-2 rounded-xl text-xs font-black transition-all ${
              activeTab === t.id ? 'bg-white shadow-sm ' + t.color : 'text-slate-400 hover:text-slate-600'
            } ${editingId ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-slate-50 px-8 py-4 border-b flex justify-between items-center">
          <div className="flex gap-4 text-sm font-bold">
            <span className={step === 1 ? "text-blue-600" : "text-slate-400"}>1. 基础资料</span>
            <span className="text-slate-300">/</span>
            <span className={step === 2 ? "text-blue-600" : "text-slate-400"}>2. 数值校对</span>
          </div>
          {editingId && <span className="text-xs bg-amber-100 text-amber-600 px-2 py-1 rounded-lg font-bold">正在编辑模式</span>}
        </div>

        <div className="p-8">
          {step === 1 && (
            <div className="space-y-8 animate-in fade-in duration-500">
              <div className="flex flex-col md:flex-row gap-8 items-start">
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="w-32 h-32 rounded-2xl bg-slate-100 border-2 border-dashed border-slate-300 flex flex-col items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all overflow-hidden group relative"
                >
                  {avatar ? <img src={avatar} alt="预览" className="w-full h-full object-cover" /> : (
                    <div className="text-center p-2">
                      <span className="text-2xl text-slate-400">📷</span>
                      <p className="text-[10px] text-slate-500 mt-1">上传头像</p>
                    </div>
                  )}
                  <input type="file" ref={fileInputRef} hidden accept="image/*" onChange={handleAvatarChange} />
                </div>

                <div className="flex-1 space-y-4 w-full">
                  <input 
                    className="w-full bg-slate-50 border-none rounded-xl p-3 focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder={activeTab === 'pc' ? "调查员姓名" : (activeTab === 'npc' ? 'NPC姓名' : '怪物名')} value={name} onChange={(e) => setName(e.target.value)}
                  />
                  {activeTab === 'pc' && (
                    <input 
                      className="w-full bg-slate-50 border-none rounded-xl p-3 focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                      placeholder="玩家(PL)名称" value={plName} onChange={(e) => setPlName(e.target.value)}
                    />
                  )}
                </div>
              </div>

              <textarea 
                className="w-full bg-slate-50 border-none rounded-xl p-4 min-h-[200px] focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm"
                placeholder={activeTab === 'pc'||'npc' ? "粘贴数值文本...例如：力量50 敏捷60..." : "在此输入属性或技能，格式：力量80 斗殴60 触手攻击50"}
                value={rawText} onChange={(e) => setRawText(e.target.value)}
              />

              <button 
                onClick={handleToStep2}
                disabled={!name}
                className={`w-full text-white py-4 rounded-xl font-bold transition-all shadow-lg ${
                    activeTab === 'mob' ? 'bg-red-600 hover:bg-red-700' : (activeTab === 'npc' ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700')
                } disabled:bg-slate-200`}
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
                  <h3 className="text-xl font-bold">数值校对</h3>
                  <button onClick={() => setStep(1)} className="text-slate-400 text-xs hover:text-blue-600">← 返回上一步</button>
                </div>

                <section>
                  <h4 className="text-sm font-bold text-slate-700 mb-4 uppercase">核心属性</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {["力量", "敏捷", "意志", "体质", "外貌", "教育", "体型", "智力", "体力（HP）", "魔法（MP）", "理智", "幸运"].map(attr => {
                      if(attr === "理智" && (activeTab !== 'pc' && activeTab!='npc')) return null;
                      
                      const isDerived = activeTab === 'mob' 
                        ? (attr === "理智") 
                        : ["体力（HP）", "魔法（MP）", "理智"].includes(attr);

                      let displayValue = tempSkills[attr] || 0;

                      if (activeTab !== 'mob') {
                        if (attr === "体力（HP）") displayValue = derivedHP;
                        if (attr === "魔法（MP）") displayValue = derivedMP;
                        if (attr === "理智") displayValue = derivedSAN;
                      }

                      return (
                        <div key={attr} className={`p-3 rounded-2xl border ...`}>
                          <label className={`text-xs font-bold ...`}>{attr}</label>
                          <input 
                            type="number" 
                            className={`w-12 bg-transparent text-right font-bold outline-none ${isDerived ? 'text-blue-700 cursor-not-allowed' : 'text-slate-900'}`}
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
                  <h4 className="text-sm font-bold text-slate-700 mb-4 uppercase">技能列表</h4>
                  <div className="flex gap-2 mb-4 p-3 bg-blue-50/50 rounded-2xl border border-blue-100/50">
                    <input 
                      type="text" 
                      placeholder="新技能名称..."
                      className="flex-1 bg-white border-none rounded-xl px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-400"
                      value={newSkillName}
                      onChange={(e) => setNewSkillName(e.target.value)}
                    />
                    <input 
                      type="number" 
                      className="w-16 bg-white border-none rounded-xl px-2 py-2 text-sm text-center outline-none focus:ring-1 focus:ring-blue-400"
                      value={newSkillValue}
                      onChange={(e) => setNewSkillValue(parseInt(e.target.value) || 0)}
                    />
                    <button 
                      onClick={handleAddNewSkill}
                      className="bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-blue-700 transition-colors"
                    >
                      添加
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[300px] overflow-y-auto pr-2">
                    {Object.entries(tempSkills).map(([key, value]) => {
                      if (["力量", "敏捷", "意志", "体质", "外貌", "教育", "体型", "智力", "体力（HP）", "魔法（MP）", "理智", "幸运"].includes(key)) return null;
                      return (
                        <div key={key} className="flex items-center justify-between p-3 border rounded-xl bg-white border-slate-200 group">
                          <span className="text-sm text-slate-600">{key}</span>
                          <div className="flex items-center gap-2">
                            <input 
                              type="number" className="w-12 text-right font-semibold outline-none bg-transparent text-slate-900"
                              value={value} 
                              onChange={(e) => setTempSkills({...tempSkills, [key]: clamp(parseInt(e.target.value) || 0)})}
                            />
                            <button 
                              onClick={() => {
                                const { [key]: _, ...rest } = tempSkills;
                                setTempSkills(rest);
                              }}
                              className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 text-xs transition-all"
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
                    activeTab === 'mob' ? 'bg-red-900 hover:bg-black' : 'bg-slate-900 hover:bg-black'
                }`}>
                  {editingId ? "保存修改" : "完成创建"}
                </button>
              </div>
            );
          })()}
        </div>
      </div>

      {/* 角色列表显示逻辑 */}
      <div className="mt-8 space-y-4">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest px-4">当前载入角色 ({characters.length})</h3>
        <div className="space-y-3">
          {characters.map((char) => (
            <div key={char.id} className={`bg-white border rounded-3xl overflow-hidden shadow-sm hover:shadow-md transition-all ${
                char.type === 'mob' ? 'border-red-100 shadow-red-50/50' : 'border-slate-200'
            }`}>
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold overflow-hidden border ${
                      char.type === 'pc' ? 'bg-blue-100 text-blue-600 border-blue-50' : 
                      char.type === 'npc' ? 'bg-emerald-100 text-emerald-600 border-emerald-50' : 'bg-red-100 text-red-600 border-red-50'
                  }`}>
                    {char.avatar ? <img src={char.avatar} className="w-full h-full object-cover" /> : char.name[0]}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-800">{char.name}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-black uppercase ${
                            char.type === 'pc' ? 'bg-blue-100 text-blue-600' :
                            char.type === 'npc' ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'
                        }`}>
                        {char.type === 'mob' ? 'enemy' : char.type}
                    </span>
                    </div>
                    <div className="text-xs text-slate-400">{char.type === 'pc' ? `PL: ${char.plName}` : 'NPC角色'}</div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setExpandedId(expandedId === char.id ? null : char.id)} className="px-3 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50 rounded-xl transition">
                    {expandedId === char.id ? "收起" : "展开"}</button>
                  <button onClick={() => handleEdit(char)} className="px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition">编辑</button>
                  <button onClick={() => handleDelete(char.id)} className="px-3 py-2 text-xs font-bold text-red-500 hover:bg-red-50 rounded-xl transition">删除</button>
                </div>
              </div>
              {expandedId === char.id && (
                <div className="px-6 pb-6 pt-2 bg-slate-50/50 border-t border-slate-50 animate-in slide-in-from-top-2 duration-300">
                  {/* 手动构造 12 个核心数值 */}
                  <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-12 gap-2 mb-4">
                    {[
                      { label: "力量", value: char.attributes["力量"] },
                      { label: "敏捷", value: char.attributes["敏捷"] },
                      { label: "意志", value: char.attributes["意志"] },
                      { label: "体质", value: char.attributes["体质"] },
                      { label: "外貌", value: char.attributes["外貌"] },
                      { label: "教育", value: char.attributes["教育"] },
                      { label: "体型", value: char.attributes["体型"] },
                      { label: "智力", value: char.attributes["智力"] },
                      { label: "HP", value: char.hp.max, color: "text-green-600" },
                      { label: "MP", value: char.mp.max, color: "text-blue-600" },
                      { label: "SAN", value: char.san.current, color: "text-purple-600" },
                      { label: "幸运", value: char.luck.current, color: "text-amber-600" },
                    ].map((item) => (
                      <div key={item.label} className="flex flex-col items-center bg-white p-2 rounded-xl border border-slate-100 shadow-sm transition-transform hover:scale-105">
                        <span className="text-[10px] text-slate-400 font-bold uppercase">{item.label}</span>
                        <span className={`text-sm font-black ${item.color || 'text-slate-700'}`}>{item.value}</span>
                      </div>
                    ))}
                  </div>

                  {/* 技能列表部分 */}
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(char.skills).filter(([s]) => ![
                        "力量", "敏捷", "意志", "体质", "外貌", "教育", "体型", "智力", 
                        "体力", "魔法", "理智", "幸运", "体力（HP）", "魔法（MP）", "HP", "MP", "SAN"
                      ].includes(s)).map(([s, v]) => {
                      const isCthulhu = s === "克苏鲁神话";
                      return (
                        <div
                          key={s}
                          className={`px-2 py-1 border rounded-lg text-[11px] shadow-sm transition-all
                            ${isCthulhu
                              ? "bg-green-900 border-green-700 text-orange-500 font-serif italic"
                              : "bg-white border-slate-200 text-slate-600"}`}
                        >
                          <span className={isCthulhu ? "font-black" : "font-medium"}>{s}</span>
                          <span className={`ml-1 font-bold ${isCthulhu ? "text-orange-400" : "text-blue-600"}`}>{v}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
          {characters.length === 0 && (
            <div className="text-center py-12 border-2 border-dashed border-slate-100 rounded-3xl text-slate-300 text-sm">暂无已导入的角色</div>
          )}
        </div>
      </div>
    </div>
  );
}