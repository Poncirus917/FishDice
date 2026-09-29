"use client";

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import type { CharacterState } from '../../(single)/page';
import type { RoomNpcEntry } from './roomTypes';
import { supabase } from '../../lib/supabase';
import { DEFAULT_AVATAR } from '../../lib/constants';
import { getRoomNpcEntries, addRoomNpcEntry } from './roomService';

interface NpcImportModalProps {
  userId: string;
  roomId: string;
  /** 添加的类型：npc / mob（由侧栏所在分区决定） */
  addType: 'npc' | 'mob';
  onClose: () => void;
}

// KP 从角色库选择角色加入房间：
// - 加入后默认不在场（可在侧栏行内切换）
// - NPC 每个房间只能加入一次；同一种怪物可加入多个实例
export default function NpcImportModal({ userId, roomId, addType, onClose }: NpcImportModalProps) {
  const isMobType = addType === 'mob';
  const [myChars, setMyChars] = useState<CharacterState[]>([]);
  const [entries, setEntries] = useState<RoomNpcEntry[]>([]);
  const [busy, setBusy] = useState(false);

  // 加载：KP 自己的角色库（按类型过滤）+ 房间当前实例（用于 NPC 已加入判断）
  useEffect(() => {
    (async () => {
      const [{ data: charData, error: charError }, entryList] = await Promise.all([
        supabase
          .from('characters')
          .select('data')
          .eq('owner_id', userId),
        getRoomNpcEntries(roomId).catch(() => [] as RoomNpcEntry[]),
      ]);

      if (charError) {
        toast.error('加载角色库失败');
        return;
      }
      const list = (charData || [])
        .map((row: any) => row.data as CharacterState)
        .filter(c => c.type === addType);
      setMyChars(list);
      setEntries(entryList);
    })();
  }, [userId, roomId, addType]);

  // 从角色库加入一个（默认不在场）
  const handleAdd = async (character: CharacterState) => {
    setBusy(true);
    try {
      const entry = await addRoomNpcEntry(roomId, character);
      setEntries(prev => [...prev, entry]);
      toast.success(`「${character.name}」已加入房间（当前不在场）`);
    } catch (err: any) {
      toast.error(err.message || '加入失败');
    } finally {
      setBusy(false);
    }
  };

  // 角色库中每个角色当前的实例数
  const countOf = (charId: string) => entries.filter(e => e.character_id === charId).length;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h2 className="text-lg font-bold text-white">添加{isMobType ? '怪物' : 'NPC'}</h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-slate-400 hover:text-white text-xl disabled:opacity-50"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          <section className="space-y-2">
            <p className="text-xs font-bold text-cyan-400 flex items-center gap-1.5">
              <span>📚</span> 我的角色库
            </p>

            {myChars.length === 0 && (
              <p className="text-center text-slate-500 text-xs py-5">
                角色库中暂无{isMobType ? '怪物' : 'NPC'}，请到「角色管理」页面创建
              </p>
            )}

            <div className="space-y-2">
              {myChars.map(char => {
                const count = countOf(char.id);
                const npcAdded = !isMobType && count > 0;
                return (
                  <div
                    key={char.id}
                    className="flex items-center gap-3 p-2.5 rounded-xl border bg-slate-800/60 border-slate-800"
                  >
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold overflow-hidden flex-shrink-0 ${
                      isMobType ? 'bg-red-700' : 'bg-emerald-700'
                    }`}>
                      <img src={char.avatar || DEFAULT_AVATAR} alt="" className="w-full h-full object-cover" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white truncate">{char.name}</span>
                        {count > 0 && (
                          <span className="text-[10px] text-slate-400">
                            房间内 {count} 个
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => handleAdd(char)}
                      disabled={busy || npcAdded}
                      title={npcAdded ? 'NPC 每个房间只能加入一次' : '加入房间（默认不在场）'}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition ${
                        npcAdded
                          ? 'bg-slate-700/50 text-slate-500 cursor-not-allowed'
                          : 'bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-50'
                      }`}
                    >
                      {npcAdded ? '已加入' : '+ 加入'}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* 底部 */}
        <div className="p-4 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-5 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition disabled:opacity-50"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
