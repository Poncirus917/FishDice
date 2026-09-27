"use client";

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useRoom } from './RoomContext';
import {
  CARD_SECTION_OPTIONS, DEFAULT_CARD_SECTIONS, DEFAULT_RULES,
  CRIT_MIN, CRIT_MAX, FUMBLE_MIN, FUMBLE_MAX,
} from './roomRules';
import type { CardSection, CardSectionsState, RoomRules } from './roomRules';

interface CreateRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRoomCreated?: (roomId: string) => void;
}

// 阈值步进器：只允许 +/- 上下调整，不允许手动输入
function ThresholdStepper({
  label, value, min, max, onChange, accent,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  accent: string;
}) {
  const btn = 'w-8 h-8 flex items-center justify-center rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold text-base transition disabled:opacity-30 disabled:cursor-not-allowed';
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-slate-300">{label}</span>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
        <span className={`w-12 text-center text-lg font-bold ${accent}`}>{value}</span>
        <button type="button" className={btn} disabled={value >= max} onClick={() => onChange(value + 1)}>＋</button>
      </div>
    </div>
  );
}

export function CreateRoomModal({ isOpen, onClose, onRoomCreated }: CreateRoomModalProps) {
  const { createRoom, loadRoom } = useRoom();
  const [roomName, setRoomName] = useState('');
  const [sections, setSections] = useState<CardSectionsState>({ ...DEFAULT_CARD_SECTIONS });
  const [enablePush, setEnablePush] = useState(true);
  const [enableBurnLuck, setEnableBurnLuck] = useState(true);
  const [crit, setCrit] = useState(DEFAULT_RULES.crit_threshold);
  const [fumble, setFumble] = useState(DEFAULT_RULES.fumble_threshold);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const toggleSection = (key: CardSection) =>
    setSections(prev => ({ ...prev, [key]: !prev[key] }));

  const resetForm = () => {
    setRoomName('');
    setSections({ ...DEFAULT_CARD_SECTIONS });
    setEnablePush(true);
    setEnableBurnLuck(true);
    setCrit(DEFAULT_RULES.crit_threshold);
    setFumble(DEFAULT_RULES.fumble_threshold);
  };

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

    const rules: RoomRules = {
      card_sections: sections,
      enable_push: enablePush,
      enable_burn_luck: enableBurnLuck,
      crit_threshold: crit,
      fumble_threshold: fumble,
    };

    setSubmitting(true);
    try {
      const room = await createRoom({ name: trimmedName, rules });
      await loadRoom(room.id);
      toast.success(`房间创建成功！房间号：${room.room_code}`);
      resetForm();
      onClose();
      onRoomCreated?.(room.id);
    } catch (err: any) {
      toast.error(err.message || '创建失败');
    }
    setSubmitting(false);
  };

  const handleClose = () => {
    if (submitting) return;
    resetForm();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-lg bg-slate-800 rounded-2xl shadow-2xl border border-slate-700 flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-center text-cyan-400 px-6 pt-6 pb-4">创建房间</h2>

        {/* 表单区：内容较多，内部滚动 */}
        <div className="flex-1 overflow-y-auto px-6 pb-2 space-y-6">
          {/* 房间名称 */}
          <div>
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
            <p className="text-xs text-slate-500 mt-1 text-right">{roomName.length}/30</p>
          </div>

          {/* PC 角色卡对其他 PL 的可见性 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-bold text-slate-200">PC 角色卡可见性</label>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              勾选的分区对其他 PL 可见；头像和姓名始终可见。房规创建后不可更改，游戏内可由你逐个揭示。
            </p>
            <div className="space-y-2 bg-slate-900/50 border border-slate-700 rounded-xl p-3">
              {/* 头像与姓名：禁用勾选，必须可见 */}
              <label className="flex items-center gap-2.5 text-sm text-slate-300 cursor-not-allowed">
                <input type="checkbox" checked disabled className="accent-cyan-600 cursor-not-allowed" />
                <span className="font-medium">头像与姓名</span>
                <span className="text-[10px] text-slate-600">（必须可见）</span>
              </label>
              {CARD_SECTION_OPTIONS.map(({ key, label, hint }) => (
                <label key={key} className="flex items-center gap-2.5 text-sm text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sections[key]}
                    onChange={() => toggleSection(key)}
                    className="accent-cyan-600 cursor-pointer"
                  />
                  <span className="font-medium">{label}</span>
                  {hint && <span className="text-[10px] text-slate-600">{hint}</span>}
                </label>
              ))}
            </div>
          </div>

          {/* 可选规则开关 */}
          <div>
            <label className="text-sm font-bold text-slate-200 block mb-3">可选规则</label>
            <div className="space-y-2 bg-slate-900/50 border border-slate-700 rounded-xl p-3">
              <label className="flex items-center justify-between text-sm text-slate-300 cursor-pointer">
                <span>
                  <span className="font-medium">孤注一掷</span>
                  <span className="text-[10px] text-slate-600 ml-2">失败后可再尝试，失败承受更严重后果</span>
                </span>
                <input
                  type="checkbox"
                  checked={enablePush}
                  onChange={e => setEnablePush(e.target.checked)}
                  className="accent-cyan-600 cursor-pointer w-4 h-4"
                />
              </label>
              <label className="flex items-center justify-between text-sm text-slate-300 cursor-pointer">
                <span>
                  <span className="font-medium">燃烧幸运</span>
                  <span className="text-[10px] text-slate-600 ml-2">可消耗幸运值改变检定结果</span>
                </span>
                <input
                  type="checkbox"
                  checked={enableBurnLuck}
                  onChange={e => setEnableBurnLuck(e.target.checked)}
                  className="accent-cyan-600 cursor-pointer w-4 h-4"
                />
              </label>
            </div>
            <p className="text-[10px] text-slate-600 mt-1.5">开关在创建后不可更改。</p>
          </div>

          {/* 大成功 / 大失败阈值 */}
          <div>
            <label className="text-sm font-bold text-slate-200 block mb-3">检定阈值</label>
            <div className="space-y-3 bg-slate-900/50 border border-slate-700 rounded-xl p-3">
              <ThresholdStepper
                label="大成功（出目 ≤）"
                value={crit}
                min={CRIT_MIN}
                max={CRIT_MAX}
                onChange={setCrit}
                accent="text-emerald-400"
              />
              <ThresholdStepper
                label="大失败（出目 ≥）"
                value={fumble}
                min={FUMBLE_MIN}
                max={FUMBLE_MAX}
                onChange={setFumble}
                accent="text-red-400"
              />
            </div>
          </div>
        </div>

        {/* 底部按钮（固定不滚动） */}
        <div className="px-6 py-4 border-t border-slate-700 space-y-2">
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
