"use client";

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import Swal from 'sweetalert2';
import { supabase } from '../../lib/supabase';
import { DEFAULT_AVATAR } from '../../lib/constants';
import type { CharacterState } from '../../(single)/page';

interface KpcImportModalProps {
  userId: string;
  busy: boolean;
  onSelect: (characterId: string) => void;
  onClose: () => void;
}

// KP 从角色库选一个 PC 作为 KPC（仅限一个）
export default function KpcImportModal({ userId, busy, onSelect, onClose }: KpcImportModalProps) {
  const [pcChars, setPcChars] = useState<CharacterState[]>([]);

  // 选择前二次确认：KPC 导入后不可更换或移除
  const confirmSelect = (char: CharacterState) => {
    Swal.fire({
      title: '确认导入 KPC',
      html: `确定将「<b class="text-purple-400">${char.name}</b>」设为 KPC 吗？<br/><span class="text-xs text-slate-400">KPC 导入后不可更换或移除，请在确认前慎重选择。</span>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#7e22ce',
      cancelButtonColor: '#475569',
      confirmButtonText: '确认导入',
      cancelButtonText: '取消',
    }).then(result => {
      if (result.isConfirmed) onSelect(char.id);
    });
  };

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('characters')
        .select('data')
        .eq('owner_id', userId);
      if (error) {
        toast.error('加载角色库失败');
        return;
      }
      const list = (data || [])
        .map((row: any) => row.data as CharacterState)
        .filter(c => c.type === 'pc');
      setPcChars(list);
    })();
  }, [userId]);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[65] p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h2 className="text-lg font-bold text-white">导入 KPC</h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-slate-400 hover:text-white text-xl disabled:opacity-50"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <p className="text-xs text-slate-500">
            选择一个 PC 角色作为你扮演的 KPC。KPC 的角色卡可见性遵循房规设置，导入后不可更换或移除。
          </p>

          {pcChars.length === 0 && (
            <p className="text-center text-slate-500 text-xs py-5">
              角色库中暂无 PC 角色，请到「角色管理」页面创建
            </p>
          )}

          <div className="space-y-2">
            {pcChars.map(char => (
              <div
                key={char.id}
                className="flex items-center gap-3 p-2.5 rounded-xl border bg-slate-800/60 border-slate-800 hover:border-purple-700/60 transition"
              >
                <div className="w-9 h-9 rounded-lg bg-purple-700 flex items-center justify-center text-sm font-bold overflow-hidden flex-shrink-0">
                  <img src={char.avatar || DEFAULT_AVATAR} alt="" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-bold text-white truncate">{char.name}</span>
                </div>
                <button
                  onClick={() => confirmSelect(char)}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50 transition"
                >
                  选择
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-5 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition disabled:opacity-50"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
