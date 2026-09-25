"use client";

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useRoom } from './RoomContext';
import { useConfirmDialog } from './ConfirmDialog';
import type { RoomListItem } from './roomTypes';

interface RoomHistorySectionProps {
  userId: string;
  displayName: string;
  onRoomEnter?: (info: { roomId: string; roomCode: string; needJoin: boolean }) => void;
  refreshKey?: number;
}

export function RoomHistorySection(props: RoomHistorySectionProps) {
  const { userId, displayName, onRoomEnter, refreshKey } = props;
  const { getCreatedRooms, getJoinedRooms, loadRoom, lobbyRefreshKey } = useRoom();
  const { showConfirm, Dialog } = useConfirmDialog();
  const [createdRooms, setCreatedRooms] = useState<RoomListItem[]>([]);
  const [joinedRooms, setJoinedRooms] = useState<RoomListItem[]>([]);
  const [hiddenRoomIds, setHiddenRoomIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const hidden = localStorage.getItem('fish_hidden_rooms');
    if (hidden) {
      try {
        setHiddenRoomIds(JSON.parse(hidden));
      } catch {}
    }
  }, []);

  const hideRoom = (roomId: string) => {
    const newHidden = [...hiddenRoomIds, roomId];
    setHiddenRoomIds(newHidden);
    localStorage.setItem('fish_hidden_rooms', JSON.stringify(newHidden));
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setLoadError(null);
      // 两个列表独立加载：任一失败不会拖空另一个，且把错误暴露出来便于排查
      const [createdResult, joinedResult] = await Promise.allSettled([
        getCreatedRooms(),
        getJoinedRooms(),
      ]);

      if (createdResult.status === 'fulfilled') {
        setCreatedRooms(createdResult.value);
      } else {
        console.error('RoomHistory - 我创建的房间加载失败:', createdResult.reason);
        setCreatedRooms([]);
      }

      if (joinedResult.status === 'fulfilled') {
        setJoinedRooms(joinedResult.value);
      } else {
        console.error('RoomHistory - 我加入的房间加载失败:', joinedResult.reason);
        setJoinedRooms([]);
        const msg = joinedResult.reason?.message || String(joinedResult.reason);
        setLoadError(msg);
      }
      setLoading(false);
    };

    if (userId) {
      loadData();
    }
  }, [userId, getCreatedRooms, getJoinedRooms, refreshKey, lobbyRefreshKey]);

  const handleEnterRoom = async (room: RoomListItem) => {
    try {
      // KP 创建的房间或 PL 活跃成员：直接进入
      const isCreator = room.user_role === 'kp';
      const isActive = room.member_status === 'active' || room.member_status === 'detached';

      // 非 KP 成员不能进入暂停中的房间（只有 KP 进入才会解除暂停）
      if (!isCreator && room.status === 'paused') {
        showConfirm({
          title: '房间暂停中',
          message: '该房间已暂停，请等待KP解除暂停状态后再进入。',
          confirmText: '我知道了',
          cancelText: '',
          confirmColor: '#f59e0b',
          onConfirm: () => {},
        });
        return;
      }

      if (isCreator || isActive) {
        await loadRoom(room.id);
        onRoomEnter?.({ roomId: room.id, roomCode: room.room_code, needJoin: false });
      } else {
        // status: 'left' 或无状态：需要通过 JoinRoomModal 重新加入
        console.log('[RoomHistory] 需要重新加入, member_status:', room.member_status);
        onRoomEnter?.({ roomId: room.id, roomCode: room.room_code, needJoin: true });
      }
    } catch (err: any) {
      toast.error(err.message || '进入房间失败');
    }
  };

  const formatTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins} 分钟前`;
    if (diffHours < 24) return `${diffHours} 小时前`;
    if (diffDays < 7) return `${diffDays} 天前`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="text-cyan-400 animate-pulse text-sm">加载房间历史...</div>
      </div>
    );
  }

  const visibleJoinedRooms = joinedRooms.filter(r => !hiddenRoomIds.includes(r.id));

  const totalRooms = createdRooms.length + visibleJoinedRooms.length;
  if (totalRooms === 0) {
    return (
      <div className="text-center py-8">
        {loadError ? (
          <>
            <div className="text-4xl mb-3">⚠️</div>
            <p className="text-red-400 text-sm mb-1">房间历史加载失败</p>
            <p className="text-slate-500 text-xs">{loadError}</p>
          </>
        ) : (
          <>
            <div className="text-4xl mb-3">📭</div>
            <p className="text-slate-500">暂无历史房间记录</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {Dialog}
      {/* 我创建的房间 */}
      {createdRooms.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-slate-400 mb-3 flex items-center gap-2">
            <span>🎭</span> 我创建的房间
            <span className="text-slate-500 font-normal">({createdRooms.length})</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {createdRooms.map(room => (
              <RoomCard
                key={room.id}
                room={room}
                isCreator
                onEnter={() => handleEnterRoom(room)}
                formatTimeAgo={formatTimeAgo}
              />
            ))}
          </div>
        </div>
      )}

      {/* 我加入的房间 */}
      {visibleJoinedRooms.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-slate-400 mb-3 flex items-center gap-2">
            <span>🚪</span> 我加入的房间
            <span className="text-slate-500 font-normal">({visibleJoinedRooms.length})</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {visibleJoinedRooms.map(room => (
              <RoomCard
                key={room.id}
                room={room}
                onEnter={() => handleEnterRoom(room)}
                onHide={() => hideRoom(room.id)}
                formatTimeAgo={formatTimeAgo}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface RoomCardProps {
  room: RoomListItem;
  isCreator?: boolean;
  onEnter: () => void;
  onHide?: () => void;
  formatTimeAgo: (date: string) => string;
}

function RoomCard({ room, isCreator, onEnter, onHide, formatTimeAgo }: RoomCardProps) {
  const isLeftStatus = room.member_status === 'left';
  
  return (
    <div className="relative group">
      <button
        onClick={onEnter}
        className={`w-full text-left p-4 rounded-xl border transition pr-10 ${
          isLeftStatus 
            ? 'bg-slate-800 border-slate-600 hover:border-amber-500' 
            : 'bg-slate-800 hover:bg-slate-700 border-slate-700 hover:border-cyan-500'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {isCreator && (
                <span className="px-1.5 py-0.5 bg-purple-600 text-xs rounded font-bold text-white">KP</span>
              )}
              {isLeftStatus && (
                <span className="px-1.5 py-0.5 bg-amber-600 text-xs rounded font-bold text-white">需重入</span>
              )}
              <span className="font-bold text-white truncate">{room.name}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>房间号: {room.room_code}</span>
              <span>·</span>
              <span>{formatTimeAgo(room.created_at)}</span>
            </div>
          </div>
          <div className={`transition ${isLeftStatus ? 'text-amber-500 group-hover:text-amber-400' : 'text-slate-500 group-hover:text-cyan-400'}`}>
            →
          </div>
        </div>
      </button>
      {onHide && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onHide();
          }}
          className="absolute top-2 right-2 w-6 h-6 rounded-full bg-slate-700 hover:bg-red-600 text-slate-400 hover:text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
        >
          ✕
        </button>
      )}
    </div>
  );
}
