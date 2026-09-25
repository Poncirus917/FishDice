"use client";

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useRoom } from './RoomContext';

interface CreateRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRoomCreated?: (roomId: string) => void;
}

export function CreateRoomModal({ isOpen, onClose, onRoomCreated }: CreateRoomModalProps) {
  const { createRoom, loadRoom } = useRoom();
  const [roomName, setRoomName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    const trimmedName = roomName.trim();
    if (!trimmedName) {
      toast.error('请输入房间名称');
      return;
    }
    if (trimmedName.length > 30) {
      toast.error('房间名称不能超过30个汉字');
      return;
    }

    setSubmitting(true);
    try {
      const room = await createRoom({ name: trimmedName });
      await loadRoom(room.id);
      toast.success(`房间创建成功！房间号：${room.room_code}`);
      setRoomName('');
      onClose();
      onRoomCreated?.(room.id);
    } catch (err: any) {
      toast.error(err.message || '创建失败');
    }
    setSubmitting(false);
  };

  const handleClose = () => {
    if (submitting) return;
    setRoomName('');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-md bg-slate-800 rounded-2xl shadow-2xl border border-slate-700 p-6 mx-4"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-center text-cyan-400 mb-6">创建房间</h2>

        <div className="mb-6">
          <label className="block text-sm font-medium mb-2 text-slate-300">房间名称</label>
          <input
            type="text"
            value={roomName}
            onChange={e => setRoomName(e.target.value)}
            maxLength={30}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            className="w-full p-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-cyan-500 outline-none text-white transition"
            placeholder="输入房间名称（30字以内）"
            autoFocus
          />
          <p className="text-xs text-slate-500 mt-1 text-right">
            {roomName.length}/30
          </p>
        </div>

        <div className="space-y-3">
          <button
            onClick={handleSubmit}
            disabled={submitting || !roomName.trim()}
            className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-bold transition shadow-lg shadow-cyan-900/30"
          >
            {submitting ? '创建中...' : '创建房间'}
          </button>
          <button
            onClick={handleClose}
            disabled={submitting}
            className="w-full py-2 text-slate-400 hover:text-slate-200 text-sm transition"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
