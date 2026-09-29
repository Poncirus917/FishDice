"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import Swal from 'sweetalert2';
import { supabase } from '../../lib/supabase';
import type { PrivateGroupWithMembers } from './roomTypes';
import {
  getPrivateGroups,
  createPrivateGroup,
  deletePrivateGroup,
  setGroupCanSpeak,
} from './roomService';

const PRIVATE_GROUPS_EVENT = 'private_groups_changed';

// ---------- Hook：加载 / 实时同步密聊群 ----------
export function usePrivateGroups(roomId: string) {
  const [groups, setGroups] = useState<PrivateGroupWithMembers[]>([]);
  const [loaded, setLoaded] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await getPrivateGroups(roomId);
      setGroups(list);
    } catch {
      // 静默：实时刷新失败不打断使用
    } finally {
      setLoaded(true);
    }
  }, [roomId]);

  // 变更后广播通知同房间客户端（RLS 下 UPDATE 事件可能不推送，广播兜底）
  const notifyChanged = useCallback(async () => {
    await channelRef.current?.send({ type: 'broadcast', event: PRIVATE_GROUPS_EVENT, payload: {} });
  }, []);

  useEffect(() => {
    // 无房间（如未进入房间的渲染）时不订阅
    if (!roomId) {
      setLoaded(true);
      return;
    }
    refresh();

    const channel = supabase
      .channel(`private-groups-${roomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'private_groups', filter: `room_id=eq.${roomId}` },
        () => refresh()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'private_group_members' },
        () => refresh()
      )
      .on('broadcast', { event: PRIVATE_GROUPS_EVENT }, () => refresh())
      .subscribe();

    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [roomId, refresh]);

  return { groups, loaded, refresh, notifyChanged };
}

// ---------- 组件入参 ----------
interface PrivateChatPanelProps {
  roomId: string;
  userId: string;
  isCreator: boolean;
  // 房间成员（带 profile 与角色名），用于 KP 建群选择 PL、展示群成员名
  members: Array<{
    user_id: string;
    role: 'kp' | 'pl';
    character_name?: string | null;
    profile?: { display_name: string; avatar_url: string | null };
  }>;
  groups: PrivateGroupWithMembers[];
  // 当前选中的密聊群（null = 公屏）
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string | null) => void;
  notifyChanged: () => Promise<void>;
  onClose: () => void;
}

export default function PrivateChatPanel({
  roomId,
  userId,
  isCreator,
  members,
  groups,
  selectedGroupId,
  onSelectGroup,
  notifyChanged,
  onClose,
}: PrivateChatPanelProps) {
  const [busy, setBusy] = useState(false);

  // KP 建群表单
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // 可选 PL（排除 KP）
  const plMembers = members.filter(m => m.role !== 'kp');
  // 成员显示：PC名（PL名），无角色卡时仅 PL 名
  const labelOf = (uid: string) => {
    const m = members.find(x => x.user_id === uid);
    const pl = m?.profile?.display_name || '未知玩家';
    return m?.character_name ? `${m.character_name}（${pl}）` : pl;
  };

  // KP：勾选 / 取消 PL
  const togglePicked = (uid: string) => {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  // KP：确认建群
  const handleCreate = async () => {
    if (picked.size === 0) {
      toast('请至少勾选一名玩家');
      return;
    }
    setBusy(true);
    try {
      const group = await createPrivateGroup({
        roomId,
        createdBy: userId,
        name: newName || undefined,
        memberUserIds: [...picked],
      });
      await notifyChanged();
      setCreating(false);
      setNewName('');
      setPicked(new Set());
      onSelectGroup(group.id);
      toast.success('密聊群已创建');
    } catch (err: any) {
      toast.error(err.message || '创建失败');
    } finally {
      setBusy(false);
    }
  };

  // KP：切换整群禁言
  const handleToggleSpeak = async (group: PrivateGroupWithMembers) => {
    // 当前群状态：任一成员 can_speak=true 视为"允许发言"
    const currentlyAllowed = group.members.some(m => m.can_speak);
    try {
      await setGroupCanSpeak(group.id, !currentlyAllowed);
      await notifyChanged();
      toast.success(!currentlyAllowed ? '已允许该群发言' : '已禁止该群发言');
    } catch (err: any) {
      toast.error(err.message || '操作失败');
    }
  };

  // KP：解散群
  const handleDelete = (group: PrivateGroupWithMembers) => {
    Swal.fire({
      title: '解散密聊群',
      text: `确定解散「${group.name}」吗？历史密聊消息仍保留在各成员的 LOGS 中。`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#991b1b',
      cancelButtonColor: '#475569',
      confirmButtonText: '解散',
      cancelButtonText: '取消',
    }).then(async result => {
      if (!result.isConfirmed) return;
      try {
        await deletePrivateGroup(group.id);
        await notifyChanged();
        if (selectedGroupId === group.id) onSelectGroup(null);
      } catch (err: any) {
        toast.error(err.message || '操作失败');
      }
    });
  };

  return (
    <div className="absolute bottom-full left-0 mb-2 z-50 w-72 bg-slate-800/95 border border-red-950 rounded-2xl shadow-2xl shadow-black/50 backdrop-blur">
      {/* 头部 */}
      <div className="px-4 py-3 border-b border-slate-700/80 flex items-center gap-2">
        <span>🤫</span>
        <span className="font-bold text-sm text-red-200">选择频道</span>
        <button
          onClick={onClose}
          className="ml-auto w-6 h-6 rounded-md text-slate-400 hover:text-white hover:bg-slate-700 transition text-sm leading-none"
        >
          ✕
        </button>
      </div>

      {/* 频道列表：公屏 + 各密聊群 */}
      <div className="p-2 max-h-60 overflow-y-auto space-y-1">
        {/* 公屏 */}
        <div
          onClick={() => onSelectGroup(null)}
          className={`px-2.5 py-2 rounded-lg cursor-pointer border transition ${
            selectedGroupId === null
              ? 'bg-blue-950/60 border-blue-800/80'
              : 'bg-slate-900/50 border-transparent hover:border-slate-700'
          }`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${selectedGroupId === null ? 'bg-blue-400' : 'bg-slate-600'}`}
            />
            <span className="text-xs font-bold text-blue-100/90">💬 公屏（全体可见）</span>
          </div>
        </div>

        {groups.length === 0 && (
          <p className="text-center text-slate-500 text-[11px] py-3 italic">
            {isCreator ? '还没有密聊群，点击下方按钮创建' : '暂无密聊群'}
          </p>
        )}

        {groups.map(g => {
          const active = g.id === selectedGroupId;
          const allowed = g.members.some(m => m.can_speak);
          const imIn = isCreator || g.members.some(m => m.user_id === userId);
          return (
            <div
              key={g.id}
              onClick={() => { onSelectGroup(g.id); onClose(); }}
              className={`px-2.5 py-2 rounded-lg cursor-pointer border transition ${
                active
                  ? 'bg-red-950/60 border-red-800/80'
                  : 'bg-slate-900/50 border-transparent hover:border-slate-700'
              } ${!imIn ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${active ? 'bg-red-400' : 'bg-slate-600'}`}
                />
                <span className="text-xs font-bold text-red-100/90 truncate">{g.name}</span>
                <span className="text-[9px] text-slate-500 flex-shrink-0">{g.members.length}人</span>
                {!allowed && <span title="已禁言" className="text-[10px] flex-shrink-0">🔇</span>}

                {isCreator && (
                  <div className="ml-auto flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={e => { e.stopPropagation(); handleToggleSpeak(g); }}
                      title={allowed ? '禁止该群发言' : '允许该群发言'}
                      className={`w-5 h-5 rounded text-[10px] flex items-center justify-center transition ${
                        allowed
                          ? 'text-emerald-400 hover:bg-slate-700'
                          : 'text-red-400 hover:bg-slate-700'
                      }`}
                    >
                      {allowed ? '🔊' : '🔇'}
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(g); }}
                      title="解散密聊群"
                      className="w-5 h-5 rounded text-[10px] text-slate-500 hover:text-red-400 hover:bg-slate-700 flex items-center justify-center transition"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
              {/* 群成员小字 */}
              <div className="mt-1 pl-4 text-[9px] text-slate-500 truncate">
                {g.members.map(m => labelOf(m.user_id)).join('、')}
              </div>
            </div>
          );
        })}
      </div>

      {/* KP 建群按钮 / 建群表单 */}
      {isCreator && !creating && (
        <button
          onClick={() => setCreating(true)}
          className="mx-2 mb-2 w-[calc(100%-1rem)] py-2 rounded-lg border border-dashed border-red-900 text-[11px] text-red-300/80 hover:bg-red-950/40 transition"
        >
          ＋ 新建密聊群
        </button>
      )}

      {isCreator && creating && (
        <div className="mx-2 mb-2 p-2.5 rounded-lg bg-slate-900/70 border border-slate-700 space-y-2">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="群名称（可选，默认按序号命名）"
            className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-md text-[11px] text-white outline-none focus:border-red-600"
          />
          <div className="max-h-28 overflow-y-auto space-y-0.5">
            {plMembers.map(m => (
              <label
                key={m.user_id}
                className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-slate-800 cursor-pointer"
              >
                <span
                  className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px] flex-shrink-0 ${
                    picked.has(m.user_id)
                      ? 'bg-red-700 border-red-600 text-white'
                      : 'bg-slate-800 border-slate-600 text-transparent'
                  }`}
                >
                  ✓
                </span>
                <input
                  type="checkbox"
                  checked={picked.has(m.user_id)}
                  onChange={() => togglePicked(m.user_id)}
                  className="sr-only"
                />
                <span className="text-[11px] text-slate-300 truncate">
                  {labelOf(m.user_id)}
                </span>
              </label>
            ))}
            {plMembers.length === 0 && (
              <p className="text-[10px] text-slate-500 text-center py-2">房间内暂无其他玩家</p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setCreating(false)}
              disabled={busy}
              className="flex-1 py-1.5 rounded-md text-[11px] text-slate-400 hover:bg-slate-800"
            >
              取消
            </button>
            <button
              onClick={handleCreate}
              disabled={busy}
              className="flex-[2] py-1.5 rounded-md bg-red-800 hover:bg-red-700 text-white text-[11px] font-bold disabled:opacity-50"
            >
              {busy ? '创建中…' : '创建密聊群'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
