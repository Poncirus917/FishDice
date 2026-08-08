"use client";
import { useState, useEffect } from 'react';
import Sidebar from '../components/Sidebar';
import ImportView from './views/ImportView';
import ConsoleView from './views/ConsoleView';

// 1. 修改接口定义
export interface CharacterState {
  id: string;
  name: string;
  // 新增：区分角色类型
  type: 'pc' | 'npc' | 'mob'; 
  avatar?: string;
  plName?: string;
  hp: { current: number; max: number };
  mp: { current: number; max: number };
  san: { current: number; max: number };
  luck: { current: number; max: number };
  skills: Record<string, number>;
  attributes: Record<string, number>;
  status: string[];
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<'import' | 'console'>('import');
  const [characters, setCharacters] = useState<CharacterState[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const [redirecting, setRedirecting] = useState(true);

  useEffect(() => {
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    const isOnlineDeploy =
      process.env.NEXT_PUBLIC_APP_MODE === 'online' ||
      host.includes('fish-dice-online') ||
      host.includes('online');
    if (isOnlineDeploy) {
      window.location.replace('/online/auth');
    } else {
      setRedirecting(false);
    }
  }, []);

  if (redirecting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-cyan-400 animate-pulse text-sm tracking-widest">LOADING...</div>
      </div>
    );
  }

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