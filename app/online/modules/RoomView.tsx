"use client";

import { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { useRoom } from './RoomContext';
import { useConfirmDialog } from './ConfirmDialog';
import NpcImportModal from './NpcImportModal';
import CharacterCardModal from './CharacterCardModal';
import { supabase } from '../../lib/supabase';
import type { DiceGroup } from '../../utils/dice';
import type { CharacterState } from '../../(single)/page';
import type { RoomNpcEntry, DiceLog } from './roomTypes';
import { getRoomNpcEntries, setRoomNpcVisible, removeRoomNpcEntry, deleteDiceLog, insertDiceLog, revealCardSection } from './roomService';
import { rulesFromRoom, sectionsForViewer, revealedFromMember, CARD_SECTION_OPTIONS } from './roomRules';
import type { CardSection } from './roomRules';

interface RoomViewProps {
  userId: string;
  displayName: string;
  avatarUrl: string;
  onBackToLobby: () => void;
}

export default function RoomView({ userId, displayName, avatarUrl, onBackToLobby }: RoomViewProps) {
  const { currentRoom, loading, pauseRoom, deleteRoom, leaveRoom, detachFromRoom, loadRoom, renameRoom, broadcastMemberRemoved, diceLogs, performCheck, performCustomRoll, broadcastToRoom } = useRoom();
  const { showConfirm, Dialog } = useConfirmDialog();
  const [allCharacters, setAllCharacters] = useState<Record<string, CharacterState>>({});
  const [roomNpcEntries, setRoomNpcEntries] = useState<RoomNpcEntry[]>([]);
  // 侧栏虚线加号框打开的添加弹窗类型（null = 关闭）
  const [npcImportType, setNpcImportType] = useState<'npc' | 'mob' | null>(null);
  const [npcOpBusy, setNpcOpBusy] = useState(false);
  const [npcRefreshKey, setNpcRefreshKey] = useState(0);
  const [myCharacterId, setMyCharacterId] = useState<string | null>(null);
  const [manageMembersModal, setManageMembersModal] = useState(false);
  // KP “设置”弹窗（暂停 / 删除 / 成员管理）
  const [roomSettingsOpen, setRoomSettingsOpen] = useState(false);
  // 房间信息弹窗（点击头部房间号方框打开；KP/PL 均可查看房规）
  const [rulesInfoOpen, setRulesInfoOpen] = useState(false);
  // KP 揭示角色卡分区的请求锁
  const [revealBusy, setRevealBusy] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  // KP 修改房间名
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  // 角色卡查看浮窗（点击左侧角色栏的 PC/NPC/怪物打开；NPC/怪物仅 KP 可打开；null = 关闭）
  const [viewCard, setViewCard] = useState<CharacterState | null>(null);

  // 掷骰面板
  const [rollTab, setRollTab] = useState<'check' | 'custom'>('check');
  const [checkLabel, setCheckLabel] = useState('');
  const [checkTarget, setCheckTarget] = useState<number | ''>('');
  const [selectedEntryId, setSelectedEntryId] = useState<string>('');
  // 自由掷骰
  const [freeLabel, setFreeLabel] = useState('');
  const [freeDiceGroups, setFreeDiceGroups] = useState<DiceGroup[]>([{ count: 1, sides: 6 }]);
  const [freeBonus, setFreeBonus] = useState<number>(0);
  const logListRef = useRef<HTMLDivElement>(null);

  // 掷骰记录悬浮侧栏（常态隐藏，右缘 LOGS 按钮展开）
  const [logsOpen, setLogsOpen] = useState(false);
  // 面板默认半透明（可透视页面），点击面板内部后转为不透明
  const [logsTouched, setLogsTouched] = useState(false);
  // 私有笔记弹窗（笔记仅自己可见）
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);

  // 调试日志
  useEffect(() => {
    if (currentRoom) {
      console.log('RoomView - currentRoom:', {
        id: currentRoom.id,
        name: currentRoom.name,
        status: currentRoom.status,
        membersCount: currentRoom.members.length,
        members: currentRoom.members.map(m => ({
          id: m.id,
          user_id: m.user_id,
          status: m.status,
          role: m.role,
          character_id: m.character_id,
          profile: m.profile
        }))
      });
    }
  }, [currentRoom]);

  const isCreator = currentRoom?.creator_id === userId;
  const myMembership = currentRoom?.members.find(m => m.user_id === userId);
  const myRole = isCreator ? 'kp' : (myMembership?.role || 'pl');

  // 加载房间所有角色：成员（PL）角色 + KP 通过 room_npcs 导入的 NPC/怪物
  useEffect(() => {
    if (!currentRoom) return;

    // 先清空旧的角色数据，避免显示过时的信息
    setAllCharacters({});

    (async () => {
      const memberCharacterIds = currentRoom.members
        .filter(m => m.character_id && m.character_id !== '')
        .map(m => m.character_id as string);

      // 房间角色实例（KP 看到全部；PL 受 RLS 限制只返回 visible 实例）
      const entryList = await getRoomNpcEntries(currentRoom.id)
        .catch(err => { console.error('RoomView - room_npcs error:', err); return [] as RoomNpcEntry[]; });
      setRoomNpcEntries(entryList);

      const npcCharIds = [...new Set(entryList.map(e => e.character_id))];
      const allIds = [...new Set([...memberCharacterIds, ...npcCharIds])];
      console.log('RoomView - loading characters:', { memberCharacterIds, npcCharIds, entryCount: entryList.length });

      if (allIds.length === 0) {
        setAllCharacters({});
        return;
      }

      const { data, error } = await supabase
        .from('characters')
        .select('id, data')
        .in('data->>id', allIds);  // character_id 存的是 data.id 业务 ID

      console.log('RoomView - characters result:', { data, error, count: data?.length });
      if (error) {
        console.error('RoomView - characters error:', error);
        setAllCharacters({});
        return;
      }
      const charMap: Record<string, CharacterState> = {};
      (data || []).forEach(row => {
        if (!row.data) return;
        const charData = row.data as CharacterState;
        // 用 data.id（角色自定义 ID）作为 key，同时保留数据库 id key
        if (charData.id) charMap[charData.id] = charData;
        charMap[String(row.id)] = charData;
      });
      setAllCharacters(charMap);
    })();
  }, [currentRoom, npcRefreshKey]);

  // room_npcs 实时变更（KP 导入/移除）：递增 key 触发上面的 effect 重新加载
  useEffect(() => {
    const handler = () => setNpcRefreshKey(k => k + 1);
    window.addEventListener('room-npcs-changed', handler);
    return () => window.removeEventListener('room-npcs-changed', handler);
  }, []);

  useEffect(() => {
    if (myMembership?.character_id && myMembership.character_id !== '') {
      setMyCharacterId(myMembership.character_id);
    }
  }, [myMembership]);

  // 新日志到达时自动滚动到底部（像聊天软件一样跟随最新消息）；打开侧栏时也滚到底
  useEffect(() => {
    const el = logListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [diceLogs, logsOpen]);

  // KP：切换剧本角色在场/不在场（行离开 PL 的 RLS 可见集合时 postgres_changes 可能丢事件，用广播兜底）
  const handleToggleNpcVisible = async (entry: RoomNpcEntry) => {
    const next = !entry.visible;
    setNpcOpBusy(true);
    try {
      await setRoomNpcVisible(entry.id, next);
      setRoomNpcEntries(prev => prev.map(e => (e.id === entry.id ? { ...e, visible: next } : e)));
      await broadcastToRoom('room_npcs_changed').catch(err => {
        console.error('广播 room_npcs_changed 失败:', err);
        toast.error('同步通知发送失败，请让其他 PL 手动刷新');
      });
    } catch (err: any) {
      toast.error(err.message || '切换失败');
    } finally {
      setNpcOpBusy(false);
    }
  };

  // KP：从房间移除剧本角色（在场角色由 RLS 拦截，提示先设为不在场）
  const handleRemoveNpcEntry = async (entry: RoomNpcEntry) => {
    setNpcOpBusy(true);
    try {
      await removeRoomNpcEntry(entry.id);
      setRoomNpcEntries(prev => prev.filter(e => e.id !== entry.id));
      toast.success('已从房间移除');
    } catch (err: any) {
      toast.error(err.message || '移除失败');
    } finally {
      setNpcOpBusy(false);
    }
  };

  // KP：揭示某 PL 角色卡的一个分区（不可逆）；room_members UPDATE 自动刷新房间，
  // 再以 room_update 广播兜底。同时写入一条 status 日志：进入 LOGS 记录，
  // 并通过现有的掷骰结果悬浮通道在右侧对所有人弹出提示
  const handleRevealSection = (memberId: string, charName: string) => async (section: CardSection) => {
    if (revealBusy) return;
    setRevealBusy(true);
    try {
      await revealCardSection(memberId, section);
      await broadcastToRoom('room_update').catch(() => {});

      const sectionLabel = CARD_SECTION_OPTIONS.find(o => o.key === section)?.label || section;
      await insertDiceLog({
        room_id: currentRoom!.id,
        user_id: userId,
        msg_type: 'status',
        label: `🔓 揭示了「${charName}」的${sectionLabel}`,
      }).catch(err => {
        console.error('写入揭示日志失败:', err);
      });

      toast.success('已揭示给所有玩家');
    } catch (err: any) {
      toast.error(err.message || '揭示失败');
    } finally {
      setRevealBusy(false);
    }
  };

  // KP 可代掷的角色实例：每个 room_npcs 实例一项，同一怪物的多个实例分别列出并编号
  const npcOptions = roomNpcEntries
    .map(entry => {
      const character = allCharacters[entry.character_id];
      if (!character) return null;
      const sameCharEntries = roomNpcEntries.filter(e => e.character_id === entry.character_id);
      const no = sameCharEntries.indexOf(entry) + 1;
      const display = character.type === 'mob' && sameCharEntries.length > 1
        ? `${character.name} #${no}`
        : character.name;
      return { entryId: entry.id, character, display };
    })
    .filter((x): x is { entryId: string; character: CharacterState; display: string } => x !== null);
  const kpCanCheck = npcOptions.length > 0;

  // KP 没有可代掷角色时自动切到自由掷骰页签（检定行为必须绑定角色）
  useEffect(() => {
    if (isCreator && npcOptions.length === 0) setRollTab('custom');
  }, [isCreator, npcOptions.length]);

  // 检定：手动填写检定项目与目标值发起 1D100；KP 必须选定代掷的 NPC/怪物
  const handlePerformCheck = async () => {
    const label = checkLabel.trim();
    const target = checkTarget === '' ? NaN : Number(checkTarget);

    if (!label) {
      toast('请填写检定项目（如：侦查）');
      return;
    }
    if (!Number.isFinite(target) || target <= 0) {
      toast('请填写有效的目标值');
      return;
    }

    try {
      if (isCreator) {
        const opt = npcOptions.find(o => o.entryId === selectedEntryId) || npcOptions[0];
        if (!opt) {
          toast('没有可代掷的 NPC/怪物，请使用自由掷骰');
          return;
        }
        await performCheck({
          label,
          target,
          characterId: opt.character.id,
          charName: opt.display,
        });
      } else {
        const myChar = myCharacterId ? allCharacters[myCharacterId] : null;
        await performCheck({
          label,
          target,
          characterId: myCharacterId,
          charName: myChar?.name || displayName,
        });
      }
      setCheckLabel('');
      setCheckTarget('');
    } catch (err: any) {
      toast.error(err.message || '掷骰失败');
    }
  };

  // 自由掷骰：NdM 多组骰子 + 加值（KP 无角色时的唯一掷骰方式）
  const handleFreeRoll = async () => {
    const validGroups = freeDiceGroups.filter(g => g.count >= 1 && g.sides >= 1);
    if (validGroups.length === 0) {
      toast('请配置至少一组有效骰子');
      return;
    }

    try {
      if (isCreator) {
        await performCustomRoll({ label: freeLabel, groups: validGroups, bonus: freeBonus, charName: '守秘人' });
      } else {
        const myChar = myCharacterId ? allCharacters[myCharacterId] : null;
        await performCustomRoll({
          label: freeLabel,
          groups: validGroups,
          bonus: freeBonus,
          characterId: myCharacterId,
          charName: myChar?.name || displayName,
        });
      }
      setFreeLabel('');
      setFreeBonus(0);
      setFreeDiceGroups([{ count: 1, sides: 6 }]);
    } catch (err: any) {
      toast.error(err.message || '掷骰失败');
    }
  };

  // 更新自由掷骰的骰子组
  const updateFreeGroup = (index: number, field: keyof DiceGroup, value: number) => {
    setFreeDiceGroups(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: Math.max(1, value) };
      return next;
    });
  };
  const addFreeGroup = () => {
    setFreeDiceGroups(prev => (prev.length < 3 ? [...prev, { count: 1, sides: 6 }] : prev));
  };
  const removeFreeGroup = (index: number) => {
    setFreeDiceGroups(prev => prev.filter((_, i) => i !== index));
  };

  // 检定等级 → 颜色
  const getLevelClass = (level: string | null) => {
    if (!level) return 'text-slate-300';
    if (level === '大成功') return 'text-emerald-300';
    if (level.includes('成功')) return 'text-green-400';
    if (level === '大失败') return 'text-red-300';
    return 'text-red-400';
  };

  // 格式化日志时间
  const formatLogTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // 掷骰结果悬浮提示队列：新骰子从底部入队、先出现的被顶上去，6 秒后自动消失
  const [rollToasts, setRollToasts] = useState<DiceLog[]>([]);
  // 已弹过提示的日志 id（防止重复弹出）
  const seenToastIdsRef = useRef<Set<string>>(new Set());

  // diceLogs 新增且为近期掷出（30 秒时间窗口，避免重进房间时历史日志误弹）→ 入队弹出；
  // 笔记（note）为私有内容不弹提示
  useEffect(() => {
    const now = Date.now();
    const fresh = diceLogs.filter(l =>
      l.msg_type !== 'note' &&
      !seenToastIdsRef.current.has(l.id) &&
      now - new Date(l.created_at).getTime() < 30000
    );
    if (fresh.length === 0) return;
    fresh.forEach(l => seenToastIdsRef.current.add(l.id));
    setRollToasts(prev => {
      const merged = [...prev, ...fresh];
      return merged.length > 5 ? merged.slice(merged.length - 5) : merged;
    });
    fresh.forEach(l => {
      setTimeout(() => {
        setRollToasts(prev => prev.filter(t => t.id !== l.id));
      }, 6000);
    });
  }, [diceLogs]);

  // 删除单条记录：KP 可删任何掷骰记录，PL 只能删自己的笔记（RLS：作者或 KP 可删）。
  // 删除后通过 postgres_changes DELETE 事件 + dice_log_deleted 广播双通道同步到所有客户端
  const handleDeleteLog = (log: DiceLog) => {
    const isMyNote = log.msg_type === 'note' && log.user_id === userId;
    showConfirm({
      title: isMyNote ? '删除笔记' : '删除掷骰记录',
      message: isMyNote
        ? '确定要删除这条笔记吗？笔记仅自己可见，删除后只影响你自己。'
        : '确定要删除这条记录吗？删除后所有成员均不再可见。',
      confirmText: '删除',
      confirmColor: '#dc2626',
      onConfirm: async () => {
        try {
          await deleteDiceLog(log.id);
          // postgres_changes DELETE 之外再加广播兜底，确保其它端实时移除
          await broadcastToRoom('dice_log_deleted', { id: log.id }).catch(() => {});
          toast.success('已删除');
        } catch (err: any) {
          toast.error(err.message || '删除失败');
        }
      },
    });
  };

  // 保存私有笔记（msg_type='note'，RLS 保证仅作者本人可读，其他人不可见）
  const handleSaveNote = async () => {
    if (!currentRoom) return;
    const text = noteText.trim();
    if (!text) {
      toast('请输入笔记内容');
      return;
    }
    setNoteBusy(true);
    try {
      const myChar = myCharacterId ? allCharacters[myCharacterId] : null;
      await insertDiceLog({
        room_id: currentRoom.id,
        user_id: userId,
        character_id: myCharacterId ?? null,
        char_name: isCreator ? '守秘人' : (myChar?.name || displayName),
        msg_type: 'note',
        label: '记录',
        level: text,
      });
      toast.success('笔记已保存（仅自己可见）');
      setNoteModalOpen(false);
      setNoteText('');
    } catch (err: any) {
      toast.error(err.message || '保存失败');
    } finally {
      setNoteBusy(false);
    }
  };

  // 导出掷骰记录为 TXT（含自己的私有笔记；格式参考单机版）
  const exportLogs = () => {
    if (!currentRoom || diceLogs.length === 0) return;

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const fileName = `log_${dateStr}_${now.getHours()}${now.getMinutes()}.txt`;
    const header = `--- COC Dice Log Export (${now.toLocaleString()}) ---\n\n`;

    const content = diceLogs.map(log => {
      const sender = currentRoom.members.find(m => m.user_id === log.user_id);
      const name = (isCreator && log.user_id === currentRoom.creator_id)
        ? '守秘人'
        : (log.char_name || sender?.profile?.display_name || '未知');
      const time = formatLogTime(log.created_at);

      if (log.msg_type === 'note') {
        return `[${time}] ${name} - 记录: ${log.level || ''}`;
      }
      if (log.msg_type === 'check' || log.msg_type === 'hidden') {
        return `[${time}] ${name} - ${log.label}: ${log.level || ''} (Roll:${log.roll ?? '-'}/${log.target ?? '-'})`;
      }
      if (log.msg_type === 'custom') {
        return `[${time}] ${name} - ${log.label}: ${log.level || ''} (总计:${log.roll ?? '-'})`;
      }
      // damage / status / request 等文字类日志
      return `[${time}] ${name} - ${log.label || log.level || ''}`;
    }).join('\n');

    const blob = new Blob([header + content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 单条日志卡片渲染（LOGS 面板与掷骰结果悬浮提示共用）
  // showDelete：是否显示悬停删除按钮（KP 对所有记录显示；PL 仅对自己的笔记显示）
  const renderLogCard = (log: DiceLog, showDelete: boolean) => {
    if (!currentRoom) return null;
    const sender = currentRoom.members.find(m => m.user_id === log.user_id);
    const senderName = isCreator && log.user_id === currentRoom.creator_id
      ? '守秘人'
      : (log.char_name || sender?.profile?.display_name || '未知');
    const isCheckType = log.msg_type === 'check' || log.msg_type === 'hidden';
    const isNote = log.msg_type === 'note';

    return (
      <div
        key={log.id}
        className={`group relative p-2.5 rounded-lg border transition-all ${
          isNote
            ? 'bg-cyan-950/30 border-cyan-900/50'
            : 'bg-slate-800/70 border-slate-700/60'
        }`}
      >
        {showDelete && (
          <button
            onClick={() => handleDeleteLog(log)}
            title="删除这条记录"
            className="absolute -top-2 -right-2 w-4 h-5 bg-slate-900 border border-slate-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:text-red-500"
          >
            <span className="text-[10px] font-bold">✕</span>
          </button>
        )}

        <div className="flex justify-between items-start mb-1 gap-2">
          <div className="text-slate-500 text-[9px] font-mono flex items-center gap-1.5 pt-0.5">
            {formatLogTime(log.created_at)}
            {isNote && <span className="text-cyan-600">📝 仅自己可见</span>}
          </div>
          <div className="text-[11px] font-black px-1.5 py-0.5 bg-slate-700/80 text-slate-300 rounded tracking-tight flex-shrink-0">
            {senderName}
          </div>
        </div>

        {log.msg_type === 'hidden' ? (
          /* KP 视角的暗骰行（PL 端 RLS 收不到 hidden 行） */
          <>
            <div className="font-bold text-[14px] mb-1 text-purple-300">{log.label}</div>
            <div className="flex items-baseline justify-between">
              <div className="font-mono text-[11px] text-slate-500">
                Roll: <b className="text-white">{log.roll}</b>/{log.target}
              </div>
              <div className={`font-black text-[14px] italic ${getLevelClass(log.level)}`}>
                {log.level}
              </div>
            </div>
          </>
        ) : isCheckType && log.roll !== null ? (
          <>
            <div className="font-bold text-[15px] mb-1 text-slate-200">{log.label}</div>
            <div className="flex items-baseline justify-between">
              <div className="font-mono text-[11px] text-slate-500">
                Roll: <b className="text-white">{log.roll}</b>/{log.target}
              </div>
              <div className={`font-black text-[15px] italic ${getLevelClass(log.level)}`}>
                {log.level}
              </div>
            </div>
          </>
        ) : log.msg_type === 'custom' ? (
          <>
            <div className="font-bold text-[15px] mb-1 text-slate-200">{log.label}</div>
            <div className="flex items-baseline justify-between gap-2">
              <div className="font-mono text-[11px] text-slate-500 break-all min-w-0">{log.level}</div>
              <div className="font-black text-[15px] text-cyan-300 flex-shrink-0">{log.roll}</div>
            </div>
          </>
        ) : isNote ? (
          <div className="text-[13px] text-cyan-100/90 whitespace-pre-wrap break-words leading-relaxed">
            {log.level}
          </div>
        ) : (
          <div className="text-sm text-slate-300">{log.label || log.level}</div>
        )}
      </div>
    );
  };

  // 监听被踢出房间的事件
  useEffect(() => {
    const handleMemberRemoved = (event: Event) => {
      if (isCreator) {
        return;
      }
      const detail = (event as CustomEvent).detail as { removedUserIds?: string[] } | undefined;
      const removedUserIds = detail?.removedUserIds || [];
      
      // 如果是 'all' 或者当前用户在被移除列表中，则显示弹窗
      const isRemoved = removedUserIds.includes('all') || removedUserIds.includes(userId);
      if (!isRemoved) {
        return;
      }
      
      showConfirm({
        title: '你已被移除',
        message: '你已被 KP 移出房间，无法再参与此跑团。\n\n是否返回首页？',
        confirmText: '返回主页',
        cancelText: '',
        onConfirm: () => {
          onBackToLobby();
        },
        onCancel: () => {
          onBackToLobby();
        },
      });
    };
    window.addEventListener('member-removed', handleMemberRemoved);
    return () => {
      window.removeEventListener('member-removed', handleMemberRemoved);
    };
  }, [showConfirm, onBackToLobby, isCreator, userId]);

  // 监听房间暂停事件（KP 暂停房间，PL 弹窗并可暂离）
  useEffect(() => {
    const handleRoomPaused = () => {
      if (isCreator) {
        return;
      }

      const doDetach = async () => {
        try {
          // 数据库此时已将 PL 标记为 detached，此处确保本地状态同步并返回主页
          await detachFromRoom();
        } catch (err) {
          console.error('[RoomView] 暂离失败:', err);
        } finally {
          onBackToLobby();
        }
      };

      showConfirm({
        title: '房间已暂停',
        message: 'KP 已暂停本次跑团。\n\n点击「暂离」返回主页，房间恢复后可使用原角色重新加入。',
        confirmText: '暂离',
        cancelText: '',
        confirmColor: '#f59e0b',
        onConfirm: doDetach,
        onCancel: doDetach,
      });
    };
    window.addEventListener('room-paused', handleRoomPaused);
    return () => {
      window.removeEventListener('room-paused', handleRoomPaused);
    };
  }, [showConfirm, onBackToLobby, isCreator, detachFromRoom]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-cyan-400 animate-pulse text-sm tracking-widest">加载房间中...</div>
      </div>
    );
  }

  if (!currentRoom) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="text-6xl mb-4">📭</div>
        <h2 className="text-xl font-bold text-slate-400 mb-2">房间不存在</h2>
        <button
          onClick={onBackToLobby}
          className="mt-4 px-6 py-2 bg-slate-700 hover:bg-slate-600 rounded-xl text-slate-300"
        >
          返回大厅
        </button>
      </div>
    );
  }

  const handlePauseRoom = () => {
    showConfirm({
      title: '暂停房间',
      message: '暂停后所有成员将暂离房间，跑团暂时中止。\n\n当你重新进入房间时暂停将自动解除，成员可使用原角色重新加入。',
      confirmText: '暂停房间',
      confirmColor: '#f59e0b',
      onConfirm: async () => {
        try {
          await pauseRoom();
          toast.success('房间已暂停');
          onBackToLobby();
        } catch (err: any) {
          toast.error(err.message || '操作失败');
        }
      },
    });
  };

  // 打开改名弹窗：用当前房间名预填
  const handleOpenRename = () => {
    setRenameValue(currentRoom.name);
    setRenameModalOpen(true);
  };

  const handleCloseRename = () => {
    if (renameSubmitting) return;
    setRenameModalOpen(false);
    setRenameValue('');
  };

  const handleRenameSubmit = async () => {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      toast('请输入房间名称');
      return;
    }
    if (trimmed.length > 30) {
      toast.error('房间名称不能超过30个字');
      return;
    }
    if (trimmed === currentRoom.name) {
      handleCloseRename();
      return;
    }

    setRenameSubmitting(true);
    try {
      await renameRoom(trimmed);
      toast.success('房间名已修改');
      setRenameModalOpen(false);
      setRenameValue('');
    } catch (err: any) {
      toast.error(err.message || '修改失败');
    } finally {
      setRenameSubmitting(false);
    }
  };

  const handleDeleteRoom = () => {
    showConfirm({
      title: '删除房间',
      message: '⚠️ 警告：此操作不可恢复！\n\n删除后：\n• 所有成员将被移出\n• 房间内所有信息将被清空\n• 无法再次加入\n\n你确定要删除此房间吗？',
      confirmText: '永久删除',
      confirmColor: '#dc2626',
      onConfirm: async () => {
        try {
          await deleteRoom();
          toast.success('房间已删除');
          onBackToLobby();
        } catch (err: any) {
          toast.error(err.message || '操作失败');
        }
      },
    });
  };

  const handleLeaveRoom = () => {
    if (isCreator) {
      // KP 点击管理成员
      setManageMembersModal(true);
      return;
    }
    // PL 点击退出房间
    showConfirm({
      title: '退出房间',
      message: '退出后将不再参与此房间的跑团。\n\n你确定要退出吗？',
      confirmText: '退出房间',
      onConfirm: async () => {
        try {
          console.log('[RoomView] PL 主动退出房间');
          await leaveRoom(false);
          console.log('[RoomView] 退出完成，返回首页');
          toast.success('已退出房间');
          onBackToLobby();
        } catch (err: any) {
          console.error('[RoomView] 退出失败:', err);
          toast.error(err.message || '操作失败');
        }
      },
    });
  };

  const toggleMemberSelection = (userId: string) => {
    setSelectedMembers(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const handleRemoveSelectedMembers = async () => {
    if (selectedMembers.length === 0) {
      toast('请先选择要移除的成员');
      return;
    }
    showConfirm({
      title: '移除成员',
      message: `确定要移除选中的 ${selectedMembers.length} 名成员吗？`,
      confirmText: '移除',
      confirmColor: '#dc2626',
      onConfirm: async () => {
        try {
          console.log('[handleRemoveSelectedMembers] 开始移除:', { selectedMembers, roomId: currentRoom.id });

          // 1. 先更新数据库：设置 status 为 removed（历史记录不再显示），清空 character_id
          const { data, error } = await supabase
            .from('room_members')
            .update({ 
              status: 'removed', 
              character_id: null, 
              left_at: new Date().toISOString() 
            })
            .in('user_id', selectedMembers)
            .eq('room_id', currentRoom.id)
            .select();

          console.log('[handleRemoveSelectedMembers] 数据库更新结果:', { affected: data?.length, error });

          if (error) throw error;

          // 2. 广播通知被移除的 PL（在数据库更新之后，确保 PL 能收到并显示弹窗）
          await broadcastMemberRemoved(currentRoom.id, selectedMembers);
          console.log('[handleRemoveSelectedMembers] 广播已发送:', selectedMembers);

          toast.success(`已移除 ${selectedMembers.length} 名成员`);
          setSelectedMembers([]);
          
          // 3. 刷新 KP 端成员列表
          await loadRoom(currentRoom.id);
        } catch (err: any) {
          console.error('[handleRemoveSelectedMembers] 错误:', err);
          toast.error(err.message || '操作失败');
        }
      },
    });
  };

  const handleDetachRoom = () => {
    showConfirm({
      title: '暂离房间',
      message: '暂离后，你将暂时离开房间，但保留会话信息。\n\n下次进入同一房间时，无需重新选择角色卡。',
      confirmText: '暂离房间',
      confirmColor: '#6b7280',
      onConfirm: async () => {
        try {
          await detachFromRoom();
          toast.success('已暂离房间');
          onBackToLobby();
        } catch (err: any) {
          toast.error(err.message || '操作失败');
        }
      },
    });
  };

  const paused = currentRoom.status === 'paused';
  
  // 活跃成员（PL，排除 KP）
  const activeMembers = currentRoom.members.filter(m => m.status === 'active' && m.role !== 'kp');
  const detachedMembers = currentRoom.members.filter(m => m.status === 'detached');

  // 管理成员弹窗中可操作的成员：在房与暂离的 PL（排除 KP 自己）
  const manageableMembers = currentRoom.members.filter(
    m => (m.status === 'active' || m.status === 'detached')
      && m.user_id !== currentRoom.creator_id
      && m.role !== 'kp'
  );
  
  // 构造 KP 成员对象
  const kpMember = {
    id: `kp-${currentRoom.creator_id}`,
    user_id: currentRoom.creator_id,
    role: 'kp' as const,
    status: 'active' as const,
    character_id: null as string | null,
    profile: currentRoom.creator || undefined,
  };
  
  // 排序：KP 在前，其他活跃成员在后
  const sortedActiveMembers = [
    kpMember,
    ...activeMembers,
  ];

  return (
    <div className="min-h-screen bg-slate-900 text-white flex">
      {/* 左侧侧边栏 - 成员列表 */}
      <aside className="w-80 bg-slate-800 border-r border-slate-700 flex flex-col">
        <div className="p-4 border-b border-slate-700">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <span>👥</span> 房间成员
            <span className="text-sm font-normal text-slate-500">({sortedActiveMembers.length})</span>
          </h3>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {/* 活跃成员 */}
          {sortedActiveMembers.map(member => {
            if (!member) return null;
            const isKP = member.user_id === currentRoom.creator_id;
            const isMe = member.user_id === userId;
            
            // 尝试多种 key 查找角色
            let character: CharacterState | null = null;
            
            if (member.character_id) {
              // 1. 直接用 character_id 查找
              character = allCharacters[member.character_id] || null;
              console.log('RoomView - direct lookup:', {
                key: member.character_id,
                found: !!character,
                allKeys: Object.keys(allCharacters)
              });
              
              // 2. 如果没找到，遍历所有 available characters 查找匹配
              if (!character) {
                for (const key in allCharacters) {
                  if (allCharacters[key]) {
                    const char = allCharacters[key];
                    // 尝试用 data.id 匹配
                    if (char.id === member.character_id) {
                      character = char;
                      break;
                    }
                  }
                }
              }
            }
            
            console.log('RoomView - rendering member:', {
              user_id: member.user_id,
              isKP,
              character_id: member.character_id,
              character_found: !!character,
              character_name: character?.name
            });
            
            return (
              <div
                key={member.id}
                className={`rounded-xl ${
                  isKP 
                    ? 'bg-purple-900/30 border border-purple-800/50' 
                    : 'bg-slate-700/50'
                }`}
              >
                {/* 上方面板：头像和用户名 */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold overflow-hidden flex-shrink-0 ${
                    isKP ? 'bg-purple-600' : 'bg-cyan-700'
                  }`}>
                    {member.profile?.avatar_url ? (
                      <img src={member.profile.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span>{(member.profile?.display_name || '?')[0]}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white text-sm truncate">
                        {member.profile?.display_name || '未知'}
                      </span>
                      {isMe && <span className="text-xs text-cyan-400">(我)</span>}
                      {isKP ? (
                        <span className="px-1.5 py-0.5 bg-purple-600 rounded text-xs font-bold text-white">KP</span>
                      ) : (
                        <span className="px-1.5 py-0.5 bg-cyan-600 rounded text-xs font-bold text-white">PL</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 下方角色卡片（点击查看角色卡浮窗） */}
                {!isKP && character && (
                  <div className="px-4 pb-3 pl-16">
                    <div
                      className="flex items-center gap-2 mt-2 cursor-pointer hover:bg-slate-700/60 rounded-lg px-2 py-1.5 -mx-2 transition"
                      title="查看角色卡"
                      onClick={() => { if (character) setViewCard(character); }}
                    >
                      <div className="w-8 h-8 rounded-lg bg-cyan-600 flex items-center justify-center text-sm font-bold overflow-hidden">
                        {character.avatar ? (
                          <img src={character.avatar} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span>{character.name[0]}</span>
                        )}
                      </div>
                      <span className="text-xs font-medium text-cyan-300 truncate max-w-32">
                        {character.name}
                      </span>
                    </div>
                  </div>
                )}


              </div>
            );
          })}

          {/* 暂离成员 */}
          {detachedMembers.map(member => {
            const character = member.character_id ? allCharacters[member.character_id] : null;
            return (
              <div
                key={member.id}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/50 opacity-60"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-slate-600 flex items-center justify-center text-lg font-bold overflow-hidden">
                    {member.profile?.avatar_url ? (
                      <img src={member.profile.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span>{(member.profile?.display_name || '?')[0]}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="font-bold text-slate-400 text-sm truncate">
                        {member.profile?.display_name || '未知'}
                      </span>
                      <span className="px-1.5 py-0.5 bg-slate-600 rounded text-xs font-bold text-slate-300">暂离</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {character && (
                    <button
                      className="w-8 h-8 rounded-lg bg-slate-700 flex items-center justify-center text-sm overflow-hidden cursor-pointer hover:ring-1 hover:ring-cyan-500 transition"
                      title="查看角色卡"
                      onClick={() => { if (character) setViewCard(character); }}
                    >
                      {character.avatar ? (
                        <img src={character.avatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-slate-400">{character.name[0]}</span>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {activeMembers.length === 0 && detachedMembers.length === 0 && sortedActiveMembers.length <= 1 && (
            <p className="text-slate-500 text-sm text-center py-4">
              暂无成员加入
            </p>
          )}

          {/* 剧本角色：NPC 与怪物分别列出。
              PL：只看到在场（visible）实例，无任何操作；KP：看到全部实例，
              行内有在场/不在场切换，悬停出现 × 删除（仅不在场可删）；
              KP 每个分区底部有虚线加号框用于添加 */}
          {(() => {
            const sectionEntries = roomNpcEntries.filter(e => isCreator || e.visible);
            const npcList = sectionEntries.filter(e => allCharacters[e.character_id]?.type === 'npc');
            const mobList = sectionEntries.filter(e => allCharacters[e.character_id]?.type === 'mob');
            // PL 两个分区都为空时整块不显示；KP 始终显示（含添加入口）
            if (!isCreator && npcList.length === 0 && mobList.length === 0) return null;

            // 同一怪物多实例编号（按全部实例的加入顺序）
            const instanceLabel = (entry: RoomNpcEntry): string => {
              const c = allCharacters[entry.character_id];
              if (!c) return '';
              const sameList = roomNpcEntries.filter(e => e.character_id === entry.character_id);
              if (c.type === 'mob' && sameList.length > 1) {
                return `${c.name} #${sameList.indexOf(entry) + 1}`;
              }
              return c.name;
            };

            const renderSection = (title: string, icon: string, list: RoomNpcEntry[], isMobSection: boolean) => {
              if (!isCreator && list.length === 0) return null;
              const addType = isMobSection ? 'mob' as const : 'npc' as const;
              return (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">
                    {icon} {title}{list.length > 0 ? ` (${list.length})` : ''}
                  </p>
                  {list.map(entry => {
                    const c = allCharacters[entry.character_id];
                    if (!c) return null;
                    return (
                      <div
                        key={entry.id}
                        onClick={() => { if (isCreator && c) setViewCard(c); }}
                        title={isCreator ? '查看角色卡' : undefined}
                        className={`group flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-slate-800/60 transition ${
                          isCreator ? 'cursor-pointer' : ''
                        } ${isCreator && !entry.visible ? 'opacity-55' : ''}`}
                      >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold overflow-hidden flex-shrink-0 ${
                          isMobSection ? 'bg-red-700' : 'bg-emerald-700'
                        }`}>
                          {c.avatar ? (
                            <img src={c.avatar} alt="" className="w-full h-full object-cover" />
                          ) : (
                            c.name[0]
                          )}
                        </div>
                        <span className="text-xs font-medium text-slate-300 truncate flex-1">
                          {instanceLabel(entry)}
                        </span>
                        {isCreator ? (
                          <>
                            {/* 在场/不在场切换标识 */}
                            <button
                              onClick={e => { e.stopPropagation(); handleToggleNpcVisible(entry); }}
                              disabled={npcOpBusy}
                              title={entry.visible ? '点击设为不在场' : '点击设为在场'}
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold flex-shrink-0 transition disabled:opacity-50 ${
                                entry.visible
                                  ? 'bg-cyan-600/80 hover:bg-cyan-500 text-white'
                                  : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                              }`}
                            >
                              {entry.visible ? '在场' : '不在场'}
                            </button>
                            {/* 悬停显示的删除 ×：在场角色点删除会被拦截提示 */}
                            <button
                              onClick={e => { e.stopPropagation(); handleRemoveNpcEntry(entry); }}
                              disabled={npcOpBusy}
                              title={entry.visible ? '在场角色不可移除，请先设为不在场' : '从房间移除'}
                              className="w-4 h-4 flex items-center justify-center rounded-full text-[11px] leading-none text-slate-500 hover:text-red-400 hover:bg-slate-700 opacity-0 group-hover:opacity-100 transition flex-shrink-0 disabled:opacity-50"
                            >
                              ×
                            </button>
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                  {/* KP 添加入口：虚线加号框 */}
                  {isCreator && (
                    <button
                      onClick={() => setNpcImportType(addType)}
                      className="w-full border border-dashed border-slate-700 hover:border-cyan-500 text-slate-500 hover:text-cyan-400 rounded-lg py-2 text-[11px] flex items-center justify-center gap-1.5 transition"
                    >
                      <span className="text-sm leading-none font-bold">+</span> 添加{title}
                    </button>
                  )}
                </div>
              );
            };

            return (
              <div className="pt-3 mt-3 border-t border-slate-700/60 space-y-3">
                {renderSection('NPC', '👤', npcList, false)}
                {renderSection('怪物', '👹', mobList, true)}
              </div>
            );
          })()}
        </div>
      </aside>

      {/* 右侧主内容区域 */}
      <div className="flex-1 flex flex-col">
        {/* 顶部导航 */}
        <header className="flex justify-between items-center px-6 py-4 border-b border-slate-800 bg-slate-900">
          <div className="flex items-center gap-2">
            <span className="text-xl">🎭</span>
            {isCreator ? (
              <button
                onClick={handleOpenRename}
                title="点击修改房间名"
                className="font-bold text-lg hover:text-cyan-400 transition cursor-pointer underline-offset-4 hover:underline decoration-dotted decoration-slate-600"
              >
                {currentRoom.name}
              </button>
            ) : (
              <span className="font-bold text-lg">{currentRoom.name}</span>
            )}
            {paused && (
              <span className="px-2 py-0.5 bg-amber-600 text-xs rounded-full">已暂停</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* 点击房间号方框查看房间信息（房规），KP/PL 均可 */}
            <button
              onClick={() => setRulesInfoOpen(true)}
              title="查看房间信息"
              className="px-3 py-1 bg-slate-800 rounded-lg border border-slate-700 hover:border-cyan-600 hover:bg-slate-700/60 transition cursor-pointer"
            >
              <span className="text-xs text-slate-500 mr-2">房间号</span>
              <span className="text-sm font-bold text-cyan-400">{currentRoom.room_code}</span>
            </button>
            {/* KP：暂停/删除/成员管理合并为“设置”；PL：暂离 */}
            <div className="flex items-center gap-2">
              {myRole === 'pl' && (
                <button
                  onClick={handleDetachRoom}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition"
                >
                  暂离
                </button>
              )}
              {isCreator && (
                <button
                  onClick={() => setRoomSettingsOpen(true)}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-bold transition flex items-center gap-1.5"
                >
                  <span>⚙️</span> 设置
                </button>
              )}
              <button
                onClick={handleLeaveRoom}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold transition ${
                  isCreator
                    ? 'hidden'
                    : 'bg-red-600/50 hover:bg-red-600 text-red-300'
                }`}
              >
                退出房间
              </button>
            </div>
          </div>
        </header>

        {/* 主内容区：掷骰功能开发中提示（底部留白避开悬浮掷骰面板，使其在可见区居中） */}
        <div className="flex-1 min-h-0 flex items-center justify-center pb-[calc(33vh+1rem)]">
          <span className="text-slate-600 text-lg tracking-[0.3em] font-bold select-none">
            掷骰功能仍在开发中，下方简易掷骰仅作简单测试用，不代表最终效果
          </span>
        </div>

        {/* 底部掷骰面板（悬浮窗）：贴页面下方、避开左侧角色栏（w-80）、高约 1/3；内容单行排布，不做内部滚动 */}
        <div className="fixed left-[21rem] right-4 bottom-4 z-30 h-[33vh] min-h-[15rem] rounded-2xl border border-slate-700 bg-slate-900/85 backdrop-blur shadow-2xl p-4 flex flex-col gap-3 overflow-hidden">
          {/* 页签行 */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="flex gap-1 p-1 bg-slate-800/80 rounded-xl">
              <button
                onClick={() => setRollTab('check')}
                disabled={isCreator && !kpCanCheck}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition ${
                  rollTab === 'check'
                    ? 'bg-cyan-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                } ${isCreator && !kpCanCheck ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                🎯 技能检定
              </button>
              <button
                onClick={() => setRollTab('custom')}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition ${
                  rollTab === 'custom'
                    ? 'bg-cyan-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                🎲 自由掷骰
              </button>
            </div>
            {isCreator && !kpCanCheck && (
              <p className="text-[11px] text-amber-500/80 leading-tight">
                检定类掷骰必须绑定角色：请先在左侧导入 NPC / 怪物并加入房间
              </p>
            )}
          </div>

          {/* 技能检定：单行布局 */}
          {rollTab === 'check' && (
            <div className="flex-1 min-h-0 flex items-center justify-center gap-3">
              {isCreator ? (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">代掷角色</span>
                  <select
                    value={selectedEntryId || npcOptions[0]?.entryId || ''}
                    onChange={e => setSelectedEntryId(e.target.value)}
                    className="w-44 bg-slate-900/70 border border-slate-700 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-cyan-500"
                  >
                    {npcOptions.map(o => (
                      <option key={o.entryId} value={o.entryId}>
                        {o.character.type === 'mob' ? '怪物·' : 'NPC·'}{o.display}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className="text-xs text-slate-500 flex-shrink-0">
                  掷骰角色：
                  <span className="text-cyan-400 font-bold">
                    {(myCharacterId && allCharacters[myCharacterId]?.name) || '未选择角色'}
                  </span>
                </p>
              )}
              <input
                type="text"
                placeholder="检定项目，如：侦查"
                className="flex-1 bg-slate-900/70 border border-slate-700 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-cyan-500 transition"
                value={checkLabel}
                onChange={e => setCheckLabel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handlePerformCheck(); }}
              />
              <input
                type="number"
                min={1}
                max={100}
                placeholder="目标值，如：60"
                className="w-28 bg-slate-900/70 border border-slate-700 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-cyan-500 transition"
                value={checkTarget}
                onChange={e => setCheckTarget(e.target.value === '' ? '' : Number(e.target.value))}
                onKeyDown={e => { if (e.key === 'Enter') handlePerformCheck(); }}
              />
              <button
                onClick={handlePerformCheck}
                className="px-6 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 font-bold text-sm transition active:scale-[0.99] flex-shrink-0"
              >
                掷 1D100
              </button>
            </div>
          )}

          {/* 自由掷骰：两行布局（目的 + 加值 + 按钮 / 骰子组） */}
          {rollTab === 'custom' && (
            <div className="flex-1 min-h-0 flex flex-col justify-center gap-2.5">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="掷骰目的（可选），如：先攻 / 敌人数目"
                  className="flex-1 bg-slate-900/70 border border-slate-700 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-cyan-500 transition"
                  value={freeLabel}
                  onChange={e => setFreeLabel(e.target.value)}
                />
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex-shrink-0">加值</span>
                <input
                  type="number"
                  className="w-24 bg-slate-900/70 border border-slate-700 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-cyan-500"
                  value={freeBonus}
                  onChange={e => setFreeBonus(e.target.value === '' ? 0 : Number(e.target.value))}
                  onKeyDown={e => { if (e.key === 'Enter') handleFreeRoll(); }}
                />
                <button
                  onClick={handleFreeRoll}
                  className="px-6 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 font-bold text-sm transition active:scale-[0.99] flex-shrink-0"
                >
                  掷骰
                </button>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex-shrink-0">骰子组</span>
                {freeDiceGroups.map((group, index) => (
                  <div key={index} className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      className="w-16 h-10 text-center text-sm font-black bg-slate-900/70 border border-slate-700 rounded-xl outline-none focus:border-cyan-500"
                      value={group.count}
                      onChange={e => updateFreeGroup(index, 'count', Number(e.target.value))}
                    />
                    <span className="font-serif italic text-sm text-slate-500">D</span>
                    <input
                      type="number"
                      min={1}
                      className="w-16 h-10 text-center text-sm font-black bg-slate-900/70 border border-slate-700 rounded-xl outline-none focus:border-cyan-500"
                      value={group.sides}
                      onChange={e => updateFreeGroup(index, 'sides', Number(e.target.value))}
                      onKeyDown={e => { if (e.key === 'Enter') handleFreeRoll(); }}
                    />
                    {freeDiceGroups.length > 1 && (
                      <button
                        onClick={() => removeFreeGroup(index)}
                        className="text-slate-500 hover:text-red-400 px-0.5 text-sm"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                {freeDiceGroups.length < 3 && (
                  <button
                    onClick={addFreeGroup}
                    className="px-3 py-1.5 border border-dashed border-slate-700 rounded-xl text-slate-500 hover:text-cyan-400 text-[10px] font-bold"
                  >
                    + 添加骰子组
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* LOGS 悬浮按钮：页面最右缘垂直居中，点击展开掷骰记录侧栏 */}
      {!logsOpen && (
        <button
          onClick={() => { setLogsOpen(true); setLogsTouched(false); }}
          title="掷骰记录"
          className="fixed right-0 top-1/2 -translate-y-1/2 z-40 bg-slate-800/90 hover:bg-slate-700 border border-r-0 border-slate-600 rounded-l-lg px-1 py-5 shadow-lg transition"
        >
          <span
            className="text-[10px] font-black tracking-[0.35em] text-cyan-400"
            style={{ writingMode: 'vertical-rl' }}
          >
            LOGS
          </span>
        </button>
      )}

      {/* 掷骰记录悬浮侧栏：默认半透明覆盖在页面之上，点击面板内部转为不透明；
          不加全屏遮罩，面板之外的页面交互不受影响 */}
      {logsOpen && (
        <aside
          onClick={() => setLogsTouched(true)}
          className={`fixed right-0 top-1/2 -translate-y-1/2 z-50 w-[420px] max-w-[92vw] h-[82vh] rounded-l-2xl border border-r-0 border-slate-700 flex flex-col shadow-2xl transition-colors duration-200 ${
            logsTouched ? 'bg-slate-900' : 'bg-slate-900/70'
          }`}
        >
          {/* 头部：标题 + 笔记 / 导出 / 关闭 */}
          <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-2 flex-shrink-0">
            <span>📜</span>
            <span className="font-bold text-sm">掷骰记录</span>
            <span className="text-[10px] text-slate-500">{diceLogs.length}</span>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={() => setNoteModalOpen(true)}
                title="添加私有笔记（仅自己可见）"
                className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-bold text-cyan-300 transition"
              >
                ✏️ 笔记
              </button>
              <button
                onClick={exportLogs}
                title="导出为 TXT（含自己的笔记）"
                className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-bold text-cyan-300 transition"
              >
                ⬇ EXPORT TXT
              </button>
              <button
                onClick={() => setLogsOpen(false)}
                title="收起"
                className="w-6 h-6 rounded-md text-slate-400 hover:text-white hover:bg-slate-700 transition text-sm leading-none"
              >
                ✕
              </button>
            </div>
          </div>

          {/* 日志列表（单机版卡片式渲染） */}
          <div ref={logListRef} className="flex-1 overflow-y-auto p-3 space-y-2">
            {diceLogs.length === 0 && (
              <p className="text-center text-slate-600 text-xs py-10 italic">
                暂无掷骰记录，等待第一掷…
              </p>
            )}

            {diceLogs.map(log =>
              renderLogCard(log, isCreator || (log.msg_type === 'note' && log.user_id === userId))
            )}
          </div>
        </aside>
      )}

      {/* 掷骰结果悬浮提示：底部掷骰面板之上锚定堆叠——新骰子入队把先出现的顶上去；
          左上角圆环为 6 秒剩余时间，点击提示可展开完整记录侧栏 */}
      <div className="fixed right-6 bottom-[calc(33vh+1.25rem)] z-[45] w-[420px] max-w-[80vw] flex flex-col gap-2 pointer-events-none">
        {rollToasts.map(log => (
          <div
            key={log.id}
            className="dice-toast-in pointer-events-auto relative shadow-xl rounded-lg cursor-pointer"
            onClick={() => { setLogsOpen(true); setLogsTouched(false); }}
          >
            {renderLogCard(log, false)}
            <div className="absolute -top-1.5 -left-1.5 w-5 h-5 text-cyan-400 drop-shadow">
              <svg viewBox="0 0 16 16" className="w-full h-full -rotate-90">
                <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
                <circle
                  cx="8"
                  cy="8"
                  r="6.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray="40.84"
                  className="dice-toast-ring"
                />
              </svg>
            </div>
          </div>
        ))}
      </div>

      {Dialog}

      {/* 添加私有笔记弹窗（仅自己可见，可随记录导出 TXT） */}
      {noteModalOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
          onClick={() => { if (!noteBusy) setNoteModalOpen(false); }}
        >
          <div
            className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-700 flex justify-between items-center">
              <h3 className="font-bold text-white">📝 添加剧情笔记</h3>
              <button
                onClick={() => setNoteModalOpen(false)}
                disabled={noteBusy}
                className="text-slate-400 hover:text-white disabled:opacity-50"
              >
                ✕
              </button>
            </div>

            <div className="p-4">
              <p className="text-[11px] text-slate-500 mb-2">
                笔记仅自己可见，其他成员无法查看；会出现在你的记录列表中，并可随记录一并导出 TXT。
              </p>
              <textarea
                autoFocus
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="在此输入剧情描述、个人备忘或关键线索..."
                className="w-full h-36 p-3 bg-slate-900/70 border border-slate-700 rounded-xl text-sm text-white outline-none focus:border-cyan-500 resize-none transition"
              />

              <div className="mt-4 flex gap-3">
                <button
                  onClick={() => setNoteModalOpen(false)}
                  disabled={noteBusy}
                  className="flex-1 py-2.5 rounded-xl font-bold text-slate-400 hover:bg-slate-700 transition disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveNote}
                  disabled={noteBusy}
                  className="flex-[2] py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold transition disabled:opacity-50"
                >
                  {noteBusy ? '保存中...' : '保存并记录'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KP 添加 NPC / 怪物弹窗（由侧栏虚线加号框打开，类型由所在分区决定） */}
      {npcImportType && (
        <NpcImportModal
          userId={userId}
          roomId={currentRoom.id}
          addType={npcImportType}
          onClose={() => setNpcImportType(null)}
        />
      )}

      {/* 角色卡查看浮窗：点击左侧角色栏的 PC/NPC/怪物打开（NPC/怪物仅 KP 可打开）。
          PC 卡：KP 端带揭示控件；其他 PL 端按房规 + 已揭示分区过滤；自己的卡完整可见 */}
      {viewCard && (() => {
        const ownerMember = currentRoom.members.find(
          m => m.role === 'pl' && m.character_id === viewCard.id
        );
        const rules = rulesFromRoom(currentRoom);
        const revealed = ownerMember ? revealedFromMember(ownerMember.revealed_sections) : [];

        // KP 打开 PC 卡：当前对玩家隐藏的分区显示“揭示给玩家”
        const kpReveal = isCreator && ownerMember
          ? {
              hiddenFromPlayers: (Object.keys(rules.card_sections) as CardSection[])
                .filter(k => !rules.card_sections[k] && !revealed.includes(k)),
              onReveal: handleRevealSection(ownerMember.id, viewCard.name),
            }
          : undefined;

        // PL 打开他人 PC 卡：按有效可见性过滤；自己的卡 / NPC / 怪物无限制
        const visibleSections = !isCreator && ownerMember && ownerMember.user_id !== userId
          ? sectionsForViewer(rules, revealed)
          : undefined;

        // PL 查看自己的卡：内容完整显示，但当前对其他 PL 隐藏的分区用橙色小字标注
        // （KP 已揭示的分区对其他人已可见，不再标注）
        const hiddenForOthers = !isCreator && ownerMember && ownerMember.user_id === userId
          ? (Object.keys(rules.card_sections) as CardSection[])
              .filter(k => !rules.card_sections[k] && !revealed.includes(k))
          : undefined;

        return (
          <CharacterCardModal
            character={viewCard}
            onClose={() => setViewCard(null)}
            visibleSections={visibleSections}
            kpReveal={kpReveal}
            hiddenForOthers={hiddenForOthers}
          />
        );
      })()}

      {/* KP 修改房间名弹窗 */}
      {renameModalOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
          onClick={handleCloseRename}
        >
          <div
            className="w-full max-w-md bg-slate-800 rounded-2xl shadow-2xl border border-slate-700 p-6"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold text-center text-cyan-400 mb-6">修改房间名</h2>

            <div className="mb-6">
              <label className="block text-sm font-medium mb-2 text-slate-300">房间名称</label>
              <input
                type="text"
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                maxLength={30}
                disabled={renameSubmitting}
                onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(); }}
                className="w-full p-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-cyan-500 outline-none text-white transition disabled:opacity-60"
                placeholder="输入房间名称（30字以内）"
                autoFocus
              />
              <p className="text-xs text-slate-500 mt-1 text-right">
                {renameValue.length}/30
              </p>
            </div>

            <div className="space-y-3">
              <button
                onClick={handleRenameSubmit}
                disabled={renameSubmitting || !renameValue.trim()}
                className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-bold transition shadow-lg shadow-cyan-900/30"
              >
                {renameSubmitting ? '保存中...' : '保存'}
              </button>
              <button
                onClick={handleCloseRename}
                disabled={renameSubmitting}
                className="w-full py-2 text-slate-400 hover:text-slate-200 text-sm transition"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 房间信息弹窗：点击头部房间号方框打开（KP/PL 均可），展示创建时确定的房规 */}
      {rulesInfoOpen && (() => {
        const rules = rulesFromRoom(currentRoom);
        return (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
            onClick={() => setRulesInfoOpen(false)}
          >
            <div
              className="w-full max-w-md bg-slate-800 rounded-2xl shadow-2xl border border-slate-700 p-6 max-h-[85vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <h2 className="text-xl font-bold text-center text-cyan-400 mb-1">房间信息</h2>
              <p className="text-center text-xs text-slate-500 mb-5">「{currentRoom.name}」</p>

              {/* PC 角色卡初始可见性 */}
              <div className="text-xs text-slate-500 mb-1.5">PC 角色卡可见性（初始）</div>
              <div className="flex flex-wrap gap-1.5 mb-5">
                <span className="text-[10px] px-2 py-0.5 rounded-full border font-bold bg-cyan-900/40 border-cyan-700 text-cyan-300">
                  ✓ 头像与姓名
                </span>
                {CARD_SECTION_OPTIONS.map(o => (
                  <span
                    key={o.key}
                    className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${
                      rules.card_sections[o.key]
                        ? 'bg-cyan-900/40 border-cyan-700 text-cyan-300'
                        : 'bg-slate-800/60 border-slate-700 text-slate-500'
                    }`}
                  >
                    {rules.card_sections[o.key] ? '✓' : '✕'} {o.label}
                  </span>
                ))}
              </div>

              {/* 可选规则 */}
              <div className="grid grid-cols-2 gap-2 mb-4">
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
              <div className="flex items-center justify-center gap-4 text-xs mb-5">
                <span className="text-slate-400">
                  大成功 <b className="text-emerald-400 text-sm">≤ {rules.crit_threshold}</b>
                </span>
                <span className="text-slate-700">|</span>
                <span className="text-slate-400">
                  大失败 <b className="text-red-400 text-sm">≥ {rules.fumble_threshold}</b>
                </span>
              </div>

              <button
                onClick={() => setRulesInfoOpen(false)}
                className="w-full py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-slate-200 text-sm font-bold transition"
              >
                关闭
              </button>
            </div>
          </div>
        );
      })()}

      {/* KP 设置弹窗：暂停房间 / 删除房间 / 管理成员 */}
      {roomSettingsOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
          onClick={() => setRoomSettingsOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-slate-800 rounded-2xl shadow-2xl border border-slate-700 p-6"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold text-center text-cyan-400 mb-5">房间设置</h2>
            <div className="space-y-2.5">
              <button
                onClick={() => { setRoomSettingsOpen(false); setManageMembersModal(true); }}
                className="w-full py-3 bg-slate-700 hover:bg-slate-600 rounded-xl font-bold transition text-sm"
              >
                👥 管理成员
              </button>
              <button
                onClick={() => { setRoomSettingsOpen(false); handlePauseRoom(); }}
                className="w-full py-3 bg-amber-600 hover:bg-amber-500 rounded-xl font-bold transition text-sm"
              >
                ⏸ 暂停房间
              </button>
              <button
                onClick={() => { setRoomSettingsOpen(false); handleDeleteRoom(); }}
                className="w-full py-3 bg-red-800 hover:bg-red-500 rounded-xl font-bold transition text-sm"
              >
                🗑 删除房间
              </button>
            </div>
            <button
              onClick={() => setRoomSettingsOpen(false)}
              className="w-full py-2 text-slate-400 hover:text-slate-200 text-sm mt-4 transition"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 管理成员弹窗 */}
      {manageMembersModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[55] p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col">
            {/* 标题栏 */}
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <h2 className="text-lg font-bold text-white">管理成员</h2>
              <button
                onClick={() => { setManageMembersModal(false); setSelectedMembers([]); }}
                className="text-slate-400 hover:text-white text-xl"
              >
                ×
              </button>
            </div>

            {/* 成员列表（在房 + 暂离的 PL 均可被移除） */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {manageableMembers.length === 0 && (
                <p className="text-center text-slate-500 text-sm py-6">暂无可管理的成员</p>
              )}
              {manageableMembers.map(member => {
                if (!member || member.user_id === userId) return null;
                const isKP = member.user_id === currentRoom.creator_id;
                const isSelected = selectedMembers.includes(member.user_id);
                const isDetached = member.status === 'detached';
                return (
                  <div
                    key={member.id}
                    onClick={() => toggleMemberSelection(member.user_id)}
                    className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition ${
                      isSelected ? 'bg-cyan-900/30 border border-cyan-600' : 'bg-slate-800 hover:bg-slate-700'
                    }`}
                  >
                    <div className="w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0">
                      {isSelected && <span className="text-cyan-400 text-xs">✓</span>}
                    </div>
                    <div className="w-8 h-8 rounded-full bg-cyan-700 flex items-center justify-center text-sm font-bold overflow-hidden flex-shrink-0">
                      {member.profile?.avatar_url ? (
                        <img src={member.profile.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span>{(member.profile?.display_name || '?')[0]}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm truncate">{member.profile?.display_name || '未知'}</span>
                        {isKP ? (
                          <span className="px-1.5 py-0.5 bg-purple-600 rounded text-xs font-bold text-white">KP</span>
                        ) : (
                          <>
                            <span className="px-1.5 py-0.5 bg-cyan-600 rounded text-xs font-bold text-white">PL</span>
                            {isDetached ? (
                              <span className="px-1.5 py-0.5 bg-slate-600 rounded text-xs font-bold text-slate-200">暂离</span>
                            ) : (
                              <span className="px-1.5 py-0.5 bg-emerald-700 rounded text-xs font-bold text-white">在房</span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 底部按钮 */}
            <div className="p-4 border-t border-slate-800 flex items-center justify-between gap-3">
              <span className="text-sm text-slate-400">
                已选择: <span className="text-cyan-400 font-bold">{selectedMembers.length}</span> 人
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => { setManageMembersModal(false); setSelectedMembers([]); }}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition"
                >
                  取消
                </button>
                <button
                  onClick={handleRemoveSelectedMembers}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-bold transition"
                >
                  移除选中
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
