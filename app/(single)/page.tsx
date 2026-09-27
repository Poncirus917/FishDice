"use client";
import { useState, useEffect } from 'react';
import Sidebar from '../components/Sidebar';
import ImportView from './views/ImportView';
import ConsoleView from './views/ConsoleView';

// 武器的伤害组成：一段 XDY 骰子（最多 3 段相加）
export interface WeaponDicePart {
  count: number;
  sides: number;
}

// 角色武器（最多 6 把，含默认"肉搏"）
export interface Weapon {
  name: string;
  skill: string;              // 使用技能（须为技能列表中存在的技能）
  type: 'melee' | 'ranged';   // 近战 / 远程
  damage: WeaponDicePart[];   // 伤害骰子段；近战结算时自动追加伤害加值（DB）
  attacks: number;            // 一回合内可使用次数
  multi: boolean;             // 一次攻击可否打多人
  malfunction: number | null; // 故障值，null = 无
}

// 角色法术（全部手动输入，法术名称必填）
export interface Spell {
  name: string;    // 法术名称
  cost: string;    // 使用代价
  effect: string;  // 作用
  note: string;    // 备注
}

// 1. 修改接口定义
export interface CharacterState {
  id: string;
  name: string;
  // 新增：区分角色类型
  type: 'pc' | 'npc' | 'mob';
  avatar?: string;
  plName?: string;
  story?: string;
  hp: { current: number; max: number };
  mp: { current: number; max: number };
  san: { current: number; max: number };
  luck: { current: number; max: number };
  skills: Record<string, number>;
  attributes: Record<string, number>;
  status: string[];
  weapons?: Weapon[];
  // 调查员背景 8 栏（key 为栏目名：形象描述/思想与信念/重要之人/意义非凡之地/宝贵之物/特质/伤口和疤痕/恐惧症和狂躁症）
  backgrounds?: Record<string, string>;
  // 随身物品（多行，上限 20）
  possessions?: string[];
  // 法术列表
  spells?: Spell[];
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<'import' | 'console'>('import');
  const [characters, setCharacters] = useState<CharacterState[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  // --- 持久化逻辑 ---
  useEffect(() => {
    const saved = localStorage.getItem('fish-dice-kp-vault');
    if (saved) {
      try {
        setCharacters(JSON.parse(saved));
      } catch (e) {
        console.error("解析本地数据失败", e);
      }
    }
    setIsInitialized(true);
  }, []);

  useEffect(() => {
    if (isInitialized) {
      localStorage.setItem('fish-dice-kp-vault', JSON.stringify(characters));
    }
  }, [characters, isInitialized]);
  // --- 持久化逻辑结束 ---

  const handleAddCharacter = (newChar: CharacterState) => {
    setCharacters(prev => [...prev, newChar]);
  };

  return (
    <div className="flex h-screen w-full bg-slate-50 text-black font-sans overflow-hidden">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto custom-scrollbar">
        <div className="w-full h-full p-4">
          {activeTab === 'import' && (
            <div className="max-w-6xl mx-auto">
            <ImportView 
              onConfirm={handleAddCharacter} 
              characters={characters} 
              setCharacters={setCharacters} 
            />
            </div>
          )}
          {activeTab === 'console' && (
            <ConsoleView characters={characters} setCharacters={setCharacters} />
          )}
        </div>
      </main>
    </div>
  );
}