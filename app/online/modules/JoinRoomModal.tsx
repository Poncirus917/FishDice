"use client";

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useRoom } from './RoomContext';
import { useConfirmDialog } from './ConfirmDialog';
import { supabase } from '../../lib/supabase';
import type { CharacterState } from '../../(single)/page';
import { rulesFromRoom, CARD_SECTION_OPTIONS } from './roomRules';
import type { RoomRules } from './roomRules';

interface JoinRoomModalProps {
  isOpen: boolean;
  roomCode: string;
  onClose: () => void;
  onRoomEnter?: (info?: { roomId?: string }) => void;
}

interface RoomInfo {
  id: string;
  name: string;
  room_code: string;
  creator_id: string;
  creator_name: string;
  creator_avatar: string | null;
}

// 房规可见性小标签：visible=青色可见 / 否则灰色不可见
function RulesChip({ label, visible }: { label: string; visible: boolean }) {
  return (
    <span
      className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${
        visible
          ? 'bg-cyan-900/40 border-cyan-700 text-cyan-300'
          : 'bg-slate-800/60 border-slate-700 text-slate-500'
      }`}
    >
      {visible ? '✓' : '✕'} {label}
    </span>
  );
}

export function JoinRoomModal({ isOpen, roomCode, onClose, onRoomEnter }: JoinRoomModalProps) {
  const { joinRoom } = useRoom();
  const { showConfirm, Dialog } = useConfirmDialog();
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [characters, setCharacters] = useState<CharacterState[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isCreator, setIsCreator] = useState(false);
  // 房规（创建时确定，加入前供玩家确认：角色卡可见性 / 孤注一掷 / 燃烧幸运 / 阈值）
  const [rules, setRules] = useState<RoomRules | null>(null);
  
  // 成员状态：null=新成员, 'detached'=暂离, 'left'=退出过
  const [memberStatus, setMemberStatus] = useState<'detached' | 'left' | null>(null);
  const [previousCharacterId, setPreviousCharacterId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !roomCode) return;

    const loadRoomInfo = async () => {
      setLoading(true);
      setError(null);
      setMemberStatus(null);
      setPreviousCharacterId(null);
      setSelectedCharacterId(null);
      setRules(null);

      try {
        const userId = (await supabase.auth.getSession()).data.session?.user.id;
        setCurrentUserId(userId || null);

        const { data: room, error: roomError } = await supabase
          .from('rooms')
          .select('id, name, room_code, creator_id, status, card_sections, enable_push, enable_burn_luck, crit_threshold, fumble_threshold')
          .eq('room_code', roomCode)
          .single();

        if (roomError || !room) {
          setError('房间不存在');
          setLoading(false);
          return;
        }

        setRules(rulesFromRoom(room));

        const isRoomCreator = userId === room.creator_id;
        setIsCreator(isRoomCreator);

        // 暂停中的房间：非 KP 成员禁止加入（只有 KP 进入才会解除暂停）
        if (room.status === 'paused' && !isRoomCreator) {
          setError('房间暂停中，请等待 KP 解除暂停状态后再进入');
          setLoading(false);
          return;
        }

        // 检查用户的成员状态
        if (userId && !isRoomCreator) {
          const { data: membership, error: membershipError } = await supabase
            .from('room_members')
            .select('character_id, status')
            .eq('room_id', room.id)
            .eq('user_id', userId)
            .maybeSingle();

          console.log('[JoinRoomModal] 成员检查:', { membership, membershipError });

          if (membership) {
            if (membership.status === 'detached') {
              // 暂离状态：自动使用原有角色卡
              setMemberStatus('detached');
              setPreviousCharacterId(membership.character_id);
              setSelectedCharacterId(membership.character_id);
              console.log('[JoinRoomModal] 暂离状态，使用原角色:', membership.character_id);
            } else if (membership.status === 'left' || membership.status === 'removed') {
              // 主动退出或被 KP 移除：都需要重新选择角色卡
              setMemberStatus('left');
              console.log('[JoinRoomModal] 退出/被移除状态，需重新选择角色');
            } else if (membership.status === 'active') {
              // 活跃状态（不应发生）：强制重新选择
              setMemberStatus('left');
              console.log('[JoinRoomModal] 意外的活跃状态，强制重新选择角色');
            }
          } else {
            // 无记录（新成员或被移除后记录不可见）：需选择角色
            console.log('[JoinRoomModal] 无现有记录，需选择角色');
          }
        }

        const { data: creatorProfile } = await supabase
          .from('profiles')
          .select('display_name, avatar_url')
          .eq('id', room.creator_id)
          .single();

        setRoomInfo({
          id: room.id,
          name: room.name,
          room_code: room.room_code,
          creator_id: room.creator_id,
          creator_name: creatorProfile?.display_name || '未知',
          creator_avatar: creatorProfile?.avatar_url || null,
        });

        // 加载用户的角色列表
        if (userId && !isRoomCreator) {
          const { data: chars } = await supabase
            .from('characters')
            .select('data')
            .eq('owner_id', userId)
            .eq('data->>type', 'pc');
          
          if (chars) {
            setCharacters(chars.map(row => row.data as CharacterState));
          }
        }

        setLoading(false);
      } catch (err: any) {
        setError(err.message || '加载房间信息失败');
        setLoading(false);
      }
    };

    loadRoomInfo();
  }, [isOpen, roomCode]);

  if (!isOpen) return null;

  const handleJoin = async () => {
    if (!isCreator && !selectedCharacterId) {
      toast.error('请选择一个角色卡');
      return;
    }

    // 获取角色名（用于 detached 状态显示原有角色）
    const characterName = selectedCharacterId 
      ? characters.find(c => c.id === selectedCharacterId)?.name 
      : null;

    showConfirm({
      title: '确认加入房间',
      message: isCreator
        ? `你即将以 KP 身份进入房间「${roomInfo?.name}」\n\n确定加入吗？`
        : memberStatus === 'detached'
          ? `你将使用原有角色「${characterName}」加入房间「${roomInfo?.name}」\n\n确定加入吗？`
          : `你即将以角色「${characterName}」加入房间「${roomInfo?.name}」\n\n角色选定后无法更改，确定加入吗？`,
      confirmText: '确认加入',
      confirmColor: '#0891b2',
      // 仅首次加入的新成员需要 5 秒冷静期；非首次加入（暂离返回/退出后重选角色）无需等待
      //countdownSeconds: memberStatus === null ? 5 : 0,
      onConfirm: async () => {
        setSubmitting(true);
        try {
          await joinRoom(roomCode, selectedCharacterId || '');

          // 重新加入即取消该房间的"不再显示"标记，之后退出时卡片会自动重新出现
          if (roomInfo?.id) {
            try {
              const hiddenRaw = localStorage.getItem('fish_hidden_rooms');
              if (hiddenRaw) {
                const hidden: string[] = JSON.parse(hiddenRaw);
                const updated = hidden.filter(id => id !== roomInfo.id);
                localStorage.setItem('fish_hidden_rooms', JSON.stringify(updated));
              }
            } catch {}
          }

          toast.success('加入房间成功');
          onClose();
          onRoomEnter?.({ roomId: roomInfo?.id });
        } catch (err: any) {
          toast.error(err.message || '加入失败');
        } finally {
          setSubmitting(false);
        }
      },
    });
  };

  // 是否显示角色选择区域（暂离状态不显示，直接使用原有角色；退出状态或新成员必须选择）
  const showCharacterSelection = !isCreator && memberStatus !== 'detached';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-slate-800 rounded-2xl shadow-2xl border border-slate-700 p-6 mx-4 max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-center text-cyan-400 mb-6">加入房间</h2>

        {loading && (
          <div className="text-center py-8">
            <div className="text-cyan-400 animate-pulse text-sm">加载房间信息...</div>
          </div>
        )}

        {error && (
          <div className="text-center py-8">
            <div className="text-red-400 mb-4">{error}</div>
            <button
              onClick={onClose}
              className="px-6 py-2 bg-slate-700 hover:bg-slate-600 rounded-xl text-slate-300"
            >
              关闭
            </button>
          </div>
        )}

        {roomInfo && !loading && !error && (
          <>
            {/* 房间信息 */}
            <div className="bg-slate-900/50 rounded-xl p-4 mb-6 border border-slate-700">
              <div className="flex items-center gap-4 mb-3">
                <div className="w-12 h-12 rounded-full bg-purple-600 flex items-center justify-center text-xl font-bold overflow-hidden">
                  {roomInfo.creator_avatar ? (
                    <img src={roomInfo.creator_avatar} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span>{roomInfo.creator_name[0]}</span>
                  )}
                </div>
                <div>
                  <div className="text-sm text-slate-500">房间创建者</div>
                  <div className="font-bold text-white flex items-center gap-2">
                    {isCreator && (
                      <span className="px-1.5 py-0.5 bg-purple-600 text-xs rounded text-white">KP</span>
                    )}
                    {roomInfo.creator_name}
                  </div>
                </div>
              </div>
              <div className="border-t border-slate-700 pt-3">
                <div className="text-sm text-slate-500">房间名称</div>
                <div className="font-bold text-lg text-white">{roomInfo.name}</div>
                <div className="text-xs text-slate-500 mt-1">房间号：{roomInfo.room_code}</div>
              </div>
              {isCreator && (
                <div className="mt-3 p-3 bg-purple-900/30 rounded-lg border border-purple-700">
                  <p className="text-purple-300 text-sm">
                    🎭 你是房间创建者（KP），无需选择角色卡
                  </p>
                </div>
              )}
            </div>

            {/* 房规一览：加入前确认角色卡可见性、可选规则与阈值 */}
            {rules && (
              <div className="bg-slate-900/50 rounded-xl p-4 mb-6 border border-slate-700">
                <h3 className="text-sm font-bold text-slate-200 mb-3 flex items-center gap-2">📜 房规一览</h3>

                {/* PC 角色卡初始可见性 */}
                <div className="text-xs text-slate-500 mb-1.5">PC 角色卡可见性（初始）</div>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  <RulesChip label="头像与姓名" visible />
                  {CARD_SECTION_OPTIONS.map(o => (
                    <RulesChip key={o.key} label={o.label} visible={rules.card_sections[o.key]} />
                  ))}
                </div>

                {/* 可选规则 */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="flex items-center justify-between bg-slate-900/60 border border-slate-700 rounded-lg px-2.5 py-1.5">
                    <span className="text-xs text-slate-400">孤注一掷</span>
                    <span className={`text-xs font-bold ${rules.enable_push ? 'text-emerald-400' : 'text-slate-600'}`}>
                      {rules.enable_push ? '启用' : '未启用'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between bg-slate-900/60 border border-slate-700 rounded-lg px-2.5 py-1.5">
                    <span className="text-xs text-slate-400">燃烧幸运</span>
                    <span className={`text-xs font-bold ${rules.enable_burn_luck ? 'text-emerald-400' : 'text-slate-600'}`}>
                      {rules.enable_burn_luck ? '启用' : '未启用'}
                    </span>
                  </div>
                </div>

                {/* 阈值 */}
                <div className="flex items-center justify-center gap-4 text-xs">
                  <span className="text-slate-400">
                    大成功 <b className="text-emerald-400 text-sm">≤ {rules.crit_threshold}</b>
                  </span>
                  <span className="text-slate-700">|</span>
                  <span className="text-slate-400">
                    大失败 <b className="text-red-400 text-sm">≥ {rules.fumble_threshold}</b>
                  </span>
                </div>
              </div>
            )}

            {/* 成员状态提示（主动退出不显示任何提示，按新加入流程走） */}
            {memberStatus === 'detached' && !isCreator && (
              <div className="mb-4 p-3 bg-amber-900/30 rounded-lg border border-amber-700">
                <p className="text-amber-300 text-sm">
                  ⏸️ 你之前暂离了此房间，将使用原有角色加入
                </p>
              </div>
            )}

            {/* 选择角色（PL 用户，暂离状态不显示） */}
            {showCharacterSelection && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-slate-300 mb-3">选择你的 PC 角色卡</h3>
                
                {characters.length > 0 ? (
                  <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto">
                    {characters.map(char => (
                      <button
                        key={char.id}
                        onClick={() => setSelectedCharacterId(char.id)}
                        className={`p-3 rounded-xl border text-left transition ${
                          selectedCharacterId === char.id
                            ? 'bg-cyan-600/20 border-cyan-500'
                            : 'bg-slate-900 border-slate-700 hover:border-slate-500'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-cyan-700 flex items-center justify-center text-base font-bold overflow-hidden">
                            {char.avatar ? (
                              <img src={char.avatar} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span>{char.name[0]}</span>
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="font-bold text-white text-sm">{char.name}</div>
                            <div className="text-xs text-slate-500">
                              HP: {char.hp.current}/{char.hp.max} · MP: {char.mp.current}/{char.mp.max}
                            </div>
                          </div>
                          {selectedCharacterId === char.id && (
                            <span className="text-cyan-400">✓</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 bg-slate-900/50 rounded-xl border border-slate-700">
                    <div className="text-4xl mb-2">📭</div>
                    <p className="text-slate-400 text-sm mb-2">你还没有创建 PC 角色卡</p>
                    <p className="text-slate-500 text-xs">请先前往角色管理创建角色</p>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={handleJoin}
                disabled={submitting || (!isCreator && !selectedCharacterId)}
                className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-bold transition shadow-lg shadow-cyan-900/30"
              >
                {submitting ? '加入中...' : isCreator ? '以 KP 身份加入' : memberStatus === 'detached' ? '使用原有角色加入' : '确认加入'}
              </button>
              <button
                onClick={onClose}
                disabled={submitting}
                className="w-full py-2 text-slate-400 hover:text-slate-200 text-sm transition"
              >
                取消
              </button>
            </div>
          </>
        )}

        {Dialog}
      </div>
    </div>
  );
}
