"use client";
import Swal from 'sweetalert2';
import { useState, useEffect } from 'react';
import { CharacterState } from '../page';
import { DEFAULT_AVATAR } from '../../lib/constants';
import { cocCheck } from '../../utils/dice';

interface ConsoleViewProps {
  characters: CharacterState[];
  setCharacters: React.Dispatch<React.SetStateAction<CharacterState[]>>;
}

interface LogEntry {
  id: string;
  time: string;
  name: string;
  label: string;
  roll: number;
  target: number;
  level: string;
  isPushed?: boolean;
  isLuckBurned?: boolean;
  isCriticalFail?: boolean;
}

interface GrowthItem {
  label: string;
  current: number;
  roll100: number | null;
  roll10: number | null;
  isSuccess: boolean;
}

interface DiceGroup {
  count: number;
  sides: number;
}


export default function ConsoleView({ characters, setCharacters }: ConsoleViewProps) {
  const [selectedId, setSelectedId] = useState<string | 'KP'>(characters[0]?.id || 'KP');
  const [rollType, setRollType] = useState<'check' | 'damage' | 'custom' | 'special' | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [lastResult, setLastResult] = useState<LogEntry | null>(() => {
    const savedResult = localStorage.getItem('coc_last_result');
    return savedResult ? JSON.parse(savedResult) : null;
  });
  const [logs, setLogs] = useState<LogEntry[]>(() => {
    const savedLogs = localStorage.getItem('coc_logs');
    return savedLogs ? JSON.parse(savedLogs) : [];
  });
  useEffect(() => {
    localStorage.setItem('coc_logs', JSON.stringify(logs));
  }, [logs]);

  useEffect(() => {
    localStorage.setItem('coc_last_result', JSON.stringify(lastResult));
  }, [lastResult]);

  const [selectedStat, setSelectedStat] = useState<'hp' | 'mp' | 'san' | 'luck'>('hp');
  const [fixedValue, setFixedValue] = useState<number | "">("");
  const [isFixed, setIsFixed] = useState(false);

  const [pendingCheck, setPendingCheck] = useState<{ label: string; target: number; type: 'major_injury' | 'dying' | 'temp_insane' } | null>(null);

  // --- 状态推导变量 ---
  const isKPMode = selectedId === 'KP';
  const currentChar = isKPMode ? null : characters.find(c => c.id === selectedId);
  const isTotallyDead = currentChar?.status?.includes('死亡');
  const isLimited = currentChar?.status?.some(s => ['濒死', '昏迷'].includes(s));

  // --- 具体判定 (Custom) 相关状态 ---
  const [customLabel, setCustomLabel] = useState(""); // 掷骰目的，如“敌人数目”


  const [specialSubPage, setSpecialSubPage] = useState('list'); 
  const [pushResultOverlay, setPushResultOverlay] = useState<{
    show: boolean;
    isSuccess: boolean;
    result: any;
  } | null>(null);
  const [growthList, setGrowthList] = useState<GrowthItem[]>([]);
  const [growthPhase, setGrowthPhase] = useState<'ready' | 'check' | 'result'>('ready');
  // --- 骰子组合 ---
  const [diceGroups, setDiceGroups] = useState<DiceGroup[]>([{ count: 1, sides: 6 }]);
  const [bonusValue, setBonusValue] = useState<number>(0); // 统一的额外加值

  // 添加骰子的函数
  const addDiceGroup = () => {
    if (diceGroups.length < 3) {
      setDiceGroups([...diceGroups, { count: 1, sides: 6 }]);
    }
  };

  // 移除骰子的函数
  const removeDiceGroup = (index: number) => {
    setDiceGroups(diceGroups.filter((_, i) => i !== index));
  };

  // 更新单个骰子组的函数
  const updateDiceGroup = (index: number, field: keyof DiceGroup, value: number) => {
    const newGroups = [...diceGroups];
    newGroups[index][field] = Math.max(1, value);
    setDiceGroups(newGroups);
  };

  // --- 逻辑处理部分 ---

  const toggleStatus = (charId: string, statusName: string) => {
    const targetChar = characters.find(c => c.id === charId);
    if (!targetChar) return;

    const isEntering = !targetChar.status?.includes(statusName);
    const actionLabel = isEntering ? "进入状态" : "解除状态";

    // 1. 更新角色状态
    setCharacters(prev => prev.map(c => {
      if (c.id !== charId) return c;
      const currentStatus = c.status || [];
      const nextStatus = isEntering 
        ? [...currentStatus, statusName]
        : currentStatus.filter(s => s !== statusName);
      return { ...c, status: nextStatus };
    }));

    // 2. 产生一条状态变更日志
    const statusLog: LogEntry = {
      id: Math.random().toString(36).substring(2, 11),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      name: targetChar.name,
      label: `${actionLabel}：${statusName}`, // 记录 label 方便导出识别
      roll: 0,
      target: 0,
      level: isEntering ? "ADDED" : "REMOVED", // 内部标识
    };

    setLogs(prev => [statusLog, ...prev]);
  };

  const executeCheck = (label: string, 
    target: number, 
    isAutoTrigger = false, 
    options: { isPushed?: boolean, isLuckBurned?: boolean, preDefinedResult?: any } = {} // 新增 preDefinedResult
  ) => {
    if (!currentChar) return;

    // 核心逻辑：如果传入了预设结果（推骰用），直接用；否则才掷骰子
    const result = options.preDefinedResult || cocCheck(target);
    const isSuccess = result.level.includes('成功');

    const newEntry: LogEntry = {
      id: Math.random().toString(36).substring(2, 11),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      name: currentChar.name,
      label: label,
      roll: result.roll,
      target: target,
      level: result.level,
      isPushed: options.isPushed,
      isLuckBurned: options.isLuckBurned 
    };

   
    setLastResult({ 
      id: newEntry.id,
      name: currentChar.name,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      label, 
      roll: result.roll, 
      target, 
      level: result.level, 
      isPushed: options.isPushed, 
      isLuckBurned: options.isLuckBurned, 
      isCriticalFail: result.roll >= 98 
    });
    
    setLogs(prev => [newEntry, ...prev]);

      if (isAutoTrigger && pendingCheck) {
        if (pendingCheck.type === 'temp_insane') {
          if (isSuccess && !currentChar.status?.includes('临时疯狂')) toggleStatus(currentChar.id, '临时疯狂');
        } else {
          // 如果检定失败，根据类型切换到 昏迷 或 死亡
          if (!isSuccess) {
            const statusToToggle = pendingCheck.type === 'major_injury' ? '昏迷' : '死亡';
            if (!currentChar.status?.includes(statusToToggle)) toggleStatus(currentChar.id, statusToToggle);
          }
        }
      } else if (!isAutoTrigger) {
        // 濒死状态下的手动“体质”检定：失败则判定死亡
        if (currentChar.status?.includes('濒死') && label === '体质' && !isSuccess) {
          if (!currentChar.status?.includes('死亡')) toggleStatus(currentChar.id, '死亡');
        }
      }
      setPendingCheck(null); 
    };

  const handlePushRoll = () => {
    const effectiveResult = logs.find(log => 
    log.name === currentChar?.name && 
    !log.isPushed && 
    !['理智', '幸运', '损失', '恢复'].some(k => log.label.includes(k))
  );

  if (!effectiveResult || !currentChar) return;

  const alreadyPushed = logs.some(
    log => log.name === currentChar.name && 
           log.label === effectiveResult.label && 
           log.isPushed === true
  );

    const result = cocCheck(effectiveResult.target);
    const isSuccess = result.level.includes('成功');

    executeCheck(effectiveResult.label, effectiveResult.target, false, { 
      isPushed: true, 
      preDefinedResult: result 
    });

    setPushResultOverlay({
      show: true,
      isSuccess: isSuccess,
      result: result
    });

    setTimeout(() => {
      setPushResultOverlay(null);
    }, 5000);
  };

  const handleBurnLuck = (cost: number, originalResult: any) => {
    if (!currentChar) return;

    setCharacters(prev => prev.map(c => {
      if (c.id !== selectedId) return c;
      
      return { 
        ...c, 
        luck: { 
          ...c.luck, 
          current: c.luck.current - cost 
        } 
      };
    }));

    const newEntry: LogEntry = {
      id: Math.random().toString(36).substring(2, 11),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      name: currentChar.name,
      label: `${originalResult.label} [燃烧幸运]`,
      roll: originalResult.target, 
      target: originalResult.target,
      level: '成功',
      isLuckBurned: true, 
      isPushed: originalResult.isPushed
    };
    
    setLogs(prev => [newEntry, ...prev]);
    setLastResult({ 
      id: newEntry.id,
      name: currentChar.name,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      label: newEntry.label, 
      roll: newEntry.roll, 
      target: newEntry.target, 
      level: newEntry.level,
      isPushed: false 
    });

    setSpecialSubPage('list');
  };

  //--- 技能成长 ---
  const NON_SKILL_LABELS = [
    '力量', '敏捷', '意志', '体质', '外貌', '教育', '体型', '智力', 
    '理智', '幸运', '灵感'
  ];

  const prepareGrowth = () => {
    if (!currentChar || !currentChar.skills) return;

    const skillEntries = currentChar.skills as Record<string, number>;

    const successfulSkills = logs
      .filter(log => 
        log.name === currentChar.name && 
        log.level.includes('成功') && 
        !NON_SKILL_LABELS.includes(log.label) &&
        !log.isPushed &&       
        !log.isLuckBurned
      )
      .reduce<GrowthItem[]>((acc, log) => {
        const exists = acc.some(item => item.label === log.label);
        
        if (!exists) {
          const currentVal = skillEntries[log.label] ?? 0;
          
          acc.push({ 
            label: log.label, 
            current: currentVal, 
            roll100: null, 
            roll10: null, 
            isSuccess: false 
          });
        }
        return acc;
      }, []);
    
    setGrowthList(successfulSkills);
    setSpecialSubPage('growth');
    setGrowthPhase('ready');
  };

  const handleSaveGrowth = () => {
    if (!currentChar) return;

    const updatedSkills = { ...currentChar.skills } as Record<string, number>;
    let hasChanges = false;

    growthList.forEach(item => {
      if (item.isSuccess && item.roll10 !== null) {
        const oldValue = updatedSkills[item.label] ?? item.current;
        const newValue = oldValue + item.roll10;
        
        updatedSkills[item.label] = Math.min(newValue, 99);
        hasChanges = true;
      }
    });

    if (hasChanges) {
      setCharacters((prev: CharacterState[]) => 
        prev.map(char => 
          char.id === currentChar.id 
            ? { ...char, skills: updatedSkills } 
            : char
        )
      );
    }

    // 4. UI 跳转回列表页并重置成长状态
    setSpecialSubPage('list');
    setGrowthList([]);
    setGrowthPhase('ready');
  };

  const executeCustomRoll = () => {
    const rollerName = isKPMode ? "守秘人(KP)" : (currentChar?.name || "未知");

    let totalRoll = 0;
    let formulaParts: string[] = [];
    let allDieResults: number[] = []; // 新增

    diceGroups.forEach((group) => {
      formulaParts.push(`${group.count}D${group.sides}`);
      for (let i = 0; i < group.count; i++) {
        const r = Math.floor(Math.random() * group.sides) + 1;
        allDieResults.push(r);
        totalRoll += r;
      }
    });

    const finalResult = totalRoll + bonusValue;
    const formula = formulaParts.join('+');
    const process = allDieResults.join('+');
    const bonusStr = bonusValue !== 0 ? `${bonusValue > 0 ? '+' : ''}${bonusValue}` : '';
    
    // 详情显示为：1D6+1D6 = 3+4 = 7
    const detailLabel = `${formula}${bonusStr} = ${process}${bonusStr} = ${finalResult}`;

    const newLog: LogEntry = {
      id: Math.random().toString(36).substring(2, 11),
      time: new Date().toLocaleTimeString(),
      name: rollerName, 
      label: customLabel || "自由掷骰",
      roll: finalResult,
      target: 0,
      level: detailLabel // 这里会显示完整的过程
    };

    setLogs(prev => [newLog, ...prev]);
    setLastResult({
      id: newLog.id,
      name: newLog.name,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), 
      label: newLog.label, 
      roll: finalResult, 
      target: 0, 
      level: detailLabel 
    });
  };

  const applyValueChange = (isDamage: boolean) => {
    if (!currentChar) return;
    
    let changeAmount = 0;
    let detailLabel = "";

    if (isFixed && fixedValue !== "") {
      // 1. 固定值逻辑 (保持不变)
      changeAmount = Number(fixedValue);
      detailLabel = `${changeAmount}`;
    } else {
      // 2. 多骰子组逻辑
      let totalRoll = 0;
      let formulaParts: string[] = [];
      let allDieResults: number[] = [];

      diceGroups.forEach((group) => {
        formulaParts.push(`${group.count}D${group.sides}`);
        for (let i = 0; i < group.count; i++) {
          const r = Math.floor(Math.random() * group.sides) + 1;
          allDieResults.push(r); 
          totalRoll += r;
        }
      });

      changeAmount = totalRoll + bonusValue;

      const formula = formulaParts.join('+');
      const process = allDieResults.join('+');
      const bonusStr = bonusValue !== 0 ? `${bonusValue > 0 ? '+' : ''}${bonusValue}` : '';
      
      detailLabel = `${formula}${bonusStr} = ${process}${bonusStr} = ${changeAmount}`;
    }
    
    const sign = isDamage ? -1 : 1;
    const finalDelta = changeAmount * sign;
    const oldVal = currentChar[selectedStat].current;
    const maxVal = currentChar[selectedStat].max;
    const newVal = Math.max(0, Math.min(maxVal, oldVal + finalDelta));

    let statusUpdate = [...(currentChar.status || [])];
    let nextCheck: typeof pendingCheck = null;

    if (selectedStat === 'hp' && isDamage) {
      // 1. 即死判定
      if (currentChar.type === 'mob') {
        if (newVal === 0 && !statusUpdate.includes('死亡')) {
          statusUpdate.push('死亡');
        }
      }
      else{
        if (changeAmount >= maxVal) {
          if (!statusUpdate.includes('死亡')) statusUpdate.push('死亡');
        } else {
          // 2. 重伤判定
          if (changeAmount >= maxVal / 2) {
            if (!statusUpdate.includes('重伤')) statusUpdate.push('重伤');
            if (currentChar.type === 'pc' || currentChar.type === 'npc') {
              nextCheck = { label: "体质 (昏迷判定)", target: currentChar.attributes["体质"] || 50, type: 'major_injury' };
            }
          }
          // 3. 归零判定
          if (newVal === 0) {
            if (statusUpdate.includes('重伤')) {
              if (!statusUpdate.includes('濒死')) statusUpdate.push('濒死');
              if (currentChar.type === 'pc' || 'npc') {
                nextCheck = { label: "体质 (濒死维持)", target: currentChar.attributes["体质"] || 50, type: 'dying' };
              }
            } else {
              if (!statusUpdate.includes('昏迷')) statusUpdate.push('昏迷');
            }
          }
        }
      }
    }
    
    if (selectedStat === 'san' && isDamage && (currentChar.type === 'pc' || currentChar.type === 'npc')) {
      if (newVal === 0 && !statusUpdate.includes('永久疯狂')) {
        statusUpdate.push('永久疯狂');
      }
      if (changeAmount >= 5) {
        nextCheck = { label: "智力 (临时疯狂判定)", target: currentChar.attributes["智力"] || 50, type: 'temp_insane' };
      }
    }

    setCharacters(prev => prev.map(c => 
      c.id === selectedId 
        ? { ...c, [selectedStat]: { ...c[selectedStat], current: newVal }, status: statusUpdate } 
        : c
    ));
    setCharacters(prev => prev.map(c => 
      c.id === selectedId 
        ? { ...c, [selectedStat]: { ...c[selectedStat], current: newVal }, status: statusUpdate } 
        : c
    ));

    const addedStatus = statusUpdate.filter(s => !currentChar.status?.includes(s));
    const removedStatus = currentChar.status?.filter(s => !statusUpdate.includes(s)) || [];

    setTimeout(() => {
      addedStatus.forEach(s => {
        const entry: LogEntry = {
          id: Math.random().toString(36).substring(2, 11),
          time: new Date().toLocaleTimeString(),
          name: currentChar.name,
          label: `进入状态：${s}`,
          roll: 0, target: 0, level: "AUTO"
        };
        setLogs(prev => [entry, ...prev]);
      });
    }, 10);

    removedStatus.forEach(s => {
      const entry: LogEntry = {
        id: Math.random().toString(36).substring(2, 11),
        time: new Date().toLocaleTimeString(),
        name: currentChar.name,
        label: `解除状态：${s}`,
        roll: 0, target: 0, level: "AUTO"
      };
      setLogs(prev => [entry, ...prev]);
    });

    const newLog: LogEntry = {
        id: Math.random().toString(36).substring(2, 11),
        time: new Date().toLocaleTimeString(),
        name: currentChar.name,
        label: `${selectedStat.toUpperCase()}${isDamage ? '损失' : '恢复'}`,
        roll: changeAmount,
        target: oldVal,
        level: `${oldVal}→${newVal} (${detailLabel})`
    };
    setLogs(prev => [newLog, ...prev]);
    setLastResult({id: newLog.id,name:newLog.name,time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), label: newLog.label, roll: changeAmount, target: oldVal, level: detailLabel });
    if (nextCheck) setPendingCheck(nextCheck); 
  };

  // 导出为 TXT
  const exportLogs = () => {
    if (logs.length === 0) return;

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; 
    const fileName = `log_${dateStr}_${now.getHours()}${now.getMinutes()}.txt`;

    const header = `--- COC Dice Log Export (${now.toLocaleString()}) ---\n\n`;

    const content = [...logs].reverse().map(log => {
      // 判断是否为状态变更日志
      const isStatusLog = log.label.includes('进入状态') || log.label.includes('解除状态');
      
      if (isStatusLog) {
        // 导出格式：[时间]角色名 - 进入状态：重伤
        return `[${log.time}] ${log.name} - ${log.label}`;
      }

      // 普通掷骰日志逻辑保持不变
      let statusTag = log.isPushed ? " [孤注一掷]" : "";
      const rollDetail = (log.level.includes('成功') || log.level.includes('失败')) 
        ? ` (Roll:${log.roll}/${log.target})` 
        : "";

      return `[${log.time}] ${log.name} - ${log.label}${statusTag}: ${log.level}${rollDetail}`;
    }).join('\n');

    const blob = new Blob([header + content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // --- 渲染部分 ---
  if (characters.length === 0) return <div className="p-20 text-center text-slate-400 font-serif italic">未发现单位（调查员/NPC/怪物）...</div>;

  const renderCharButton = (char: CharacterState) => (
    <button
      key={char.id}
      onClick={() => { setSelectedId(char.id); setSearchTerm(""); setPendingCheck(null); }}
      className={`w-full flex items-center gap-3 p-3 rounded-2xl border transition-all ${
        selectedId === char.id ? 'bg-white border-blue-500 shadow-sm scale-[1.02]' : 'bg-slate-50 border-transparent opacity-60 hover:opacity-100'
      }`}
    >
      <div className={`w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 border-2 ${
        char.type === 'pc' ? 'border-blue-200' : char.type === 'npc' ? 'border-green-200' : 'border-red-200'
      }`}>
        {char.avatar ? <img src={char.avatar} className="w-full h-full object-cover" alt={char.name} /> : <img src={DEFAULT_AVATAR} className="w-full h-full object-cover" alt={char.name} />}
      </div>
      <div className="text-left truncate">
        <div className="text-sm font-bold text-slate-800 truncate flex items-center gap-1">
            {char.name}
        </div>
        <div className="flex flex-wrap gap-1 mt-1">
          {char.status?.map(s => {
          const isInsane = s.includes('疯狂');
          return (
            <span 
              key={s} 
              className={`px-1 py-0.5 text-white text-[7px] font-black rounded leading-none uppercase ${
                isInsane ? 'bg-[#0047AB]' : 'bg-red-600'
              }`}
            >
              {s}
            </span>
          );
        })}
      </div>
    </div>
  </button>
  );

  const pcList = characters.filter(c => c.type === 'pc');
  const npcList = characters.filter(c => c.type === 'npc');
  const mobList = characters.filter(c => c.type === 'mob');

  const allSelectable = currentChar ? { ...(currentChar.attributes || {}), ...(currentChar.skills || {}) } : {};
  const blacklist = ['体力（hp）', '魔法（mp）', '理智（san）', '幸运（luck）', 'hp', 'mp', 'san', 'luck'];
  const filteredItems = Object.entries(allSelectable)
    .filter(([name]) => !blacklist.includes(name.toLowerCase()) && name.toLowerCase().includes(searchTerm.toLowerCase()));

  const handleDeleteLog = (log: any) => {
    Swal.fire({
      title: '确定删除此记录?',
      text: `${log.time} - ${log.label}`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#64748b',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      reverseButtons: true
    }).then((result) => {
      if (result.isConfirmed) {
        setLogs(prev => {
          const newLogs = prev.filter(l => l.id !== log.id);
          // 如果删除的是当前显示的最后结果，同步更新
          if (lastResult?.id === log.id) {
            setLastResult(newLogs.length > 0 ? newLogs[0] : null);
          }
          return newLogs;
        });
      }
    });
  };

  const handleClearAllLogs = () => {
    Swal.fire({
      title: '确定清空所有日志?',
      text: "此操作不可撤销！",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      confirmButtonColor: '#b91c1c',
      reverseButtons: true
    }).then((result) => {
      if (result.isConfirmed) {
        setLogs([]);
        setLastResult(null);
        Swal.fire({
                icon: 'success',
                title: '记录已清空',
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 2000,
              });
      }
    });
  };

  // 自由记录
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [narrativeText, setNarrativeText] = useState("");
  const addNarrativeLog = () => {
    const trimmedText = narrativeText.trim();
    if (!trimmedText) return;

    const newLog: LogEntry = {
      id: Math.random().toString(36).substring(2, 11),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      name: isKPMode ? "守秘人" : (currentChar?.name || "未知"),
      label: "记录",
      roll: 0,
      target: 0,
      level: trimmedText, // 这里的文本可以包含多行
    };

    setLogs(prev => [newLog, ...prev]);
    setNarrativeText("");
  };

  return (
    <div className="relative flex h-[calc(100vh-120px)] gap-6 overflow-hidden p-3 bg-slate-50/50">
      
      {/* --- 左侧列表 --- */}
      <div className="w-56 flex-shrink-0 flex flex-col gap-6 overflow-y-auto pr-2 scrollbar-hide p-1">
        <div className="space-y-2">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] px-2">Keeper</h3>
            <button
                onClick={() => { setSelectedId('KP'); setRollType(null); }}
                className={`w-full flex items-center gap-3 p-3 rounded-2xl border transition-all ${
                    isKPMode ? 'bg-slate-900 border-slate-900 shadow-lg scale-[1.02]' : 'bg-slate-50 border-transparent opacity-60 hover:opacity-100'
                }`}
            >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border-2 ${isKPMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-200 border-slate-300'}`}>
                    <span className={isKPMode ? "text-white" : "text-slate-500"}>🎭</span>
                </div>
                <div className="text-left">
                    <div className={`text-sm font-bold ${isKPMode ? 'text-white' : 'text-slate-800'}`}>守秘人</div>
                    <div className={`text-[9px] uppercase font-black ${isKPMode ? 'text-slate-400' : 'text-slate-400'}`}>Keeper</div>
                </div>
            </button>
        </div>
        {pcList.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-[10px] font-black text-blue-500 uppercase tracking-[0.3em] px-2">Investigator</h3>
            {pcList.map(renderCharButton)}
          </div>
        )}
        {npcList.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-[10px] font-black text-green-500 uppercase tracking-[0.3em] px-2">NPC</h3>
            {npcList.map(renderCharButton)}
          </div>
        )}
        {mobList.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-[10px] font-black text-red-500 uppercase tracking-[0.3em] px-2">Enemy</h3>
            {mobList.map(renderCharButton)}
          </div>
        )}
      </div>

      {/* --- 中间主工作区 --- */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 状态栏显示 */}
        <div className={`grid grid-cols-4 gap-4 transition-opacity duration-500 mt-6 ${isKPMode ? 'opacity-20 grayscale pointer-events-none' : ''}`}>
          {[
            { label: "HP", key: "hp", color: "bg-red-500", text: "text-red-600", icon: "❤️" },
            { label: "MP", key: "mp", color: "bg-blue-500", text: "text-blue-600", icon: "✨" },
            { label: "SAN", key: "san", color: "bg-purple-500", text: "text-purple-600", icon: "🧠" },
            { label: "LUCK", key: "luck", color: "bg-amber-500", text: "text-amber-600", icon: "🍀" }
          ].map(stat => {
            const isMissing = !currentChar || (currentChar.type === 'mob' && stat.key === 'luck');
            return (
              <div key={stat.key} className={`bg-white p-4 rounded-[2rem] border border-slate-200 shadow-sm relative overflow-hidden group ${isMissing ? 'opacity-30' : ''}`}>
                <div className="flex justify-between items-start mb-2">
                  <span className={`text-[10px] font-black uppercase tracking-tighter ${stat.text}`}>{stat.label}</span>
                  <span className="text-xs">{stat.icon}</span>
                </div>
                <div className="flex items-baseline gap-1">
                  {/* @ts-ignore */}
                  <span className="text-2xl font-black text-slate-800">{currentChar?.[stat.key]?.current || 0}</span>
                  {/* @ts-ignore */}
                  <span className="text-xs text-slate-300 font-bold">/ {currentChar?.[stat.key]?.max || 0}</span>
                </div>
                <div className="mt-3 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  {/* @ts-ignore */}
                  <div className={`h-full ${stat.color} transition-all duration-500`} style={{ width: `${((currentChar?.[stat.key]?.current || 0) / (currentChar?.[stat.key]?.max || 1)) * 100}%` }}></div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 动态工作面板 */}
        <div className="relative flex h-[calc(100vh-120px)] w-full gap-4 overflow-hidden px-4 py-2 bg-slate-50/50">
          <div className="absolute inset-0 overflow-y-auto scrollbar-hide">
            <div className="min-h-full flex flex-col items-center justify-center px-12 py-12">
          {/* 规则触发弹窗：KP模式下不会触发此弹窗 */}
          {pendingCheck && !isKPMode && (
            <div className="absolute inset-0 z-20 bg-white/90 backdrop-blur-md flex flex-col items-center justify-center p-8 animate-in fade-in zoom-in duration-300">
              <div className="text-[10px] font-black text-red-500 uppercase tracking-[0.5em] mb-2">Rule Triggered</div>
              <h2 className="text-4xl font-black text-slate-900 mb-4">{pendingCheck.label}？</h2>
              <p className="text-slate-450 text-sm mb-8 text-center max-w-xs font-serif italic">规则要求进行检定。若失败将自动标记对应状态。</p>
              <div className="flex gap-4">
                <button onClick={() => setPendingCheck(null)} className="px-8 py-4 rounded-2xl bg-slate-100 text-slate-400 font-black text-xs hover:bg-slate-200 transition-all">忽略</button>
                <button onClick={() => { setRollType('check'); executeCheck(pendingCheck.label, pendingCheck.target, true); }} className="px-12 py-4 rounded-2xl bg-red-600 text-white font-black text-xs shadow-xl shadow-red-200 hover:scale-105 active:scale-95 transition-all">立即检定</button>
              </div>
            </div>
          )}

          {!rollType ? (
            /* --- 选项主界面 --- */
            <div className="w-full max-w-2xl flex flex-col gap-8">
              <div className="grid grid-cols-2 gap-6">
                {[
                  { id: 'check', title: '技能/属性检定', icon: '🎯', desc: '1D100 对抗或普通判定', needChar: true },
                  { id: 'damage', title: '数值变化', icon: '💥', desc: 'HP/SAN/MP 增减与伤害', needChar: true },
                  { id: 'custom', title: '具体判定', icon: '🎲', desc: '自由掷骰 1D?, 2D6+3...', needChar: false },
                  { id: 'special', title: '特殊规则', icon: '🔥', desc: '孤注一掷/幸运/成长', needChar: true }
                ].map(item => {
                  const isDisabled = isKPMode && item.needChar;
                  return (
                    <button 
                      key={item.id} 
                      disabled={isDisabled}
                      onClick={() => setRollType(item.id as any)} 
                      className={`flex items-start gap-4 p-6 rounded-[2.5rem] border-2 border-dashed transition-all group 
                        ${isDisabled 
                          ? 'opacity-20 grayscale cursor-not-allowed border-slate-100' 
                          : 'bg-slate-50/50 border-slate-200 hover:border-blue-400 hover:bg-blue-50'
                        }`}
                    >
                      <span className="text-4xl group-hover:scale-110 transition-transform">{item.icon}</span>
                      <div className="text-left">
                        <div className="font-black text-slate-700 text-lg mb-1">{item.title}</div>
                        <div className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">{item.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* 只有在非 KP 模式下才显示状态开关 */}
              {!isKPMode ? (
                <div className="flex flex-col items-center gap-4 animate-in fade-in slide-in-from-top-4">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Quick Status Toggle</span>
                  
                  <div className="flex gap-2">
                    {['重伤', '濒死', '昏迷', '死亡'].map(s => (
                      <button 
                        key={s} 
                        onClick={() => toggleStatus(currentChar!.id, s)}
                        className={`px-4 py-2 rounded-xl text-[10px] font-black transition-all border ${
                          currentChar?.status?.includes(s) 
                            ? 'bg-red-600 border-red-600 text-white shadow-lg shadow-red-100' 
                            : 'bg-white border-slate-200 text-slate-400 hover:border-red-300 hover:text-red-500'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    {['临时疯狂', '不定性疯狂', '永久疯狂'].map(s => (
                      <button 
                        key={s} 
                        onClick={() => toggleStatus(currentChar!.id, s)}
                        className={`px-4 py-2 rounded-xl text-[10px] font-black transition-all border ${
                          currentChar?.status?.includes(s) 
                            ? 'bg-[#0047AB] border-[#0047AB] text-white shadow-lg shadow-blue-100' 
                            : 'bg-white border-slate-200 text-slate-400 hover:border-blue-300 hover:text-blue-600'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                /* KP 模式下的提示占位 */
                <div className="flex flex-col items-center py-6 border-t border-slate-100">
                  <span className="text-[10px] font-black text-slate-300 uppercase tracking-[0.3em]">Keeper Control Active</span>
                </div>
              )}
            </div>
          ) : (
            /* --- 具体功能详情界面 --- */
            <div className="w-full h-full flex flex-col animate-in slide-in-from-bottom-6 duration-300">
              <button 
                onClick={() => { setRollType(null); setSearchTerm(""); setLastResult(null); }} 
                className="absolute top-5 left-5 text-slate-400 hover:text-blue-500 flex items-center gap-2 text-xs font-black uppercase tracking-widest transition-colors z-30"
              >
                ← 返回主菜单
              </button>
              
              <div className="flex-1 flex flex-col items-center justify-center">
                <div className="flex items-center gap-3 mb-2 mt-16">
                  <p className="text-3xl font-serif font-bold text-slate-900 italic">
                    {isKPMode ? "守秘人 (Keeper Mode)" : (currentChar?.type === 'pc' ? `调查员：${currentChar?.name}` : currentChar?.name)}
                  </p>
                </div>

                {rollType === 'check' && (
                  <div className="w-full max-w-2xl mt-8 space-y-6">
                    <div className="h-24 flex items-center justify-center">
                      {lastResult ? (
                        <div className="flex flex-col items-center animate-in zoom-in duration-300">
                          <div className="flex items-baseline gap-2">
                            <span className="text-slate-400 text-xs font-bold">{lastResult.label}</span>
                            <span className="text-4xl font-black text-slate-900">{lastResult.roll}</span>
                            <span className="text-slate-400 text-xl font-light">/ {lastResult.target}</span>
                          </div>
                          <div className={`mt-1 px-4 py-1 rounded-full text-white text-xs font-black uppercase tracking-widest ${lastResult.level.includes('成功') ? 'bg-green-500' : 'bg-red-500'}`}>{lastResult.level}</div>
                        </div>
                      ) : <div className="text-slate-300 italic text-sm font-serif">揭示骰子的意志...</div>}
                    </div>  
                    
                    {isTotallyDead ? (
                      <div className="p-12 bg-slate-100 rounded-[2rem] border-2 border-dashed border-slate-300 text-center">
                        <span className="text-4xl mb-4 block">💀</span>
                        <p className="text-slate-600 font-black uppercase tracking-widest text-sm">该角色已死亡</p>
                      </div>
                    ) : (
                      <>
                        {isLimited && (
                          <div className="flex items-center gap-2 px-6 py-3 bg-red-50 border border-red-200 rounded-2xl">
                            <span className="text-lg">🚫</span>
                            <p className="text-red-700 font-black uppercase tracking-widest text-sm">行动受限：无法进行大部分检定</p>
                          </div>
                        )}
                        <input 
                          autoFocus 
                          type="text" 
                          placeholder="搜索技能或属性..." 
                          className="w-full bg-slate-100 border-none rounded-2xl py-4 px-6 text-lg font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm" 
                          value={searchTerm} 
                          onChange={(e) => setSearchTerm(e.target.value)} 
                        />
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
                          {filteredItems.map(([name, value]) => {
                            const isDisabled = isLimited && name !== "体质" && name !== "幸运" && name !== "理智";
                            return (
                              <button 
                                key={name} 
                                disabled={isDisabled}
                                onClick={() => executeCheck(name, value)} 
                                className={`flex flex-row items-start p-4 rounded-2xl border transition-all active:scale-95 relative
                                  ${isDisabled ? 'opacity-20 grayscale cursor-not-allowed' : 'hover:shadow-md'}
                                  ${name === "克苏鲁神话" ? 'bg-slate-900 border-green-900 text-white' 
                                    : name === "理智" ? 'bg-blue-200 border-blue-200'
                                    :'bg-white border-slate-100'}
                                `}
                              >
                                <span className={`text-sm font-bold truncate pr-2 ${
                                  name === '克苏鲁神话' ? 'text-green-400 font-serif italic' : 'text-slate-700'
                                }`}>
                                  {name}
                                </span>
                                <span className={`text-sm font-black font-mono ${
                                  name === '克苏鲁神话' ? 'text-green-500' : name === '理智' ? 'text-blue-600' : 'text-slate-400'
                                }`}>
                                  {value}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {rollType === 'damage' && (
                  <div className="w-full max-w-2xl flex flex-col overflow-y-auto pr-2 custom-scrollbar animate-in fade-in duration-300">
                    <div className="flex flex-col items-center gap-6 py-4">
                      {/* 1. 结果显示区 */}
                      <div className="h-20 flex items-center justify-center w-full">
                        {lastResult ? (
                          <div className="flex flex-col items-center animate-in slide-in-from-top-4">
                            <div className="flex items-baseline gap-3">
                              <span className="text-4xl font-black text-slate-900">
                                {lastResult.label.includes('损失') ? '-' : '+'}{lastResult.roll}
                              </span>
                              <span className="text-slate-400 text-sm italic">({lastResult.level})</span>
                            </div>
                          </div>
                        ) : (
                          <div className="text-slate-300 italic text-sm font-serif">等待指令...</div>
                        )}
                      </div>

                      {/* 2. 存活状态判断 */}
                      {isTotallyDead ? (
                        <div className="p-12 bg-slate-100 rounded-[2rem] border-2 border-dashed border-slate-300 text-center w-full">
                          <span className="text-4xl mb-4 block">💀</span>
                          <p className="text-slate-600 font-black uppercase tracking-widest text-sm">该角色已死亡</p>
                        </div>
                      ) : (
                        <>
                          {/* 属性选择器 */}
                          <div className="flex gap-2 p-1 bg-slate-100 rounded-2xl flex-wrap justify-center w-fit">
                            {['hp', 'mp', 'san', 'luck'].map((k) => (
                              <button
                                key={k}
                                onClick={() => setSelectedStat(k as any)}
                                className={`px-6 py-2 rounded-xl text-xs font-black transition-all ${
                                  selectedStat === k ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400'
                                }`}
                              >
                                {k.toUpperCase()}
                              </button>
                            ))}
                          </div>

                          {/* 核心输入区卡片 */}
                          <div className="w-full bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm space-y-6">
                            <div className="flex items-start gap-6">
                              {/* 左侧：动态骰子列表 */}
                              <div className="flex-1 space-y-3">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                                  掷骰组合
                                </label>
                                {diceGroups.map((group, index) => (
                                  <div key={index} className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2">
                                    <input
                                      type="number"
                                      min="1"
                                      className="w-full h-14 text-center text-xl font-black bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-blue-400 outline-none transition-all"
                                      value={group.count}
                                      onChange={(e) => updateDiceGroup(index, 'count', Number(e.target.value))}
                                    />
                                    <span className="font-serif italic text-xl text-slate-300">D</span>
                                    <input
                                      type="number"
                                      min="1"
                                      className="w-full h-14 text-center text-xl font-black bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-blue-400 outline-none transition-all"
                                      value={group.sides}
                                      onChange={(e) => updateDiceGroup(index, 'sides', Number(e.target.value))}
                                    />
                                    {diceGroups.length > 1 && (
                                      <button
                                        onClick={() => removeDiceGroup(index)}
                                        className="text-slate-300 hover:text-red-400 px-1"
                                      >
                                        ✕
                                      </button>
                                    )}
                                  </div>
                                ))}
                                {diceGroups.length < 3 && (
                                  <button
                                    onClick={addDiceGroup}
                                    className="w-full py-2 border-2 border-dashed border-slate-100 rounded-xl text-slate-400 text-[10px] font-black uppercase hover:bg-slate-50"
                                  >
                                    + Add Dice
                                  </button>
                                )}
                              </div>

                              {/* 分割线 */}
                              <div className="w-px self-stretch bg-slate-100" />

                              {/* 右侧：数值微调 */}
                              <div className="flex flex-col gap-4">
                                <div className="flex flex-col gap-1">
                                  <label className="text-[9px] font-black text-slate-400 ml-1">BONUS</label>
                                  <input
                                    type="number"
                                    className="w-20 h-14 text-center text-xl font-black bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-blue-400 outline-none"
                                    value={bonusValue}
                                    onChange={(e) => setBonusValue(Number(e.target.value))}
                                  />
                                </div>
                                <div className="flex flex-col gap-1">
                                  <label className="text-[9px] font-black text-blue-400 ml-1">FIXED</label>
                                  <input
                                    type="number"
                                    placeholder="固定"
                                    className="w-20 h-14 text-center text-lg font-black bg-blue-50/30 border-2 border-blue-100 rounded-2xl text-blue-600 outline-none"
                                    value={fixedValue}
                                    onChange={(e) => {
                                      const val = e.target.value === '' ? '' : Number(e.target.value);
                                      setFixedValue(val);
                                      setIsFixed(true);
                                    }}
                                  />
                                </div>
                              </div>
                            </div>

                            {/* 3. 底部按钮 */}
                            <div className="grid grid-cols-2 gap-4 h-16">
                              <button
                                onClick={() => applyValueChange(true)}
                                className="bg-slate-900 text-white rounded-2xl font-black hover:bg-red-600 transition-all active:scale-95 shadow-lg"
                              >
                                减少{selectedStat?.toUpperCase()}
                              </button>
                              <button
                                onClick={() => applyValueChange(false)}
                                className="bg-slate-900 text-white rounded-2xl font-black hover:bg-green-600 transition-all active:scale-95 shadow-lg"
                              >
                                恢复{selectedStat?.toUpperCase()}
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {rollType === 'custom' && (
                  <div className="w-full max-w-2xl flex flex-col overflow-y-auto pr-2 custom-scrollbar animate-in fade-in duration-300">
                    <div className="flex flex-col items-center gap-6 py-4">
                      {/* 结果显示区 */}
                      <div className="h-20 flex items-center justify-center w-full">
                        {lastResult ? (
                          <div className="flex flex-col items-center animate-bounce-short">
                            <div className="flex items-baseline gap-3">
                              <span className="text-4xl font-black text-blue-600">{lastResult.roll}</span>
                              <span className="text-slate-400 text-sm italic">({lastResult.level})</span>
                            </div>
                          </div>
                        ) : <div className="text-slate-300 italic text-sm font-serif">揭示骰子的意志...</div>}
                      </div>

                      {/* 核心输入卡片 */}
                      <div className="w-full bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm space-y-6">
                        {/* 掷骰目的 */}
                        <div className="flex flex-col gap-2">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">掷骰目的</label>
                          <input type="text" placeholder="输入本次判定的内容..." 
                            className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl py-3 px-6 text-base font-bold outline-none focus:border-blue-400 transition-all"
                            value={customLabel} onChange={e => setCustomLabel(e.target.value)}
                          />
                        </div>

                        {/* 骰子配置区 */}
                        <div className="flex items-start gap-6">
                          {/* 左侧：动态骰子列表 */}
                          <div className="flex-1 space-y-3">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">掷骰组合</label>
                            {diceGroups.map((group, index) => (
                              <div key={index} className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2">
                                <input type="number" min="1"
                                  className="w-full h-14 text-center text-xl font-black bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-blue-400 outline-none" 
                                  value={group.count} 
                                  onChange={e => updateDiceGroup(index, 'count', Number(e.target.value))} 
                                />
                                <span className="font-serif italic text-xl text-slate-300">D</span>
                                <input type="number" min="1"
                                  className="w-full h-14 text-center text-xl font-black bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-blue-400 outline-none" 
                                  value={group.sides} 
                                  onChange={e => updateDiceGroup(index, 'sides', Number(e.target.value))} 
                                />
                                {diceGroups.length > 1 && (
                                  <button onClick={() => removeDiceGroup(index)} className="text-slate-300 hover:text-red-400 px-1">✕</button>
                                )}
                              </div>
                            ))}
                            {diceGroups.length < 3 && (
                              <button onClick={addDiceGroup} className="w-full py-2 border-2 border-dashed border-slate-100 rounded-xl text-slate-400 text-[10px] font-black uppercase hover:bg-slate-50">+ Add Dice</button>
                            )}
                          </div>

                          {/* 分割线 */}
                          <div className="w-px self-stretch bg-slate-100" />

                          {/* 右侧：加值 */}
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-black text-slate-400 ml-1">BONUS</label>
                            <input type="number" 
                              className="w-20 h-14 text-center text-xl font-black bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-blue-400 outline-none" 
                              value={bonusValue} onChange={e => setBonusValue(Number(e.target.value))}
                            />
                          </div>
                        </div>

                        {/* 掷骰按钮 */}
                        <button onClick={executeCustomRoll}
                          className="w-full h-16 bg-slate-900 text-white rounded-2xl font-black text-lg hover:bg-blue-600 transition-all active:scale-95 shadow-lg shadow-slate-100"
                        >
                          掷骰
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                
                {rollType === 'special' && currentChar?.type === 'mob' && (
                  <div className="text-center p-10 text-slate-400 italic">
                    怪物不支持特殊检定规则
                  </div>
                )}

                {rollType === 'special' && currentChar?.type !== 'mob' && (
                  /* mx-auto 确保了在父容器中居中 */
                  <div className="w-full max-w-2xl mx-auto mt-8 space-y-6 animate-in fade-in zoom-in duration-300">
                    
                    {/* 头部：返回按钮与标题 */}
                    <div className="flex items-center justify-between px-2 h-8">
                      <button 
                        onClick={() => setSpecialSubPage('list')} 
                        className={`text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-2 ${
                          specialSubPage === 'list' ? 'invisible' : 'visible'
                        }`}
                      >
                        <span className="text-xl">←</span> 
                        <span className="text-xs font-black uppercase tracking-widest">返回</span>
                      </button>

                      <div className="w-12"></div>
                    </div>
                    {isTotallyDead ? (
                          <div className="p-16 bg-slate-100 rounded-[3rem] border-2 border-dashed border-slate-300 text-center animate-in fade-in zoom-in-95 duration-500">
                            <span className="text-6xl mb-6 block">💀</span>
                            <h3 className="text-slate-900 font-black text-xl mb-2">该角色已死亡</h3>
                            <p className="text-slate-500 font-medium text-sm px-8 leading-relaxed">
                              死者的命运已成定局。
                            </p>
                          </div>
                        ) : (
                    <>    
                    {/* 第一层：功能选择列表 */}
                    {specialSubPage === 'list' && (
                      <div className="grid grid-cols-1 gap-4 items-center justify-center">
                        
                        {/* 1. 孤注一掷入口 */}
                        <button 
                          onClick={() => setSpecialSubPage('push')}
                          className="group p-6 rounded-[2rem] bg-white border border-slate-200 hover:border-orange-200 hover:shadow-xl hover:shadow-orange-50/50 transition-all flex items-center w-full"
                        >
                          <div className="flex items-center gap-5 flex-1 text-left">
                            <div className="w-14 h-14 shrink-0 rounded-2xl bg-orange-50 flex items-center justify-center text-3xl group-hover:scale-110 transition-transform">
                              🎲
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <div className="font-black text-slate-800 text-base tracking-tight">孤注一掷</div>
                              <div className="text-xs text-slate-400 font-medium whitespace-nowrap">赌上一切，与命运的最终博弈</div>
                            </div>
                          </div>
                          <span className="text-slate-300 group-hover:translate-x-1 transition-transform ml-4">→</span>
                        </button>

                       {/* 2. 燃烧幸运入口 */}
                        <button 
                          onClick={() => setSpecialSubPage('luck')}
                          className="group p-6 rounded-[2rem] bg-white border border-slate-200 hover:border-blue-200 hover:shadow-xl hover:shadow-blue-50/50 transition-all flex items-center w-full"
                        >
                          <div className="flex items-center gap-5 flex-1 text-left">
                            <div className="w-14 h-14 shrink-0 rounded-2xl bg-blue-50 flex items-center justify-center text-3xl group-hover:scale-110 transition-transform">
                              🔥
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <div className="font-black text-slate-800 text-base tracking-tight">燃烧幸运</div>
                              <div className="text-xs text-slate-400 font-medium whitespace-nowrap">用什么来交换更好的结局？</div>
                            </div>
                          </div>
                          <span className="text-slate-300 group-hover:translate-x-1 transition-transform ml-4">→</span>
                        </button>

                        {/* 3. 技能成长入口 */}
                        {currentChar?.type === 'pc' &&(
                          <button 
                          onClick={prepareGrowth}
                          className="group p-6 rounded-[2rem] bg-white border border-slate-200 hover:border-green-200 hover:shadow-xl hover:shadow-green-50/50 transition-all flex items-center w-full"
                        >
                          <div className="flex items-center gap-5 flex-1 text-left">
                            <div className="w-14 h-14 shrink-0 rounded-2xl bg-green-50 flex items-center justify-center text-3xl group-hover:scale-110 transition-transform">
                              🌱
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <div className="font-black text-slate-800 text-base tracking-tight">幕间成长</div>
                              <div className="text-xs text-slate-400 font-medium whitespace-nowrap">在下一个故事开始之前...</div>
                            </div>
                          </div>
                          <span className="text-slate-300 group-hover:translate-x-1 transition-transform ml-4">→</span>
                        </button>
                        )}
                      </div>
                    )}

                    {/* 第二层：孤注一掷专用操作页 */}
                    {specialSubPage === 'push' && (() => {
                      const effectiveResult = (lastResult && lastResult.name === currentChar?.name) 
                        ? lastResult 
                        : logs.find(log => log.name === currentChar?.name && !log.isPushed);
                        
                      const isInvalidForPush = !effectiveResult || effectiveResult.target <= 0;
                      const usedPushLog = logs.find(
                        log => log.name === currentChar?.name && log.isPushed === true
                      );
                      const hasUsedPushInHistory = !!usedPushLog;
                      const forbiddenKeywords = ['理智', '幸运', '损失', '恢复'];
                      const isForbiddenType = effectiveResult && forbiddenKeywords.some(k => effectiveResult.label.includes(k));
                      // 判定是否真的有可用的失败记录
                      const hasFailedRecord = effectiveResult && !effectiveResult.level.includes('成功');

                      return (
                        <div className="space-y-8 animate-in zoom-in-95 duration-300">
                          {pushResultOverlay?.show && (
                            <div className="absolute inset-x-[-1rem] inset-y-[-1rem] z-50 rounded-[3rem] flex flex-col items-center justify-center overflow-hidden">
                              <div className={`absolute inset-0 backdrop-blur-md transition-colors duration-500
                                ${pushResultOverlay.isSuccess 
                                  ? 'bg-green-600/80 shadow-[inset_0_0_60px_rgba(34,197,94,0.8)]' 
                                  : 'bg-red-700/80 shadow-[inset_0_0_60px_rgba(220,38,38,0.8)]'} 
                                animate-[pulse_3s_ease-in-out_infinite]`} 
                              />
                              <div className="relative z-10 flex flex-col items-center justify-center text-white animate-in zoom-in-90 duration-300">
                                <div className="text-xl font-black mb-2 tracking-[0.2em] uppercase drop-shadow-md">
                                  {pushResultOverlay.isSuccess ? '成功' : '失败'}
                                </div>
                                <div className="text-8xl font-black drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)] mb-2">
                                  {pushResultOverlay.result.roll}
                                </div>
                                <div className="text-xl font-bold bg-black/20 px-4 py-1 rounded-full backdrop-blur-sm">
                                  {pushResultOverlay.result.level}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* 展示区 */}
                          <div className="py-10 bg-slate-50 rounded-[3rem] border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-center">
                            {hasUsedPushInHistory ? (
                              <div className="px-6 space-y-2">
                                <div className="text-4xl mb-2">🚫</div>
                                <div className="text-slate-900 font-bold">无法再次使用</div>
                                <p className="text-sm text-slate-500 leading-relaxed">
                                  你曾孤注一掷以试图改变 <span className="text-orange-600 font-bold">【{usedPushLog?.label}】</span> 的检定结果。
                                </p>
                              </div>
                            ): isInvalidForPush ? (
                                /* 极简提示：针对自由掷骰 */
                                <div className="text-slate-400 italic font-medium">
                                  仅技能检定可孤注一掷
                                </div>
                              ) :isForbiddenType ? (
                              <div className="space-y-2">
                                <div className="text-4xl mb-2">🔒</div>
                                <div className="text-slate-900 font-bold">不可孤注一掷</div>
                                <p className="text-sm text-slate-500 leading-relaxed">
                                  规则手册规定：<span className="text-blue-600 font-bold">{effectiveResult?.label}</span> 检定不允许进行孤注一掷。
                                </p>
                              </div>
                              ) : effectiveResult && effectiveResult.roll >= 98 ? (
                                <>
                                <div className="flex items-baseline gap-3">
                                  <span className="text-5xl font-black text-slate-900">{effectiveResult.label}</span>
                                  <span className="text-2xl font-light text-slate-400">/ {effectiveResult.target}</span>
                                </div>
                                <p className="mt-4 text-sm text-slate-500 font-medium max-w-[280px]">
                                  上次出目为 <span className="font-bold text-red-500">{effectiveResult.roll}</span>，属于 <span className="font-bold text-red-600">{effectiveResult.level}</span>。大失败无法通过孤注一掷挽回。
                                </p>
                              </>
                              ) : hasFailedRecord ? (
                              <>
                                <div className="flex items-baseline gap-3">
                                  <span className="text-5xl font-black text-slate-900">{effectiveResult.label}</span>
                                  <span className="text-2xl font-light text-slate-400">/ {effectiveResult.target}</span>
                                </div>
                                <p className="mt-4 text-sm text-slate-500 font-medium max-w-[280px]">
                                  上次出目为 <span className="font-bold text-red-500">{effectiveResult.roll}</span>，属于 <span className="font-bold">{effectiveResult.level}</span>。是否确认进行孤注一掷？
                                </p>
                              </>
                            ) : (
                              <div className="text-slate-400 italic font-medium px-6">
                                {lastResult?.level.includes('成功') 
                                  ? "当前检定已成功，无需孤注一掷" 
                                  : "暂无属于当前角色的失败记录"}
                              </div>
                            )}
                          </div>

                          {/* 操作按钮 */}
                          <div className="space-y-4">
                            <button 
                              disabled={
                                hasUsedPushInHistory || 
                                isForbiddenType ||
                                !hasFailedRecord || 
                                !effectiveResult ||
                                effectiveResult.isPushed || 
                                effectiveResult.roll >= 98 
                              }
                              onClick={() => handlePushRoll()}
                              className="w-full py-6 rounded-[2rem] bg-gradient-to-br from-orange-500 to-red-600 text-white font-black text-lg shadow-xl shadow-orange-200 hover:scale-[1.02] active:scale-95 disabled:opacity-30 disabled:grayscale transition-all"
                            >
                              {hasUsedPushInHistory ? '机会已耗尽' : (effectiveResult && effectiveResult.roll >= 98 ? '不支持孤注一掷': (isForbiddenType ? '不支持孤注一掷' : '确认孤注一掷'))}
                            </button>
                            
                            <p className="text-center text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                              每名角色整场游戏中只有一次孤注一掷的机会。
                            </p>
                          </div>
                        </div>
                      );
                    })()}

                  {/* 第二层：燃烧幸运专用操作页 */}
                  {specialSubPage === 'luck' && (() => {
                    // 核心逻辑修改：直接取该角色在日志里的【最后一条】记录
                    // 不再跳过 isPushed，因为我们要根据它来显示拦截状态
                    const effectiveResult = logs.find(log => log.name === currentChar?.name);

                    const currentLuckVal = currentChar?.luck.current || 0;
                    const luckNeeded = effectiveResult ? (effectiveResult.roll - effectiveResult.target) : 0;
                    const canAfford = currentLuckVal >= luckNeeded;
                    
                    // --- 拦截逻辑与限制 ---
                    const isInvalidForLuck = !effectiveResult || effectiveResult.target <= 0;
                    
                    // 只要最后一条记录是推骰，就判定为 isFromPush
                    const isFromPush = effectiveResult?.isPushed === true;
                    
                    const forbiddenKeywords = ['理智', '幸运', '损失', '恢复'];
                    const isForbiddenType = effectiveResult && forbiddenKeywords.some(k => effectiveResult.label.includes(k));

                    const isAlreadySuccess = effectiveResult?.level.includes('成功');
                    const isCriticalFail = effectiveResult && effectiveResult.roll >= 98; 

                    return (
                      <div className="space-y-8 animate-in zoom-in-95 duration-300">
                        {/* 展示区 */}
                        <div className="py-10 bg-slate-50 rounded-[3rem] border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-center px-6">
                          {/* 1. 优先判定推骰拦截（这是你之前缺失的重点） */}
                          {isFromPush && !isAlreadySuccess ? (
                            <div className="space-y-2">
                              <div className="text-4xl mb-2">🚫</div>
                              <div className="text-slate-900 font-bold">孤注一掷失败</div>
                              <p className="text-sm text-red-500 leading-relaxed font-medium">
                                规则规定：孤注一掷失败后无法通过燃烧幸运来改变结果。
                              </p>
                            </div>
                          ) : isAlreadySuccess ? (
                            <div className="text-slate-400 italic font-medium">当前检定已成功，无需燃烧幸运</div>
                          ) : isInvalidForLuck ? (
                            <div className="text-slate-400 italic font-medium">仅技能检定可燃烧幸运</div>
                          ) : isForbiddenType ? (
                            <div className="space-y-2">
                              <div className="text-4xl mb-2">🔒</div>
                              <div className="text-slate-900 font-bold">不可燃烧幸运</div>
                              <p className="text-sm text-slate-500 leading-relaxed">
                                规则规定：<span className="text-blue-600 font-bold">{effectiveResult?.label}</span> 不支持通过燃烧幸运修改。
                              </p>
                            </div>
                          ) : isCriticalFail ? (
                            <>
                              <div className="flex items-baseline gap-3">
                                <span className="text-5xl font-black text-slate-900">{effectiveResult?.label}</span>
                                <span className="text-2xl font-light text-slate-400">/ {effectiveResult?.target}</span>
                              </div>
                              <p className="mt-4 text-sm text-slate-500 font-medium max-w-[280px]">
                                上次出目为 <span className="font-bold text-red-500">{effectiveResult?.roll}</span>，属于 <span className="font-bold text-red-600">{effectiveResult?.level}</span>。大失败无法燃烧幸运。
                              </p>
                            </>
                          ) : effectiveResult ? (
                            <>
                              <div className="flex items-center gap-4">
                                <div className="flex flex-col">
                                  <span className="text-3xl font-black text-slate-900">【{effectiveResult.label}】</span>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-4xl font-black text-slate-900">{effectiveResult.roll}</span>
                                  <span className="text-[10px] text-slate-400 font-bold uppercase">当前出目</span>
                                </div>
                                <div className="text-2xl text-slate-300">→</div>
                                <div className="flex flex-col">
                                  <span className="text-4xl font-black text-blue-600">{effectiveResult.target}</span>
                                  <span className="text-[10px] text-slate-400 font-bold uppercase">目标值</span>
                                </div>
                              </div>
                              
                              <div className="mt-8 p-4 bg-white rounded-2xl border border-blue-100 shadow-sm w-full max-w-[280px]">
                                <div className="flex justify-between items-center mb-1">
                                  <span className="text-xs text-slate-500 font-bold">所需幸运:</span>
                                  <span className="text-lg font-black text-blue-600">-{luckNeeded}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-xs text-slate-500 font-bold">剩余幸运:</span>
                                  <span className={`text-sm font-black ${canAfford ? 'text-slate-700' : 'text-red-500'}`}>
                                    {currentLuckVal} → {canAfford ? (currentLuckVal - luckNeeded) : '不足'}
                                  </span>
                                </div>
                              </div>
                            </>
                          ) : (
                            <div className="text-slate-400 italic font-medium">暂无有效的失败记录</div>
                          )}
                        </div>

                        {/* 操作按钮 */}
                        <div className="space-y-4">
                          <button 
                            disabled={
                              !effectiveResult || 
                              !canAfford || 
                              isForbiddenType || 
                              isAlreadySuccess || 
                              isCriticalFail || 
                              isInvalidForLuck ||
                              isFromPush // 如果最后一条是推骰，按钮禁用
                            }
                            onClick={() => handleBurnLuck(luckNeeded, effectiveResult)}
                            className="w-full py-6 rounded-[2rem] bg-gradient-to-br from-blue-500 to-indigo-600 text-white font-black text-lg shadow-xl shadow-blue-200 hover:scale-[1.02] active:scale-95 disabled:opacity-30 disabled:grayscale transition-all"
                          >
                            {!effectiveResult ? '无失败记录' : 
                            isFromPush ? '孤注一掷失败不可燃运' :
                            isCriticalFail ? '大失败不可燃烧幸运' :
                            isForbiddenType ? '该检定不支持燃烧幸运' :
                            !canAfford ? '幸运数值不足' : 
                            isAlreadySuccess ? '无需燃烧' : '确认燃烧幸运'}
                          </button>
                          <p className="text-center text-[10px] text-slate-400 font-bold uppercase tracking-widest px-4">
                            燃烧的幸运无法通过一般方式恢复。
                          </p>
                        </div>
                      </div>
                    );
                  })()}
                  {/* 第二层：幕间成长专用操作页 */}
                  {specialSubPage === 'growth' && (
                    <div className="space-y-8 animate-in zoom-in-95 duration-300">
                      {/* 列表展示区 */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
                        {growthList.length > 0 ? (
                          growthList.map((item, idx) => (
                            <div 
                              key={idx}
                              className={`p-5 rounded-[2rem] border transition-all duration-500 flex flex-col justify-center ${
                                item.isSuccess 
                                  ? 'bg-green-50 border-green-200 shadow-sm' 
                                  : 'bg-slate-50 border-slate-100'
                              }`}
                            >
                              <div className="flex justify-between items-center mb-2">
                                <span className="font-black text-slate-700">{item.label}</span>
                                <span className="text-[10px] font-black text-slate-400 bg-white px-2 py-1 rounded-lg border border-slate-100">
                                  初始 {item.current}
                                </span>
                              </div>

                              <div className="flex items-center gap-3">
                                {/* 第一次掷骰：1D100 */}
                                {item.roll100 !== null && (
                                  <div className="flex items-baseline gap-1">
                                    <span className={`text-2xl font-black ${item.isSuccess ? 'text-green-600' : 'text-slate-400'}`}>
                                      {item.roll100}
                                    </span>
                                    <span className="text-[10px] font-bold text-slate-300">/ 100</span>
                                  </div>
                                )}

                                {/* 第二次加值展示 */}
                                {item.roll10 !== null && item.isSuccess && (
                                  <div className="flex items-center gap-2 ml-auto animate-in fade-in slide-in-from-right-2">
                                    <div className="h-4 w-[1px] bg-green-200" />
                                    <span className="text-sm font-black text-green-700">
                                      {item.current} → {item.current + item.roll10}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="col-span-full py-10 text-center text-slate-400 italic font-medium">
                            本次模组中暂无成功检定的技能
                          </div>
                        )}
                      </div>

                      {/* 操作控制区 */}
                      <div className="space-y-4">
                        {growthPhase === 'ready' && (
                          <button 
                            disabled={growthList.length === 0}
                            onClick={() => {
                              const newList = growthList.map(item => {
                                const roll = Math.floor(Math.random() * 100) + 1;
                                return { ...item, roll100: roll, isSuccess: roll > item.current };
                              });
                              setGrowthList(newList);
                              setGrowthPhase('check');
                            }}
                            className="w-full py-6 rounded-[2rem] bg-slate-900 text-white font-black text-lg shadow-xl hover:scale-[1.02] active:scale-95 transition-all"
                          >
                            开始成长判定 (1D100)
                          </button>
                        )}

                        {growthPhase === 'check' && (
                          <button 
                            onClick={() => {
                              const newList = growthList.map(item => {
                                if (item.isSuccess) {
                                  const add = Math.floor(Math.random() * 10) + 1;
                                  return { ...item, roll10: add };
                                }
                                return item;
                              });
                              setGrowthList(newList);
                              setGrowthPhase('result');
                            }}
                            className="w-full py-6 rounded-[2rem] bg-gradient-to-br from-green-500 to-emerald-600 text-white font-black text-lg shadow-xl shadow-green-200 hover:scale-[1.02] active:scale-95 transition-all"
                          >
                            确认加值 (1D10)
                          </button> 
                        )}

                        {growthPhase === 'result' && (
                          <button 
                            onClick={() => {
                              // 这里建议调用你真正的保存逻辑
                              handleSaveGrowth();
                            }}
                            className="w-full py-6 rounded-[2rem] bg-blue-600 text-white font-black text-lg shadow-xl"
                          >
                            完成并保存
                          </button>
                        )}

                        <p className="text-center text-[10px] text-slate-400 font-bold uppercase tracking-widest px-8 leading-relaxed">
                          根据规则：1D100 出目大于技能当前值时，该技能增加 1D10。
                        </p>
                      </div>
                    </div>
                  )}
                </>
                )}
                  </div>
                )}
                
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* --- 右侧：日志常驻区域 --- */}
      <div className="w-72 flex-shrink-0 flex flex-col relative">
        
        {/* 功能操作区 */}
        <div className="flex gap-2 mb-3">
          <button 
            onClick={exportLogs}
            className="flex-1 py-1.5 bg-blue-50 text-blue-600 text-[10px] font-black uppercase rounded-lg hover:bg-blue-600 hover:text-white transition-all border border-blue-100"
          >
            Export TXT
          </button>
          <button 
            onClick={handleClearAllLogs} 
            className="flex-1 py-1.5 bg-red-50 text-red-600 text-[10px] font-black uppercase rounded-lg hover:bg-red-600 hover:text-white transition-all border border-red-100"
          >
            Clear All
          </button>
        </div>
        
        <div className="mb-4">
          <button 
            onClick={() => setIsNoteModalOpen(true)}
            className="w-full py-2 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 text-xs font-bold hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50/50 transition-all flex items-center justify-center gap-2"
          >
            <span>+ 添加笔记</span>
          </button>
        </div>
        {/* 日志内容滚动区 */}
        <div className="space-y-2 overflow-y-auto flex-1 pr-2 custom-scrollbar">
          {logs.length === 0 ? (
            <div className="text-center text-slate-300 py-10 italic text-xs">No records found.</div>
          ) : (
            logs.map(log => {
              const isCheck = log.level.includes('成功') || log.level.includes('失败');
              return (
                <div key={log.id} className={`group relative p-2 rounded-lg border transition-all hover:bg-slate-100 ${log.isPushed ? 'bg-orange-50/50 border-orange-100' : 'bg-slate-50 border-slate-100'}`}>
                  {/* 孤注一掷标签 */}
                  {log.isPushed && (
                    <div className="absolute -right-1 top-7 bg-orange-600 text-white text-[8px] font-black px-1.5 py-0.5 rounded-sm shadow-sm z-10">
                      孤注一掷
                    </div>
                  )}

                  {/* 燃烧幸运标签 */}
                  {log.isLuckBurned && (
                    <div className="absolute -right-1 top-7 bg-blue-600 text-white text-[8px] font-black px-1.5 py-0.5 rounded-sm shadow-sm z-10">
                      燃烧幸运
                    </div>
                  )}

                  {/* 单条删除按钮 */}
                  <button 
                    onClick={() => handleDeleteLog(log)}
                    className="absolute -top-2 -right-2 w-4 h-5 bg-white border border-slate-200 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:text-red-500"
                  >
                    <span className="text-[10px] font-bold">✕</span>
                  </button>

                  <div className="flex justify-between items-start mb-0.5">
                    <div className="text-slate-400 text-[8px] font-mono">{log.time}</div>
                    <div className="text-[13px] font-black px-1.5 py-0.5 bg-slate-200 text-slate-500 rounded uppercase tracking-tighter">{log.name}</div>
                  </div>

                  <div className={`font-bold text-[15px] mb-1 ${log.isPushed ? 'text-orange-900' : (log.isLuckBurned ? 'text-blue-900' :'text-slate-800')}`}>
                    {log.label}
                  </div>

                  <div className="flex items-baseline justify-between">
                    <div className="font-mono text-[12px] text-slate-500">
                      {isCheck ? <span>Roll: <b>{log.roll}</b>/{log.target}</span> : <span className="italic">{log.level}</span>}
                    </div>
                    {isCheck && (
                      <div className={`font-black text-[15px] italic uppercase tracking-tighter ${log.level.includes('成功') ? 'text-green-600' : 'text-red-600'}`}>
                        {log.level}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
        {isNoteModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
              <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <h3 className="font-black text-slate-700">添加剧情笔记</h3>
                <button onClick={() => setIsNoteModalOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
              </div>
              
              <div className="p-4">
                <textarea
                  autoFocus
                  value={narrativeText}
                  onChange={(e) => setNarrativeText(e.target.value)}
                  placeholder="在此输入剧情描述、KP的即兴旁白或关键笔记..."
                  className="w-full h-40 p-3 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-blue-400 outline-none resize-none transition-all"
                />
                
                <div className="mt-4 flex gap-3">
                  <button
                    onClick={() => setIsNoteModalOpen(false)}
                    className="flex-1 py-2.5 rounded-xl font-bold text-slate-500 hover:bg-slate-100 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => {
                      addNarrativeLog();
                      setIsNoteModalOpen(false);
                    }}
                    className="flex-[2] py-2.5 bg-slate-800 text-white rounded-xl font-bold shadow-lg shadow-slate-200 hover:bg-slate-700 active:scale-95 transition-all"
                  >
                    保存并记录
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}