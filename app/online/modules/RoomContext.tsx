"use client";

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import * as roomService from './roomService';
import type { Room, RoomWithMembers, RoomListItem, CreateRoomInput, DiceLog, PerformCheckInput, PerformCustomInput } from './roomTypes';
import { cocCheck, rollDiceGroups } from '../../utils/dice';

interface RoomContextType {
  currentRoom: RoomWithMembers | null;
  loading: boolean;
  error: string | null;
  createRoom: (input: CreateRoomInput) => Promise<Room>;
  joinRoom: (roomCode: string, characterId: string) => Promise<void>;
  leaveRoom: (removeOthers?: boolean) => Promise<void>;
  detachFromRoom: () => Promise<void>;
  resumeRoom: () => Promise<void>;
  pauseRoom: () => Promise<void>;
  resumeRoomByKP: () => Promise<void>;
  renameRoom: (name: string) => Promise<void>;
  deleteRoom: () => Promise<void>;
  loadRoom: (roomId: string) => Promise<void>;
  clearRoom: () => void;
  getCreatedRooms: () => Promise<RoomListItem[]>;
  getJoinedRooms: () => Promise<RoomListItem[]>;
  broadcastMemberRemoved: (roomId: string, removedUserIds?: string[]) => Promise<void>;
  broadcastRoomUpdate: (roomId: string, event?: string) => Promise<void>;
  // 大厅房间历史的实时刷新计数（房间暂停/恢复等状态变化时自动递增）
  lobbyRefreshKey: number;
  // 房间共享掷骰 / 消息流（聊天记录式，实时同步）
  diceLogs: DiceLog[];
  performCheck: (input: PerformCheckInput) => Promise<void>;
  performCustomRoll: (input: PerformCustomInput) => Promise<void>;
}

const RoomContext = createContext<RoomContextType | null>(null);

