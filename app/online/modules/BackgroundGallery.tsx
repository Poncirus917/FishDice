"use client";

import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import Swal from 'sweetalert2';
import { supabase } from '../../lib/supabase';
import { DEFAULT_BACKGROUND } from '../../lib/constants';
import type { RoomBackground } from './roomTypes';
import BackgroundCropper from './BackgroundCropper';
import {
  getRoomBackgrounds,
  addRoomBackground,
  deleteRoomBackground,
  updateRoomBackgroundNote,
} from './roomService';

// 背景图图库上限
export const MAX_BACKGROUNDS = 20;
// Supabase Storage 桶名
const BUCKET = 'room-backgrounds';

interface BackgroundGalleryProps {
  roomId: string;
  userId: string;
  activeUrl: string | null;
  // 中央背景区当前宽高比（裁剪时按此比例输出）
  aspect: number;
  // 应用 / 移除当前背景（url=null 表示移除）
  onApply: (url: string | null, note: string | null) => Promise<void>;
  onClose: () => void;
}

export default function BackgroundGallery({
  roomId,
  userId,
  activeUrl,
  aspect,
  onApply,
  onClose,
}: BackgroundGalleryProps) {
  const [list, setList] = useState<RoomBackground[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  // 待裁剪图片的 object URL
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 初次加载图库
  useEffect(() => {
    let alive = true;
    getRoomBackgrounds(roomId)
      .then(data => {
        if (!alive) return;
        setList(data);
      })
      .catch(err => {
        if (alive) toast.error(err.message || '背景图库加载失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // 选择文件后进入裁剪
  const openCropper = () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) { toast('请先选择一张图片'); return; }
    if (list.length >= MAX_BACKGROUNDS) {
      toast.error(`最多只能保存 ${MAX_BACKGROUNDS} 张背景图`);
      return;
    }
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(URL.createObjectURL(file));
  };

  const closeCropper = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  };

  // 裁剪完成：上传裁剪结果 → 写入图库记录
  const handleCropped = async (blob: Blob) => {
    closeCropper();
    setBusy(true);
    try {
      const path = `${roomId}/${crypto.randomUUID()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (uploadError) throw new Error(uploadError.message);

      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const row = await addRoomBackground({
        roomId,
        userId,
        url: urlData.publicUrl,
        storagePath: path,
        note: note.trim() || null,
      });

      setList([...list, row]);
      setNote('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      toast.success('背景图已导入');
    } catch (err: any) {
      toast.error(err.message || '导入失败');
    } finally {
      setBusy(false);
    }
  };

  // 设为当前背景
  const handleApply = async (bg: RoomBackground) => {
    setApplyingId(bg.id);
    try {
      await onApply(bg.url, bg.note);
      toast.success('已更换背景');
    } catch (err: any) {
      toast.error(err.message || '背景切换失败');
    } finally {
      setApplyingId(null);
    }
  };

  // 编辑备注
  const handleEditNote = async (bg: RoomBackground) => {
    const res = await Swal.fire({
      title: '编辑备注',
      input: 'text',
      inputValue: bg.note ?? '',
      inputPlaceholder: '给这张背景图加个备注（可留空）',
      showCancelButton: true,
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      confirmButtonColor: '#0891b2',
      cancelButtonColor: '#475569',
      reverseButtons: true,
      inputValidator: v => ((v || '').length <= 60 ? null : '备注最多 60 个字'),
    });
    if (!res.isConfirmed) return;
    const nextNote = (res.value || '').trim() || null;
    try {
      await updateRoomBackgroundNote(bg.id, nextNote);
      setList(list.map(x => (x.id === bg.id ? { ...x, note: nextNote } : x)));
      // 正在使用的背景同步更新备注
      if (activeUrl === bg.url) await onApply(bg.url, nextNote);
      toast.success('备注已保存');
    } catch (err: any) {
      toast.error(err.message || '备注保存失败');
    }
  };

  // 删除背景图（若正在使用则先移除背景）
  const handleDelete = async (bg: RoomBackground) => {
    const res = await Swal.fire({
      title: '删除这张背景图？',
      text: bg.note || '删除后无法恢复',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonColor: '#dc2626',
      cancelButtonColor: '#475569',
      reverseButtons: true,
    });
    if (!res.isConfirmed) return;
    try {
      if (activeUrl === bg.url) await onApply(null, null);
      await deleteRoomBackground(bg.id);
      // Storage 对象清理失败不影响图库记录删除
      await supabase.storage.from(BUCKET).remove([bg.storage_path]);
      setList(list.filter(x => x.id !== bg.id));
      toast.success('已删除');
    } catch (err: any) {
      toast.error(err.message || '删除失败');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-[52rem] max-w-[92vw] max-h-[86vh] bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl p-5 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="font-bold text-cyan-300 text-sm">🖼 背景图库</span>
          <span className="text-[11px] text-slate-500">{list.length}/{MAX_BACKGROUNDS}</span>
          <button
            onClick={onClose}
            className="ml-auto w-7 h-7 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition text-sm leading-none"
          >
            ✕
          </button>
        </div>

        {/* 导入区 */}
        <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="flex-1 min-w-0 text-xs text-slate-400 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-slate-700 file:text-slate-200 file:text-xs file:font-bold hover:file:bg-slate-600 file:cursor-pointer"
          />
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') openCropper(); }}
            placeholder="备注（可选，最多 60 字）"
            maxLength={60}
            className="w-52 bg-slate-900/70 border border-slate-700 rounded-xl px-3 py-1.5 text-xs outline-none focus:border-cyan-500 transition"
          />
          <button
            onClick={openCropper}
            disabled={busy || list.length >= MAX_BACKGROUNDS}
            className="px-4 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition disabled:opacity-40 flex-shrink-0"
          >
            {busy ? '导入中…' : '✂️ 裁剪并导入'}
          </button>
        </div>
        <p className="text-[10px] text-slate-500 -mt-2 flex-shrink-0">
          选择图片后先裁剪：裁剪框比例与房间背景区一致，最长边输出 1920px；图片存入房间图库，房内成员实时共享。
        </p>

        {/* 图库网格（第一张为内置默认背景，不可删除） */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <p className="text-center text-slate-500 text-xs py-10 animate-pulse">加载中…</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                {/* 默认背景：不可删除；移除自定义背景后自动回退到此图 */}
                <div
                  className={`rounded-xl overflow-hidden border flex flex-col ${
                    !activeUrl ? 'border-cyan-500 ring-1 ring-cyan-500/60' : 'border-slate-700'
                  }`}
                >
                  <div className="relative aspect-video bg-slate-900">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={DEFAULT_BACKGROUND}
                      alt="默认背景"
                      className="w-full h-full object-cover"
                      draggable={false}
                    />
                    <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-200 text-[10px] font-bold">
                      默认背景
                    </span>
                    {!activeUrl && (
                      <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-cyan-600 text-white text-[10px] font-bold">
                        使用中
                      </span>
                    )}
                  </div>
                  <div className="p-2 flex flex-col gap-1.5 bg-slate-900/60">
                    <span className="text-[11px] text-slate-300 truncate">默认背景</span>
                    <button
                      onClick={() => onApply(null, null)}
                      disabled={!activeUrl}
                      className={`w-full py-1 rounded-lg text-[11px] font-bold transition ${
                        !activeUrl
                          ? 'bg-cyan-950 text-cyan-500/70 cursor-default'
                          : 'bg-cyan-700/80 hover:bg-cyan-600 text-white'
                      }`}
                    >
                      {!activeUrl ? '当前背景' : '恢复默认'}
                    </button>
                  </div>
                </div>

                {list.map(bg => {
                  const active = bg.url === activeUrl;
                  return (
                    <div
                      key={bg.id}
                      className={`group rounded-xl overflow-hidden border flex flex-col ${
                        active
                          ? 'border-cyan-500 ring-1 ring-cyan-500/60'
                          : 'border-slate-700 hover:border-slate-600'
                      }`}
                    >
                      <div className="relative aspect-video bg-slate-900">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={bg.url}
                          alt={bg.note || '背景图'}
                          className="w-full h-full object-cover"
                          draggable={false}
                        />
                        {active && (
                          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-cyan-600 text-white text-[10px] font-bold">
                            使用中
                          </span>
                        )}
                        <button
                          onClick={() => handleDelete(bg)}
                          title="删除这张背景图"
                          className="absolute top-1.5 right-1.5 w-5 h-5 rounded bg-black/60 text-slate-300 hover:text-white hover:bg-red-600 text-[10px] leading-none opacity-0 group-hover:opacity-100 transition"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="p-2 flex flex-col gap-1.5 bg-slate-900/60">
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="text-[11px] text-slate-300 truncate flex-1" title={bg.note || ''}>
                            {bg.note || <span className="text-slate-600 italic">无备注</span>}
                          </span>
                          <button
                            onClick={() => handleEditNote(bg)}
                            title="编辑备注"
                            className="text-[10px] text-slate-500 hover:text-cyan-300 flex-shrink-0"
                          >
                            ✏️
                          </button>
                        </div>
                        <button
                          onClick={() => handleApply(bg)}
                          disabled={active || applyingId === bg.id}
                          className={`w-full py-1 rounded-lg text-[11px] font-bold transition ${
                            active
                              ? 'bg-cyan-950 text-cyan-500/70 cursor-default'
                              : 'bg-cyan-700/80 hover:bg-cyan-600 text-white disabled:opacity-40'
                          }`}
                        >
                          {active ? '当前背景' : applyingId === bg.id ? '切换中…' : '设为背景'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {list.length === 0 && (
                <p className="text-center text-slate-600 text-xs py-8 italic">
                  还没有自定义背景图，选择图片后点击“裁剪并导入”
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* 裁剪弹层：按中央背景区比例裁剪后再上传 */}
      {cropSrc && (
        <BackgroundCropper
          src={cropSrc}
          aspect={aspect}
          onConfirm={handleCropped}
          onCancel={closeCropper}
        />
      )}
    </div>
  );
}
