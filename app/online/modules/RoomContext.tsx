"use client";

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import * as roomService from './roomService';
import type { Room, RoomWithMembers, RoomListItem, CreateRoomInput } from './roomTypes';

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
  deleteRoom: () => Promise<void>;
  loadRoom: (roomId: string) => Promise<void>;
  clearRoom: () => void;
  getCreatedRooms: () => Promise<RoomListItem[]>;
  getJoinedRooms: () => Promise<RoomListItem[]>;
  broadcastMemberRemoved: (roomId: string, removedUserIds?: string[]) => Promise<void>;
  broadcastRoomUpdate: (roomId: string, event?: string) => Promise<void>;
  // 大厅房间历史的实时刷新计数（房间暂停/恢复等状态变化时自动递增）
  lobbyRefreshKey: number;
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
        });

        // 仅在房间状态（active/paused）真正变化时刷新，避免其他字段更新引起无谓刷新
        if (newRow?.status !== oldRow?.status) {
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
    deleteRoom,
    loadRoom,
    clearRoom,
    getCreatedRooms,
    getJoinedRooms,
    broadcastMemberRemoved,
    broadcastRoomUpdate,
    lobbyRefreshKey,
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