export function RoomProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [currentRoom, setCurrentRoom] = useState<RoomWithMembers | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const currentRoomRef = useRef<RoomWithMembers | null>(null);
  currentRoomRef.current = currentRoom;
  // 用于调试：跟踪最新的 channel 状态
  const channelStatusRef = useRef<string>('uninitialized');
  const [lobbyRefreshKey, setLobbyRefreshKey] = useState(0);
  const [diceLogs, setDiceLogs] = useState<DiceLog[]>([]);

  const setupRoomChannel = useCallback(async (roomId: string) => {
    // 取消旧的 channel
    if (channelRef.current) {
      console.log('[setupRoomChannel] 取消旧 channel:', channelStatusRef.current);
      channelRef.current.unsubscribe();
    }

    const channelName = `room-${roomId}`;
    console.log('[setupRoomChannel] 创建新 channel:', channelName);

    const channel = supabase.channel(channelName);

    // 监听 Postgres Changes（所有表的变化）
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'room_members' },
      async (payload) => {
        const newRoomId = (payload as any).new?.room_id;
        const oldRoomId = (payload as any).old?.room_id;
        console.log('[setupRoomChannel] postgres_changes 收到:', {
          eventType: payload.eventType,
          new_room_id: newRoomId,
          old_room_id: oldRoomId,
          target_room_id: roomId,
        });

        if (newRoomId !== roomId && oldRoomId !== roomId) {
          console.log('[setupRoomChannel] 不是当前房间的变化，忽略');
          return;
        }

        console.log('[setupRoomChannel] 是当前房间的变化，刷新...');
        if (!currentRoomRef.current) {
          console.log('[setupRoomChannel] currentRoom 为 null，忽略刷新');
          return;
        }
        const room = await roomService.getRoom(roomId);
        if (room) {
          console.log('[setupRoomChannel] 房间已刷新:', {
            members: room.members.length,
            member_ids: room.members.map(m => m.user_id),
          });
          setCurrentRoom(room);
        }
      }
    );

    // 监听 dice_logs 新增（掷骰 / 消息实时同步，聊天记录式追加）
    // hidden 暗骰行由 RLS 过滤，PL 客户端根本收不到
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'dice_logs' },
      (payload) => {
        const row = (payload as any).new as DiceLog;
        if (!row || row.room_id !== roomId) return;
        console.log('[setupRoomChannel] dice_logs INSERT:', { id: row.id, msg_type: row.msg_type });
        setDiceLogs(prev => (prev.some(l => l.id === row.id) ? prev : [...prev, row]));
      }
    );

    // 监听广播事件：member_removed
    channel.on('broadcast', { event: 'member_removed' }, async (payload) => {
      console.log('[setupRoomChannel] 收到 member_removed 广播:', payload.payload);
      window.dispatchEvent(new CustomEvent('member-removed', { detail: payload.payload }));
    });

    // 监听广播事件：room_paused（KP 暂停房间，PL 弹窗提示暂离）
    channel.on('broadcast', { event: 'room_paused' }, async () => {
      console.log('[setupRoomChannel] 收到 room_paused 广播');
      window.dispatchEvent(new CustomEvent('room-paused'));
    });

    // 监听广播事件：room_update
    channel.on('broadcast', { event: 'room_update' }, async (payload) => {
      console.log('[setupRoomChannel] 收到 room_update 广播:', payload.payload);
      if (!currentRoomRef.current) {
        console.log('[setupRoomChannel] currentRoom 为 null，忽略广播刷新');
        return;
      }
      const room = await roomService.getRoom(roomId);
      if (room) {
        console.log('[setupRoomChannel] 房间已刷新（广播）:', {
          members: room.members.length,
          member_ids: room.members.map(m => m.user_id),
        });
        setCurrentRoom(room);
      }
    });

    // 订阅 channel
    console.log('[setupRoomChannel] 开始订阅...');
    const sub = await channel.subscribe(async (status) => {
      console.log('[setupRoomChannel] 订阅状态变化:', status);
      channelStatusRef.current = status;
      if (status === 'SUBSCRIBED') {
        console.log('[setupRoomChannel] 订阅成功，channel ready');
      } else if (status === 'CHANNEL_ERROR') {
        console.error('[setupRoomChannel] 订阅错误！');
      }
    });

    console.log('[setupRoomChannel] subscribe 返回值:', sub);
    channelRef.current = channel;

    return () => {
      console.log('[setupRoomChannel] cleanup: 取消 channel');
      channel.unsubscribe();
      channelRef.current = null;
      channelStatusRef.current = 'unsubscribed';
    };
  }, []);

  const broadcastRoomUpdate = useCallback(async (roomId: string, event = 'room_update') => {
    console.log('[broadcastRoomUpdate] 尝试发送:', { roomId, event, channelStatus: channelStatusRef.current });
    if (channelRef.current) {
      try {
        await channelRef.current.send({
          type: 'broadcast',
          event,
        });
        console.log('[broadcastRoomUpdate] 发送成功');
      } catch (err) {
        console.error('[broadcastRoomUpdate] 发送失败:', err);
      }
    } else {
      console.log('[broadcastRoomUpdate] 没有可用的 channel');
    }
  }, []);

  const broadcastMemberRemoved = useCallback(async (roomId: string, removedUserIds?: string[]) => {
    console.log('[broadcastMemberRemoved] 发送事件:', { roomId, removedUserIds, channelStatus: channelStatusRef.current });
    if (channelRef.current) {
      try {
        await channelRef.current.send({
          type: 'broadcast',
          event: 'member_removed',
          payload: { removedUserIds: removedUserIds || [] }
        });
        console.log('[broadcastMemberRemoved] 发送成功');
      } catch (err) {
        console.error('[broadcastMemberRemoved] 发送失败:', err);
      }
    } else {
      console.error('[broadcastMemberRemoved] 没有可用的 channel');
    }
  }, []);

  // 发起一次 1D100 检定：掷骰者客户端掷骰 → 写 dice_logs → 实时推送给全房。
  // 阶段2使用默认房规（大成功 ≤3 / 大失败 ≥98）；阶段3房规字段就位后改读房间配置。
  const performCheck = useCallback(async (input: PerformCheckInput): Promise<void> => {
    const room = currentRoomRef.current;
    if (!room) throw new Error('当前不在房间中');

    const result = cocCheck(input.target);
    await roomService.insertDiceLog({
      room_id: room.id,
      user_id: userId,
      character_id: input.characterId ?? null,
      char_name: input.charName ?? null,
      msg_type: input.hidden ? 'hidden' : 'check',
      label: input.label,
      roll: result.roll,
      target: input.target,
      level: result.level,
    });
    // 不需要本地追加：自己的 INSERT 也会通过 Postgres Changes 回推，保持单一数据源
  }, [userId]);

  // 发起一次自由掷骰：本地按 NdM(+加值) 结算 → 写 dice_logs（msg_type='custom'）→ 实时推送给全房。
  // level 字段存完整过程明细，与单机版格式一致，如 2D6+1 = 3+2+1 = 6
  const performCustomRoll = useCallback(async (input: PerformCustomInput): Promise<void> => {
    const room = currentRoomRef.current;
    if (!room) throw new Error('当前不在房间中');

    const groups = (input.groups || []).filter(g => g.count >= 1 && g.sides >= 1);
    if (groups.length === 0) throw new Error('请配置至少一组有效骰子');

    const bonus = input.bonus || 0;
    const result = rollDiceGroups(groups, bonus);

    const formula = result.parts.map(p => `${p.group.count}D${p.group.sides}`).join('+');
    const process = result.parts.flatMap(p => p.rolls).join('+');
    const bonusStr = bonus !== 0 ? `${bonus > 0 ? '+' : ''}${bonus}` : '';
    const detail = `${formula}${bonusStr} = ${process}${bonusStr} = ${result.total}`;

    await roomService.insertDiceLog({
      room_id: room.id,
      user_id: userId,
      character_id: input.characterId ?? null,
      char_name: input.charName ?? null,
      msg_type: 'custom',
      label: input.label?.trim() || '自由掷骰',
      roll: result.total,
      target: null,
      level: detail,
    });
  }, [userId]);

  const loadRoom = useCallback(async (roomId: string): Promise<void> => {
    console.log('[loadRoom] 开始加载房间:', roomId);
    setLoading(true);
    setError(null);
    try {
      const room = await roomService.getRoom(roomId);
      console.log('[loadRoom] 房间数据:', { id: room?.id, status: room?.status, members: room?.members?.length });
      if (room) {
        const isRoomCreator = room.creator_id === userId;

        if (isRoomCreator && room.status === 'paused') {
          // KP 进入暂停房间：自动解除暂停，房间恢复 active
          await roomService.resumeRoomByKP(roomId);
          room.status = 'active';
          console.log('[loadRoom] KP 进入，房间已自动恢复');
        }

        // 若我是暂离成员且房间已恢复（active），进入时自动恢复为 active（保留原角色卡）
        const myMember = room.members.find(m => m.user_id === userId);
        if (myMember && myMember.status === 'detached' && room.status === 'active') {
          await roomService.resumeRoom(roomId, userId);
          myMember.status = 'active';
          myMember.left_at = null;
        }
        setCurrentRoom(room);
        await setupRoomChannel(roomId);
        console.log('[loadRoom] channel 设置完成');

        // 拉取历史掷骰 / 消息日志（订阅建立后再拉，避免漏掉订阅前的瞬间插入；按 id 去重合并）
        try {
          const history = await roomService.getDiceLogs(roomId);
          setDiceLogs(prev => {
            const map = new Map(prev.map(l => [l.id, l]));
            history.forEach(l => map.set(l.id, l));
            return Array.from(map.values()).sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
          });
        } catch (logErr) {
          console.error('[loadRoom] 加载掷骰日志失败:', logErr);
        }
      } else {
        setError('房间不存在');
      }
      setLoading(false);
    } catch (err: any) {
      console.error('[loadRoom] 加载失败:', err);
      setError(err.message || '加载房间失败');
      setLoading(false);
      throw err;
    }
  }, [setupRoomChannel]);

  const createRoom = useCallback(async (input: CreateRoomInput): Promise<Room> => {
    setLoading(true);
    setError(null);
    try {
      const room = await roomService.createRoom(userId, input);
      setLoading(false);
      return room;
    } catch (err: any) {
      setError(err.message || '创建房间失败');
      setLoading(false);
      throw err;
    }
  }, [userId]);

  const joinRoom = useCallback(async (roomCode: string, characterId: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const room = await roomService.joinRoom(userId, { room_code: roomCode, character_id: characterId });
      await loadRoom(room.id);
    } catch (err: any) {
      setError(err.message || '加入房间失败');
      setLoading(false);
      throw err;
    }
  }, [userId]);

  const leaveRoom = useCallback(async (removeOthers = false): Promise<void> => {
    if (!currentRoom) {
      console.log('[leaveRoom] currentRoom 为 null，跳过');
      return;
    }
    console.log('[leaveRoom] 开始执行:', { roomId: currentRoom.id, userId, removeOthers });
    setLoading(true);
    setError(null);
    try {
      // 更新数据库
      await roomService.leaveRoom(currentRoom.id, userId, removeOthers);
      console.log('[leaveRoom] DB 更新完成');

      // 发送广播通知其他客户端
      if (channelRef.current) {
        console.log('[leaveRoom] 发送广播，channel status:', channelStatusRef.current);
        if (removeOthers) {
          await channelRef.current.send({
            type: 'broadcast',
            event: 'member_removed',
            payload: { removedUserIds: ['all'] }
          });
          console.log('[leaveRoom] 已广播 member_removed (all)');
        } else {
          await channelRef.current.send({
            type: 'broadcast',
            event: 'room_update',
            payload: { removedUserId: userId }
          });
          console.log('[leaveRoom] 已广播 room_update (PL 退出)');
        }
      } else {
        console.warn('[leaveRoom] channel 不存在，无法广播');
      }

      // 广播发送完成后，再清空本地状态
      setCurrentRoom(null);
      currentRoomRef.current = null;
      setDiceLogs([]);
      console.log('[leaveRoom] 本地状态已清空');

      setLoading(false);
    } catch (err: any) {
      console.error('[leaveRoom] 失败:', err);
      setError(err.message || '离开房间失败');
      setLoading(false);
      throw err;
    }
  }, [currentRoom, userId]);

  const detachFromRoom = useCallback(async (): Promise<void> => {
    if (!currentRoom) return;
    setLoading(true);
    setError(null);
    try {
      await roomService.detachFromRoom(currentRoom.id, userId);
      if (channelRef.current) {
        await channelRef.current.send({
          type: 'broadcast',
          event: 'room_update',
          payload: { detachedUserId: userId }
        });
      }
      setCurrentRoom(null);
      currentRoomRef.current = null;
      setDiceLogs([]);
      setLoading(false);
    } catch (err: any) {
      setError(err.message || '暂离房间失败');
      setLoading(false);
      throw err;
    }
  }, [currentRoom, userId]);

  const pauseRoom = useCallback(async (): Promise<void> => {
    if (!currentRoom) return;
    setLoading(true);
    setError(null);
    try {
      await roomService.pauseRoom(currentRoom.id);
      if (channelRef.current) {
        // 暂停房间：广播 room_paused（不是 member_removed，PL 应看到"房间已暂停"而非"被移除"）
        await channelRef.current.send({
          type: 'broadcast',
          event: 'room_paused',
          payload: {}
        });
      }
      setCurrentRoom(prev => prev ? { ...prev, status: 'paused' } : null);
      setLoading(false);
    } catch (err: any) {
      setError(err.message || '暂停房间失败');
      setLoading(false);
      throw err;
    }
  }, [currentRoom]);

  const resumeRoomByKP = useCallback(async (): Promise<void> => {
    if (!currentRoom) return;
    setLoading(true);
    setError(null);
    try {
      await roomService.resumeRoomByKP(currentRoom.id);
      setCurrentRoom(prev => prev ? { ...prev, status: 'active' } : null);
      setLoading(false);
    } catch (err: any) {
      setError(err.message || '恢复房间失败');
      setLoading(false);
      throw err;
    }
  }, [currentRoom]);

  // KP 修改房间名：更新数据库后本地即时改名，并广播 room_update 让房内 PL 重新拉取
  const renameRoom = useCallback(async (name: string): Promise<void> => {
    const room = currentRoomRef.current;
    if (!room) return;
    const trimmed = name.trim();
    if (!trimmed) throw new Error('房间名称不能为空');
    if (trimmed.length > 30) throw new Error('房间名称不能超过30个字');

    setError(null);
    try {
      await roomService.renameRoom(room.id, trimmed);
      setCurrentRoom(prev => prev ? { ...prev, name: trimmed } : null);
      // 房内 PL 不订阅 rooms 表变更，通过广播触发其 getRoom 刷新
      await broadcastRoomUpdate(room.id);
    } catch (err: any) {
      setError(err.message || '房间名更新失败');
      throw err;
    }
  }, [broadcastRoomUpdate]);

  const deleteRoom = useCallback(async (): Promise<void> => {
    if (!currentRoom) return;
    setLoading(true);
    setError(null);
    try {
      if (channelRef.current) {
        await channelRef.current.send({
          type: 'broadcast',
          event: 'member_removed',
          payload: { removedUserIds: ['all'] }
        });
      }
      await roomService.deleteRoom(currentRoom.id);
      setCurrentRoom(null);
      currentRoomRef.current = null;
      setDiceLogs([]);
      setLoading(false);
    } catch (err: any) {
      setError(err.message || '删除房间失败');
      setLoading(false);
      throw err;
    }
  }, [currentRoom]);

  const clearRoom = useCallback(() => {
    if (channelRef.current) {
      channelRef.current.unsubscribe();
      channelRef.current = null;
    }
    setCurrentRoom(null);
    currentRoomRef.current = null;
    setDiceLogs([]);
  }, []);

  // 大厅实时订阅：监听 rooms 表 UPDATE（如 KP 进入暂停房间后自动恢复 active），
  // 房间状态一变就递增 lobbyRefreshKey，驱动房间历史自动刷新，无需 PL 手动刷新页面
  useEffect(() => {
    if (!userId) return;

    const lobbyChannel = supabase.channel(`lobby-rooms-${userId}`);

    lobbyChannel.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'rooms' },
      (payload) => {
        const newRow = (payload as any).new;
        const oldRow = (payload as any).old;
        console.log('[lobby-realtime] rooms UPDATE:', {
          roomId: newRow?.id,
          oldStatus: oldRow?.status,
          newStatus: newRow?.status,
          oldName: oldRow?.name,
          newName: newRow?.name,
        });

        // 房间状态（active/paused）或房间名变化时刷新大厅列表（如 KP 改名）
        if (newRow?.status !== oldRow?.status || newRow?.name !== oldRow?.name) {
          setLobbyRefreshKey(k => k + 1);
        }
      }
    );

    // 监听自己的成员记录变化（如 KP 在自己暂离期间将其移除：status → removed）
    // RLS 只放行本人可见的成员行，再在此按 user_id 精确过滤，确保只响应自己的变更
    lobbyChannel.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'room_members' },
      (payload) => {
        const newRow = (payload as any).new;
        const oldRow = (payload as any).old;
        if (newRow?.user_id !== userId) return;

        console.log('[lobby-realtime] room_members UPDATE:', {
          roomId: newRow?.room_id,
          oldStatus: oldRow?.status,
          newStatus: newRow?.status,
        });

        // 状态变化即刷新历史（被移除时房间卡片应实时消失，无需手动刷新）
        if (newRow?.status !== oldRow?.status) {
          setLobbyRefreshKey(k => k + 1);
        }
      }
    );

    lobbyChannel.subscribe((status) => {
      console.log('[lobby-realtime] 订阅状态:', status);
    });

    return () => {
      lobbyChannel.unsubscribe();
    };
  }, [userId]);

  const getCreatedRooms = useCallback(async (): Promise<RoomListItem[]> => {
    return await roomService.getUserCreatedRooms(userId);
  }, [userId]);

  const getJoinedRooms = useCallback(async (): Promise<RoomListItem[]> => {
    return await roomService.getUserJoinedRooms(userId);
  }, [userId]);

  useEffect(() => {
    return () => {
      if (channelRef.current) {
        channelRef.current.unsubscribe();
      }
    };
  }, []);

  const value: RoomContextType = {
    currentRoom,
    loading,
    error,
    createRoom,
    joinRoom,
    leaveRoom,
    detachFromRoom,
    resumeRoom: async () => {},
    pauseRoom,
    resumeRoomByKP,
    renameRoom,
    deleteRoom,
    loadRoom,
    clearRoom,
    getCreatedRooms,
    getJoinedRooms,
    broadcastMemberRemoved,
    broadcastRoomUpdate,
    lobbyRefreshKey,
    diceLogs,
    performCheck,
    performCustomRoll,
  };

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

export function useRoom(): RoomContextType {
  const context = useContext(RoomContext);
  if (!context) {
    throw new Error('useRoom must be used within a RoomProvider');
  }
  return context;
}
