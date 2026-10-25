"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import Swal from 'sweetalert2';
import { useRoom } from './RoomContext';
import { useConfirmDialog } from './ConfirmDialog';
import NpcImportModal from './NpcImportModal';
import CharacterCardModal from './CharacterCardModal';
import KpcImportModal from './KpcImportModal';
import PrivateChatPanel, { usePrivateGroups } from './PrivateChatPanel';
import BackgroundGallery from './BackgroundGallery';
import { supabase } from '../../lib/supabase';
import { DEFAULT_AVATAR, DEFAULT_BACKGROUND } from '../../lib/constants';
import type { DiceGroup } from '../../utils/dice';
import type { CharacterState } from '../../(single)/page';
import type { RoomNpcEntry, DiceLog } from './roomTypes';
import { getRoomNpcEntries, setRoomNpcVisible, removeRoomNpcEntry, deleteDiceLog, insertDiceLog, revealCardSection, setKpcCharacter, sendPrivateMessage } from './roomService';
import { rulesFromRoom, sectionsForViewer, revealedFromMember, CARD_SECTION_OPTIONS } from './roomRules';
import type { CardSection } from './roomRules';

interface RoomViewProps {
  userId: string;
  displayName: string;
  avatarUrl: string;
  onBackToLobby: () => void;
}

export default function RoomView({ userId, displayName, avatarUrl, onBackToLobby }: RoomViewProps) {
  const { currentRoom, loading, pauseRoom, deleteRoom, leaveRoom, detachFromRoom, loadRoom, renameRoom, setRoomBackground, broadcastMemberRemoved, diceLogs, performCheck, performCustomRoll, sendCheckRequest, broadcastToRoom } = useRoom();
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
  // KP 背景图库弹窗
  const [bgGalleryOpen, setBgGalleryOpen] = useState(false);
  // 中央背景区实际宽高比（导入裁剪时使用）
  const bgAreaRef = useRef<HTMLDivElement>(null);
  const [bgAspect, setBgAspect] = useState(16 / 9);
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
  // 技能检定：checkLabel/checkTarget 由角色卡模糊搜索选中写入（不再手动输目标值）
  const [checkLabel, setCheckLabel] = useState('');
  const [checkTarget, setCheckTarget] = useState<number | ''>('');
  const [checkSearch, setCheckSearch] = useState('');
  const [checkSearchFocused, setCheckSearchFocused] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState<string>('');
  // 自由掷骰
  const [freeLabel, setFreeLabel] = useState('');
  const [freeDiceGroups, setFreeDiceGroups] = useState<DiceGroup[]>([{ count: 1, sides: 6 }]);
  const [freeBonus, setFreeBonus] = useState<number>(0);
  const logListRef = useRef<HTMLDivElement>(null);

  // 右侧历史记录面板（常态显示）+ 底部输入区
  const [inputText, setInputText] = useState('');
  const [inputBusy, setInputBusy] = useState(false);
  // 笔记模式：输入框内容作为私有笔记发送（仅自己可见），发送后自动退出笔记模式
  const [noteMode, setNoteMode] = useState(false);
  // 当前频道：'public' = 公屏；其他值 = 密聊群 id
  const [channel, setChannel] = useState<'public' | string>('public');
  // 频道选择弹窗（含 KP 建群 / 禁言 / 解散管理）
  const [channelMenuOpen, setChannelMenuOpen] = useState(false);
  // 掷骰频道：'public' = 公屏（默认）；其他值 = 密聊群 id（仅可发言群可选）
  const [rollChannel, setRollChannel] = useState<'public' | string>('public');

  // ---------- KP 检定请求 ----------
  // KP 发起弹窗
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [reqLabel, setReqLabel] = useState('');
  // 请求发起频道：公屏或某个密聊群
  const [reqChannel, setReqChannel] = useState<'public' | string>('public');
  const [reqTargets, setReqTargets] = useState<Set<string>>(new Set());
  const [reqBusy, setReqBusy] = useState(false);
  // 已取消的请求 id（KP 广播取消；仅本会话有效，刷新后历史取消的请求会重新显示）
  const [cancelledRequestIds, setCancelledRequestIds] = useState<Set<string>>(new Set());
  // PL 已弹过提示的请求 id（避免重复弹窗）
  const promptedRequestsRef = useRef<Set<string>>(new Set());

  // LOGS 显示内容过滤：发言 / 掷骰 / 笔记 + 各密聊群（含已解散群，默认全选；偏好存 localStorage）
  const [logFilter, setLogFilter] = useState<{
    speech: boolean; dice: boolean; note: boolean;
    whisperGroups: Record<string, boolean>;
  }>(() => {
    if (typeof window === 'undefined') return { speech: true, dice: true, note: true, whisperGroups: {} };
    try {
      const saved = JSON.parse(localStorage.getItem('fish_log_filter') || 'null');
      if (saved && typeof saved === 'object') {
        return {
          speech: saved.speech !== false,
          dice: saved.dice !== false,
          note: saved.note !== false,
          whisperGroups: saved.whisperGroups && typeof saved.whisperGroups === 'object' ? saved.whisperGroups : {},
        };
      }
    } catch { /* 忽略损坏的偏好 */ }
    return { speech: true, dice: true, note: true, whisperGroups: {} };
  });
  // LOGS 显示内容设置小弹窗
  const [logFilterOpen, setLogFilterOpen] = useState(false);
  // KP 发言/密聊时选择的角色名（null = 守秘人）
  const [kpSelectedCharName, setKpSelectedCharName] = useState<string | null>(null);
  // KPC 导入弹窗
  const [kpcImportOpen, setKpcImportOpen] = useState(false);
  // 密聊群（KP 全部可见；PL 仅自己所属群；实时同步）
  const { groups: privateGroups, notifyChanged: notifyPrivateChanged } = usePrivateGroups(currentRoom?.id ?? '');

  // 当前密聊频道被解散时自动回退到公屏
  useEffect(() => {
    if (channel !== 'public' && !privateGroups.some(g => g.id === channel)) {
      setChannel('public');
    }
  }, [privateGroups, channel]);

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

  // 密聊频道可选范围：KP 全部群；PL 仅本人 can_speak=true 的群
  const speakableGroups = isCreator
    ? privateGroups
    : privateGroups.filter(g => g.members.some(m => m.user_id === userId && m.can_speak));
  // 当前掷骰频道对应的密聊群（public → null）
  const rollGroup = rollChannel === 'public'
    ? null
    : (speakableGroups.find(g => g.id === rollChannel) ?? null);

  // 掷骰频道失效（群被解散 / 本人被禁言）时回退到公屏
  useEffect(() => {
    if (rollChannel !== 'public' && !speakableGroups.some(g => g.id === rollChannel)) {
      setRollChannel('public');
    }
  }, [rollChannel, privateGroups, userId, isCreator]);

  // 检定请求的候选目标：公屏=全体 PL；密聊群=该群内的 PL（被禁言者不可选）
  const reqGroup = reqChannel === 'public'
    ? null
    : (privateGroups.find(g => g.id === reqChannel) ?? null);
  const reqGroupSpeakableIds = new Set(
    (reqGroup?.members ?? []).filter(m => m.can_speak).map(m => m.user_id)
  );
  const reqGroupMemberIds = new Set((reqGroup?.members ?? []).map(m => m.user_id));
  const reqCandidates = (currentRoom?.members ?? []).filter(m =>
    m.role !== 'kp' && (reqChannel === 'public' || reqGroupMemberIds.has(m.user_id))
  );

  // 掷骰频道选择器：公屏（默认）或本人可发言的密聊群
  const rollChannelSelect = (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">频道</span>
      <select
        value={rollChannel}
        onChange={e => setRollChannel(e.target.value)}
        title="掷骰结果发送到哪个频道"
        className="w-36 bg-slate-900/70 border border-slate-700 rounded-xl px-2 py-2 text-xs outline-none focus:border-cyan-500 transition"
      >
        <option value="public">公屏（默认）</option>
        {speakableGroups.map(g => (
          <option key={g.id} value={g.id}>密聊 · {g.name}</option>
        ))}
      </select>
    </div>
  );

  // 追踪中央背景区实际宽高比（导入裁剪时按此比例输出）
  useEffect(() => {
    const el = bgAreaRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setBgAspect(rect.width / rect.height);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [currentRoom?.id]);

  // KP：应用 / 移除当前背景（url=null 表示移除）
  const handleApplyBackground = async (url: string | null, note: string | null) => {
    if (!currentRoom) return;
    await setRoomBackground(currentRoom.id, url, note);
  };

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

  // 新日志到达时自动滚动到底部（像聊天软件一样跟随最新消息）
  useEffect(() => {
    const el = logListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [diceLogs]);

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

  // KP：移除 KPC（清空 room_members.character_id）
  const handleRemoveKpc = async () => {
    if (!currentRoom) return;
    setNpcOpBusy(true);
    try {
      await setKpcCharacter(currentRoom.id, userId, null);
      // 触发重新加载房间数据以刷新成员列表
      await loadRoom(currentRoom.id);
      toast.success('KPC 已移除');
    } catch (err: any) {
      toast.error(err.message || '移除 KPC 失败');
    } finally {
      setNpcOpBusy(false);
    }
  };

  // KP：导入/更换 KPC
  const handleImportKpc = async (characterId: string) => {
    if (!currentRoom) return;
    setNpcOpBusy(true);
    try {
      await setKpcCharacter(currentRoom.id, userId, characterId);
      await loadRoom(currentRoom.id);
      toast.success('KPC 已设置');
      setKpcImportOpen(false);
    } catch (err: any) {
      toast.error(err.message || '设置 KPC 失败');
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
  const kpCanCheck = npcOptions.length > 0 || !!(isCreator && myCharacterId && allCharacters[myCharacterId]);

  // KP 导入的 KPC（KP 扮演的 PC 角色）：可参与技能检定
  const kpcCharacter = isCreator && myCharacterId ? allCharacters[myCharacterId] ?? null : null;

  // ---------- 技能检定：以角色卡数值为依据的模糊搜索 ----------
  // 检定所依据的角色卡：PL = 自己角色；KP = 代掷下拉所选（KPC / NPC / 怪物）
  const checkCharacter = isCreator
    ? (selectedEntryId === 'kpc'
        ? kpcCharacter
        : npcOptions.find(o => o.entryId === selectedEntryId)?.character
          ?? npcOptions[0]?.character
          ?? kpcCharacter)
    : (myCharacterId ? allCharacters[myCharacterId] ?? null : null);

  // 可检定项：属性 + 技能合并，剔除 HP/MP/SAN/LUCK 伪技能（与单机版一致）
  const CHECK_BLACKLIST = ['体力（hp）', '魔法（mp）', '理智（san）', '幸运（luck）', 'hp', 'mp', 'san', 'luck'];
  const checkSelectable: Array<{ name: string; value: number }> = checkCharacter
    ? (() => {
        const base = Object.entries({ ...(checkCharacter.attributes || {}), ...(checkCharacter.skills || {}) })
          .filter(([name]) => !CHECK_BLACKLIST.includes(name.toLowerCase()))
          .map(([name, value]) => ({ name, value: Number(value) || 0 }));
        // 理智/幸运是独立状态值（不在属性与技能字典里），按当前值追加为可检定项；同名键以状态值为准
        const merged = new Map(base.map(it => [it.name, it]));
        merged.set('理智', { name: '理智', value: checkCharacter.san?.current ?? 0 });
        merged.set('幸运', { name: '幸运', value: checkCharacter.luck?.current ?? 0 });
        return [...merged.values()];
      })()
    : [];
  // 模糊匹配：名称包含搜索词即可（与单机版一致）
  const filteredCheckItems = checkSelectable.filter(it => it.name.toLowerCase().includes(checkSearch.trim().toLowerCase()));

  // 切换检定角色（PL 换卡 / KP 切换代掷对象）时清空已选技能，避免残留旧卡数值
  const checkCharId = checkCharacter?.id ?? null;
  useEffect(() => {
    setCheckLabel('');
    setCheckTarget('');
    setCheckSearch('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkCharId]);

  // KP 发言/密聊时的角色选项：守秘人 / KPC / NPC / 怪物
  const kpCharOptions: Array<{ name: string | null; label: string }> = [
    { name: null, label: '守秘人' },
    ...(() => {
      const opts: Array<{ name: string | null; label: string }> = [];
      // KPC（KP 的 PC 角色）
      const kpc = myCharacterId ? allCharacters[myCharacterId] : null;
      if (kpc && isCreator) {
        opts.push({ name: kpc.name, label: `KPC·${kpc.name}` });
      }
      // NPC / 怪物（在场或全部，KP 可见全部）
      npcOptions.forEach(o => {
        const prefix = o.character.type === 'mob' ? '怪物·' : 'NPC·';
        opts.push({ name: o.display, label: `${prefix}${o.display}` });
      });
      return opts;
    })(),
  ];

  // KP 当前所选代言角色对象（null = 守秘人身份）：用于发言/密聊时写入 character_id，弹窗可显示对应头像
  const kpSelectedChar = (() => {
    if (!isCreator || !kpSelectedCharName) return null;
    const kpc = myCharacterId ? allCharacters[myCharacterId] : null;
    if (kpc && kpc.name === kpSelectedCharName) return kpc;
    return npcOptions.find(o => o.display === kpSelectedCharName)?.character ?? null;
  })();

  // KP 没有任何可代掷角色（无 NPC/怪物且未导入 KPC）时自动切到自由掷骰页签（检定行为必须绑定角色）
  useEffect(() => {
    if (isCreator && npcOptions.length === 0 && !kpcCharacter) setRollTab('custom');
  }, [isCreator, npcOptions.length, kpcCharacter]);

  // 检定：从角色卡模糊搜索选中技能/属性后发起 1D100；KP 必须选定代掷的 KPC/NPC/怪物
  const handlePerformCheck = async () => {
    const label = checkLabel.trim();
    const target = checkTarget === '' ? NaN : Number(checkTarget);

    if (!checkCharacter) {
      toast(isCreator ? '没有可代掷的角色，请使用自由掷骰' : '请先选择角色卡');
      return;
    }
    if (!label) {
      toast('请先搜索并选择检定项目');
      return;
    }
    if (!Number.isFinite(target) || target <= 0) {
      toast('请从下拉列表选择检定项目（目标值取自角色卡）');
      return;
    }

    try {
      if (isCreator) {
        // 代掷目标优先级：下拉所选（NPC/怪物实例或 KPC）→ 第一个 NPC 实例 → KPC
        const opt = npcOptions.find(o => o.entryId === selectedEntryId);
        const pick = selectedEntryId === 'kpc'
          ? kpcCharacter
          : opt?.character ?? npcOptions[0]?.character ?? kpcCharacter;
        const pickName = selectedEntryId === 'kpc'
          ? kpcCharacter?.name
          : opt?.display ?? npcOptions[0]?.display ?? kpcCharacter?.name;
        if (!pick) {
          toast('没有可代掷的角色，请使用自由掷骰');
          return;
        }
        await performCheck({
          label,
          target,
          characterId: pick.id,
          charName: pickName || pick.name,
          groupId: rollGroup?.id ?? null,
          groupName: rollGroup?.name ?? null,
        });
      } else {
        const myChar = myCharacterId ? allCharacters[myCharacterId] : null;
        await performCheck({
          label,
          target,
          characterId: myCharacterId,
          charName: myChar?.name || displayName,
          groupId: rollGroup?.id ?? null,
          groupName: rollGroup?.name ?? null,
        });
      }
      setCheckLabel('');
      setCheckTarget('');
      setCheckSearch('');
    } catch (err: any) {
      toast.error(err.message || '掷骰失败');
    }
  };

  // 选中一个检定项：写入名称与目标值（来自角色卡），搜索框同步显示技能名
  const pickCheckItem = (item: { name: string; value: number }) => {
    setCheckLabel(item.name);
    setCheckTarget(item.value);
    setCheckSearch(item.name);
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
        await performCustomRoll({
          label: freeLabel,
          groups: validGroups,
          bonus: freeBonus,
          charName: kpSelectedCharName || '守秘人',
          groupId: rollGroup?.id ?? null,
          groupName: rollGroup?.name ?? null,
        });
      } else {
        const myChar = myCharacterId ? allCharacters[myCharacterId] : null;
        await performCustomRoll({
          label: freeLabel,
          groups: validGroups,
          bonus: freeBonus,
          characterId: myCharacterId,
          charName: myChar?.name || displayName,
          groupId: rollGroup?.id ?? null,
          groupName: rollGroup?.name ?? null,
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
  // 六级判定颜色梯度：成功侧 大成功/极难/困难/普通 由亮绿到绿递进，失败侧同理
  const getLevelClass = (level: string | null) => {
    if (!level) return 'text-slate-300';
    if (level === '大成功') return 'text-emerald-300';
    if (level === '极难成功') return 'text-teal-300';
    if (level === '困难成功') return 'text-green-300';
    if (level === '成功') return 'text-green-400';
    if (level === '大失败') return 'text-red-300';
    return 'text-red-400';
  };

  // 格式化日志时间
  const formatLogTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // 日志归入三个显示分类：发言 / 掷骰（检定、自由、伤害、暗骰、请求、状态等）/ 笔记
  const getLogCategory = (t: DiceLog['msg_type']): 'speech' | 'dice' | 'note' =>
    t === 'note' ? 'note' : (t === 'speech' || t === 'whisper') ? 'speech' : 'dice';

  // 历史记录面板当前实际展示的日志（受设置弹窗的复选框控制）：
  // 密聊消息与密聊群内掷骰额外按群过滤（含已解散群，群列表从历史日志中提取）
  const visibleDiceLogs = diceLogs.filter(l => {
    if (l.msg_type === 'whisper') {
      if (!logFilter.speech) return false;
      const gid = (l.payload?.group_id as string | undefined) ?? '';
      return logFilter.whisperGroups[gid] !== false;
    }
    if (!logFilter[getLogCategory(l.msg_type)]) return false;
    // 密聊群内的掷骰 / 请求：跟随该群的显示开关
    const gid = (l.payload?.group_id as string | undefined) ?? '';
    return !gid || logFilter.whisperGroups[gid] !== false;
  });

  // 历史日志中出现过的密聊群（含已解散群：解散后消息与掷骰记录仍保留）
  const whisperGroupList = (() => {
    const map = new Map<string, string>();
    diceLogs.forEach(l => {
      const gid = l.payload?.group_id as string | undefined;
      if (!gid || map.has(gid)) return;
      map.set(
        gid,
        (l.payload?.group_name as string | undefined)
          || (l.msg_type === 'whisper' ? l.label : '')
          || '未命名群'
      );
    });
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  })();

  // 切换某分类显示并持久化偏好
  const toggleLogFilter = (key: 'speech' | 'dice' | 'note') => {
    setLogFilter(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem('fish_log_filter', JSON.stringify(next)); } catch { /* 忽略 */ }
      return next;
    });
  };

  // 切换某个密聊群（含已解散）的显示并持久化偏好
  const toggleWhisperGroupFilter = (gid: string) => {
    setLogFilter(prev => {
      const next = {
        ...prev,
        whisperGroups: { ...prev.whisperGroups, [gid]: prev.whisperGroups[gid] === false },
      };
      try { localStorage.setItem('fish_log_filter', JSON.stringify(next)); } catch { /* 忽略 */ }
      return next;
    });
  };

  // ---------- KP 检定请求：派生数据与处理 ----------
  // 全部检定请求行（msg_type='request'，按时间正序）
  const checkRequests = diceLogs.filter(l => l.msg_type === 'request');

  // 聚合某个请求的应答进度：按 payload.request_id 匹配 PL 的 check 应答行，每人取最新一次。
  // 仅统计"有几人已掷"，不判定通过与否——过没过、通过后如何处理由 KP 自行判断。
  const getRequestProgress = (req: DiceLog) => {
    const rid = (req.payload?.request_id as string | undefined) ?? '';
    const targetIds = ((req.payload?.user_ids as string[] | undefined) ?? []);
    const byUser = new Map<string, DiceLog>();
    if (rid) {
      diceLogs.forEach(l => {
        if (l.msg_type === 'check' && l.payload?.request_id === rid) {
          byUser.set(l.user_id, l);
        }
      });
    }
    const isSuccess = (l: DiceLog) => !!l.level && l.level.includes('成功');
    const rolledCount = byUser.size;
    const done = targetIds.length > 0 && rolledCount >= targetIds.length;
    return { rid, targetIds, byUser, rolledCount, done, isSuccess };
  };

  // 成员 user_id → 显示名（KP 请求卡片 / 发起弹窗用）
  const memberNameOf = (uid: string) =>
    (currentRoom?.members ?? []).find(m => m.user_id === uid)?.profile?.display_name || '未知玩家';

  // 检定项目 → 目标值：理智=当前SAN、幸运=当前幸运，技能/属性按卡面（卡上没有则不掷）
  const resolveCheckTarget = (char: CharacterState, label: string): number => {
    if (label === '理智') return char.san?.current ?? 0;
    if (label === '幸运') return char.luck?.current ?? 0;
    const skills = (char.skills || {}) as Record<string, number>;
    const attrs = (char.attributes || {}) as Record<string, number>;
    if (label in skills) return Number(skills[label]) || 0;
    if (label in attrs) return Number(attrs[label]) || 0;
    return 0;
  };

  // PL 应答检定请求：目标值取自己角色卡，应答行携带 request_id 供各端聚合；
  // 卡上没有该技能/属性时不掷骰（无"默认 5%"设定）
  const handleAnswerRequest = useCallback(async (req: DiceLog) => {
    const myChar = myCharacterId ? allCharacters[myCharacterId] : null;
    if (!myChar) {
      toast.error('请先在左侧选择你的角色卡');
      return;
    }
    const known = req.label === '理智' || req.label === '幸运'
      || (req.label in ((myChar.skills || {}) as object))
      || (req.label in ((myChar.attributes || {}) as object));
    if (!known) {
      toast.error(`你的角色卡上没有「${req.label}」，无法应答该检定`);
      return;
    }
    // 密聊群内请求：应答必须在该群可发言，且掷骰结果只回传给群内成员
    const reqGroupId = (req.payload?.group_id as string | undefined) || null;
    const reqGroupName = (req.payload?.group_name as string | undefined) || null;
    if (reqGroupId) {
      const group = privateGroups.find(g => g.id === reqGroupId);
      const mine = group?.members.find(m => m.user_id === userId);
      if (!mine?.can_speak) {
        toast.error('你已被禁言，无法在该密聊群中掷骰应答');
        return;
      }
    }
    try {
      await performCheck({
        label: req.label,
        target: resolveCheckTarget(myChar, req.label),
        characterId: myCharacterId,
        charName: myChar.name,
        groupId: reqGroupId,
        groupName: reqGroupName,
        payload: { request_id: (req.payload?.request_id as string | undefined) ?? '' },
      });
      toast.success(`已应答「${req.label}」检定`);
    } catch (err: any) {
      toast.error(err.message || '掷骰失败');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myCharacterId, allCharacters, performCheck, privateGroups, userId]);

  // KP：打开发起弹窗（默认公屏、全选在场 PL）
  const openRequestModal = () => {
    const pls = (currentRoom?.members ?? []).filter(m => m.role !== 'kp');
    setReqChannel('public');
    setReqTargets(new Set(pls.map(m => m.user_id)));
    setReqLabel('');
    setRequestModalOpen(true);
  };

  // KP：切换请求频道（密聊群仅可选该群内可发言的 PL）
  const handleReqChannelChange = (next: string) => {
    setReqChannel(next);
    if (next === 'public') {
      const pls = (currentRoom?.members ?? []).filter(m => m.role !== 'kp');
      setReqTargets(new Set(pls.map(m => m.user_id)));
    } else {
      const group = privateGroups.find(g => g.id === next);
      setReqTargets(new Set((group?.members ?? []).filter(m => m.can_speak).map(m => m.user_id)));
    }
  };

  // KP：勾选 / 取消请求目标玩家
  const toggleReqTarget = (uid: string) => {
    setReqTargets(prev => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  // KP：发出检定请求
  const handleSendRequest = async () => {
    if (!reqLabel.trim()) { toast('请填写检定项目'); return; }
    if (reqTargets.size === 0) { toast('请至少选择一名目标玩家'); return; }
    if (reqChannel !== 'public' && !reqGroup) {
      toast.error('该密聊群已不存在，请重新选择频道');
      return;
    }
    setReqBusy(true);
    try {
      await sendCheckRequest({
        label: reqLabel,
        targetUserIds: [...reqTargets],
        charName: kpSelectedCharName || '守秘人',
        groupId: reqGroup?.id ?? null,
        groupName: reqGroup?.name ?? null,
      });
      toast.success(reqGroup ? `检定请求已发到「${reqGroup.name}」` : '检定请求已发出');
      setRequestModalOpen(false);
    } catch (err: any) {
      toast.error(err.message || '发送失败');
    } finally {
      setReqBusy(false);
    }
  };

  // KP：取消检定请求（广播，各端本地隐藏该卡片；请求行仍保留在历史记录中）
  const handleCancelRequest = async (rid: string) => {
    setCancelledRequestIds(prev => new Set(prev).add(rid));
    try {
      await broadcastToRoom('check_request_cancelled', { request_id: rid });
    } catch { /* 广播失败不影响本地取消 */ }
  };

  // 监听 KP 取消检定请求的广播（PL 端）
  useEffect(() => {
    const onCancel = (e: Event) => {
      const rid = (e as CustomEvent).detail?.request_id as string | undefined;
      if (rid) setCancelledRequestIds(prev => new Set(prev).add(rid));
    };
    window.addEventListener('check-request-cancelled', onCancel);
    return () => window.removeEventListener('check-request-cancelled', onCancel);
  }, []);

  // PL 端：收到与自己相关的未完成检定请求时自动弹出提示（每个请求只弹一次）
  useEffect(() => {
    if (isCreator) return;
    checkRequests.forEach(req => {
      const p = getRequestProgress(req);
      if (!p.rid || p.done) return;
      if (!p.targetIds.includes(userId)) return;
      if (p.byUser.has(userId)) return;
      if (promptedRequestsRef.current.has(p.rid)) return;
      promptedRequestsRef.current.add(p.rid);
      Swal.fire({
        title: '📣 KP 检定请求',
        html: `KP 要求进行 <b class="text-cyan-600">${req.label}</b> 检定<br/>
          <span class="text-xs text-slate-500">目标值自动取自你的角色卡</span>`,
        icon: 'info',
        showCancelButton: true,
        confirmButtonText: '立即掷骰',
        cancelButtonText: '稍后',
        confirmButtonColor: '#0891b2',
        cancelButtonColor: '#475569',
        reverseButtons: true,
      }).then(r => { if (r.isConfirmed) handleAnswerRequest(req); });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diceLogs, isCreator, userId]);

  // 进行中的检定请求（未被取消，最新在上）；PL 只关心自己是目标的请求
  const activeCheckRequests = checkRequests
    .map(r => ({ req: r, p: getRequestProgress(r) }))
    .filter(x => x.p.rid !== '' && !cancelledRequestIds.has(x.p.rid))
    .reverse();
  const myActiveRequests = activeCheckRequests.filter(x => x.p.targetIds.includes(userId));

  // 掷骰结果悬浮提示队列：新骰子从底部入队、先出现的被顶上去，10 秒后自动消失
  const [rollToasts, setRollToasts] = useState<DiceLog[]>([]);
  // 已弹过提示的日志 id（防止重复弹出）
  const seenToastIdsRef = useRef<Set<string>>(new Set());

  // diceLogs 新增且为近期掷出（30 秒时间窗口，避免重进房间时历史日志误弹）→ 入队弹出；
  // 笔记（note）为私有内容不弹提示
  useEffect(() => {
    const now = Date.now();
    const fresh = diceLogs.filter(l =>
      l.msg_type !== 'note' &&
      l.msg_type !== 'request' &&
      !seenToastIdsRef.current.has(l.id) &&
      now - new Date(l.created_at).getTime() < 30000
    );
    if (fresh.length === 0) return;
    fresh.forEach(l => seenToastIdsRef.current.add(l.id));
    setRollToasts(prev => {
      const merged = [...prev, ...fresh];
      // 弹窗卡片较大（含头像），最多同时堆叠 3 条
      return merged.length > 3 ? merged.slice(merged.length - 3) : merged;
    });
    fresh.forEach(l => {
      setTimeout(() => {
        setRollToasts(prev => prev.filter(t => t.id !== l.id));
      }, 10000);
    });
  }, [diceLogs]);

  // 删除单条记录：KP 可删任何掷骰记录，PL 只能删自己的笔记（RLS：作者或 KP 可删）。
  // 删除后通过 postgres_changes DELETE 事件 + dice_log_deleted 广播双通道同步到所有客户端
  const handleDeleteLog = (log: DiceLog) => {
    // 房间发言任何人都不可删除
    if (log.msg_type === 'speech') {
      toast('房间发言不可删除');
      return;
    }
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

  // 统一发送：按 笔记模式 / 公屏 / 密聊频道 分发（输入框共用，Enter 发送）
  const handleSendInput = async () => {
    if (!currentRoom) return;
    const text = inputText.trim();
    if (!text) return;
    setInputBusy(true);
    try {
      const myChar = myCharacterId ? allCharacters[myCharacterId] : null;

      if (noteMode) {
        // 笔记：msg_type='note'，RLS 保证仅作者本人可读
        await insertDiceLog({
          room_id: currentRoom.id,
          user_id: userId,
          character_id: myCharacterId ?? null,
          char_name: isCreator ? '守秘人' : (myChar?.name || displayName),
          msg_type: 'note',
          label: '记录',
          level: text,
        });
        setNoteMode(false);
        setInputText('');
        toast.success('笔记已保存（仅自己可见）');
        return;
      }

      if (channel === 'public') {
        // 公屏发言：房间全体成员可读（KP 带所选角色 id，供弹窗头像显示）
        await insertDiceLog({
          room_id: currentRoom.id,
          user_id: userId,
          character_id: isCreator ? (kpSelectedChar?.id ?? null) : myCharacterId,
          char_name: isCreator ? (kpSelectedCharName || '守秘人') : (myChar?.name || displayName),
          msg_type: 'speech',
          label: '发言',
          level: text,
        });
        setInputText('');
        return;
      }

      // 密聊频道：写入 whisper（KP 或群内可发言成员）
      const group = privateGroups.find(g => g.id === channel);
      if (!group) {
        toast('该密聊群不存在或已解散');
        setChannel('public');
        return;
      }
      if (!isCreator) {
        const mem = group.members.find(m => m.user_id === userId);
        if (!mem) {
          toast.error('你不在该密聊群中');
          return;
        }
        if (!mem.can_speak) {
          toast.error('本群当前已被 KP 禁止发言');
          return;
        }
      }
      await sendPrivateMessage({
        roomId: currentRoom.id,
        groupId: group.id,
        groupName: group.name,
        senderUserId: userId,
        senderName: isCreator ? (kpSelectedCharName || '守秘人') : (myChar?.name || displayName),
        characterId: isCreator ? (kpSelectedChar?.id ?? null) : myCharacterId,
        text,
      });
      setInputText('');
    } catch (err: any) {
      toast.error(err.message || '发送失败');
    } finally {
      setInputBusy(false);
    }
  };

  // 导出掷骰记录为 TXT：内容随 LOGS 当前显示状态（发言 / 掷骰 / 笔记）过滤
  const exportLogs = () => {
    if (!currentRoom || visibleDiceLogs.length === 0) return;

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const fileName = `log_${dateStr}_${now.getHours()}${now.getMinutes()}.txt`;
    const header = `--- COC Dice Log Export (${now.toLocaleString()}) ---\n\n`;

    const content = visibleDiceLogs.map(log => {
      const sender = currentRoom.members.find(m => m.user_id === log.user_id);
      const name = (log.char_name && log.char_name !== '守秘人')
        ? log.char_name
        : (log.user_id === currentRoom.creator_id ? '守秘人' : (log.char_name || sender?.profile?.display_name || '未知'));
      const time = formatLogTime(log.created_at);

      if (log.msg_type === 'whisper') {
        return `[${time}] ${name} - 密聊(${log.label || ''}): ${log.level || ''}`;
      }
      if (log.msg_type === 'speech') {
        return `[${time}] ${name} - 发言: ${log.level || ''}`;
      }
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

  // 密聊卡片底色变体：同为暗红基调，各群按群 id 稳定取色（同一群颜色固定，不同群略有差异，便于区分）
  const WHISPER_TONES = [
    { card: 'bg-red-950/50 border-red-900/70', text: 'text-red-100/90', tag: 'text-red-400/90' },
    { card: 'bg-rose-950/50 border-rose-900/70', text: 'text-rose-100/90', tag: 'text-rose-400/90' },
    { card: 'bg-orange-950/50 border-orange-900/70', text: 'text-orange-100/90', tag: 'text-orange-400/90' },
    { card: 'bg-pink-950/50 border-pink-900/70', text: 'text-pink-100/90', tag: 'text-pink-400/90' },
    { card: 'bg-amber-950/50 border-amber-900/70', text: 'text-amber-100/90', tag: 'text-amber-400/90' },
  ];
  // 按群 id 哈希稳定选色（不随刷新变化；群 id 缺失时回落红色）
  const whisperTone = (gid: string | undefined) => {
    if (!gid) return WHISPER_TONES[0];
    let h = 0;
    for (let i = 0; i < gid.length; i++) h = (h * 31 + gid.charCodeAt(i)) >>> 0;
    return WHISPER_TONES[h % WHISPER_TONES.length];
  };

  // 日志署名：char_name 存在且不是"守秘人"（如 KP 代掷角色 A）时优先显示角色名
  const logSenderName = (log: DiceLog): string => {
    if (!currentRoom) return '未知';
    return (log.char_name && log.char_name !== '守秘人')
      ? log.char_name
      : (log.user_id === currentRoom.creator_id
        ? '守秘人'
        : (currentRoom.members.find(m => m.user_id === log.user_id)?.profile?.display_name || '未知'));
  };

  // 弹窗头像：角色发言/检定显示角色头像（PL 的 PC、KP 代掷的角色）；
  // 角色无头像或未加载到时，兜底为发言人自己的用户头像，最终兜底全局默认头像
  const avatarForLog = (log: DiceLog): string | null => {
    if (log.character_id) {
      const char = allCharacters[log.character_id];
      if (char?.avatar) return char.avatar;
    }
    const speaker = currentRoom?.members.find(m => m.user_id === log.user_id);
    return speaker?.profile?.avatar_url || DEFAULT_AVATAR;
  };

  // 掷骰结果 / 发言悬浮弹窗卡片：掷骰框上方靠左显示——左侧圆角矩形头像（约占中心空白高度 1/5~1/4），
  // 右侧内容框略低于头像，字号加大
  const renderToastCard = (log: DiceLog) => {
    const isWhisper = log.msg_type === 'whisper';
    const isSpeech = log.msg_type === 'speech';
    const isCheckType = log.msg_type === 'check' || log.msg_type === 'hidden';
    const tone = isWhisper ? whisperTone((log.payload?.group_id as string | undefined) || undefined) : null;
    const avatar = avatarForLog(log);
    const name = logSenderName(log);

    return (
      <div className="dice-toast-in pointer-events-auto relative flex items-start gap-3">
        {/* 头像（圆角矩形；各层级均无头像时显示全局默认头像） */}
        <div className="h-[14vh] min-h-20 aspect-square rounded-2xl overflow-hidden border-2 border-slate-600 bg-slate-800 flex-shrink-0 shadow-xl">
          <img src={avatar || DEFAULT_AVATAR} alt="" className="w-full h-full object-cover" />
        </div>

        {/* 内容框：略低于头像 */}
        <div
          className={`flex-1 min-w-0 mt-[3vh] rounded-2xl border p-3.5 shadow-xl ${
            tone
              ? tone.card
              : isSpeech
                ? 'bg-blue-950/60 border-blue-900/70'
                : 'bg-slate-900/95 border-slate-700'
          }`}
        >
          {/* 首行：署名 + 类型徽标 */}
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-black px-2 py-0.5 bg-slate-700/80 text-slate-200 rounded tracking-tight flex-shrink-0">
              {name}
            </span>
            {isWhisper && tone && <span className={`text-[11px] font-bold ${tone.tag}`}>🤫 密聊·{log.label}</span>}
            {/* 密聊群内的掷骰 / 请求：标注所属群，仅群成员可见 */}
            {!isWhisper && log.payload?.group_id && (
              <span className={`text-[11px] font-bold ${tone?.tag ?? 'text-rose-400'}`}>
                🤫 密聊·{(log.payload?.group_name as string) || '群聊'}
              </span>
            )}
            {isSpeech && <span className="text-[11px] text-blue-300">💬 房间发言</span>}
          </div>

          {/* 内容：发言/密聊显示正文；检定显示项目 + 出目 + 等级；其余类型显示描述 */}
          {isCheckType && log.roll !== null ? (
            <div className="flex items-baseline justify-between gap-3">
              <div className="font-bold text-base text-slate-100 min-w-0 truncate">{log.label}</div>
              <div className="font-mono text-xs text-slate-400 flex-shrink-0">
                Roll: <b className="text-white">{log.roll}</b>/{log.target}
              </div>
              <div className={`font-black text-lg italic flex-shrink-0 ${getLevelClass(log.level)}`}>{log.level}</div>
            </div>
          ) : log.msg_type === 'custom' ? (
            <div className="flex items-center justify-between gap-3 min-w-0">
              <div className="min-w-0">
                <div className="font-bold text-base text-slate-100 truncate">{log.label}</div>
                {/* 完整过程：2D6+1D4+2 = 3+2+2 = 9 */}
                <div className="font-mono text-xs text-slate-400 truncate">{log.level}</div>
              </div>
              <div className="font-black text-lg text-cyan-300 flex-shrink-0">{log.roll}</div>
            </div>
          ) : isWhisper || isSpeech ? (
            <div className={`text-[15px] leading-relaxed whitespace-pre-wrap break-words ${tone?.text ?? 'text-blue-100/90'}`}>
              {log.level}
            </div>
          ) : (
            <div className="text-[15px] text-slate-200">{log.label || log.level}</div>
          )}
        </div>

        {/* 左上角 10 秒剩余时间圆环 */}
        <div className="absolute -top-1.5 -left-1.5 w-6 h-6 text-cyan-400 drop-shadow z-10">
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
    );
  };

  // 单条日志卡片渲染（LOGS 面板与掷骰结果悬浮提示共用）
  // showDelete：是否显示悬停删除按钮（KP 对所有记录显示；PL 仅对自己的笔记显示）
  const renderLogCard = (log: DiceLog, showDelete: boolean) => {
    if (!currentRoom) return null;
    const senderName = logSenderName(log);
    const isCheckType = log.msg_type === 'check' || log.msg_type === 'hidden';
    const isNote = log.msg_type === 'note';
    const isSpeech = log.msg_type === 'speech';
    const isWhisper = log.msg_type === 'whisper';
    const isRequest = log.msg_type === 'request';
    // 密聊消息按所属群取暗红基调色变体（已解散群从历史消息的 payload 中仍可取到群 id）
    const tone = isWhisper ? whisperTone((log.payload?.group_id as string | undefined) || undefined) : null;

    return (
      <div
        key={log.id}
        className={`group relative p-2.5 rounded-lg border transition-all ${
          tone
            ? tone.card
            : isSpeech
              ? 'bg-blue-950/40 border-blue-900/60'
              : isNote
                ? 'bg-cyan-950/30 border-cyan-900/50'
                : isRequest
                  ? 'bg-amber-950/30 border-amber-900/60'
                  : 'bg-slate-800/70 border-slate-700/60'
        }`}
      >
        {/* 检定请求行与发言一样不可删除 */}
        {showDelete && log.msg_type !== 'whisper' && !isRequest && (
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
            {isWhisper && tone && <span className={tone.tag}>🤫 密聊·{log.label}</span>}
            {isSpeech && <span className="text-blue-400">💬 房间发言</span>}
            {isNote && <span className="text-cyan-600">📝 仅自己可见</span>}
            {isRequest && <span className="text-amber-400">📣 检定请求</span>}
          </div>
          <div className="text-[11px] font-black px-1.5 py-0.5 bg-slate-700/80 text-slate-300 rounded tracking-tight flex-shrink-0">
            {senderName}
          </div>
        </div>

        {isRequest ? (
          /* KP 的检定请求行：项目 + 已发送人数 */
          <>
            <div className="font-bold text-[14px] mb-1 text-amber-200">📣 {log.label}</div>
            <div className="text-[11px] text-amber-200/70">{log.level}</div>
          </>
        ) : log.msg_type === 'hidden' ? (
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
        ) : isWhisper ? (
          <div className={`text-[13px] whitespace-pre-wrap break-words leading-relaxed ${tone?.text ?? 'text-red-100/90'}`}>
            {log.level}
          </div>
        ) : isSpeech ? (
          <div className="text-[13px] text-blue-100/90 whitespace-pre-wrap break-words leading-relaxed">
            {log.level}
          </div>
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
  
  // 构造 KP 成员对象：优先使用数据库中的实际成员记录（含 KPC 的 character_id）
  const kpMemberActual = currentRoom.members.find(m => m.user_id === currentRoom.creator_id);
  const kpMember = kpMemberActual
    ? { ...kpMemberActual, profile: currentRoom.creator || kpMemberActual.profile }
    : {
        id: `kp-${currentRoom.creator_id}`,
        user_id: currentRoom.creator_id,
        role: 'kp' as const,
        status: 'active' as const,
        character_id: null as string | null,
        revealed_sections: null,
        joined_at: '',
        left_at: null,
        room_id: currentRoom.id,
        profile: currentRoom.creator || undefined,
      };
  
  // 排序：KP 在前，其他活跃成员在后
  const sortedActiveMembers = [
    kpMember,
    ...activeMembers,
  ];

  // 成员列表附角色名（PC名（PL名）展示用；NPC/怪物不计入，密聊群只含真实成员）
  const membersWithCharName = currentRoom.members.map(m => ({
    ...m,
    character_name: (m.character_id && allCharacters[m.character_id]?.name) || null,
  }));

  return (
    <div className="h-screen overflow-hidden bg-slate-900 text-white flex">
      {/* 左侧侧边栏 - 成员列表 */}
      <aside className="w-72 bg-slate-800 border-r border-slate-700 flex flex-col">
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
                    <img
                      src={member.profile?.avatar_url || DEFAULT_AVATAR}
                      alt=""
                      className="w-full h-full object-cover"
                    />
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
                {character && (
                  <div className="px-4 pb-3 pl-16">
                    <div
                      className="flex items-center gap-2 mt-2 cursor-pointer hover:bg-slate-700/60 rounded-lg px-2 py-1.5 -mx-2 transition"
                      title="查看角色卡"
                      onClick={() => { if (character) setViewCard(character); }}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold overflow-hidden ${
                        isKP ? 'bg-purple-600' : 'bg-cyan-600'
                      }`}>
                        <img src={character.avatar || DEFAULT_AVATAR} alt="" className="w-full h-full object-cover" />
                      </div>
                      <span className={`text-xs font-medium truncate max-w-32 ${
                        isKP ? 'text-purple-300' : 'text-cyan-300'
                      }`}>
                        {character.name}
                      </span>
                    </div>
                  </div>
                )}

                {/* KP 无 KPC 时显示导入按钮 */}
                {isKP && !character && isMe && (
                  <div className="px-4 pb-3 pl-16">
                    <button
                      onClick={() => setKpcImportOpen(true)}
                      className="flex items-center gap-2 mt-2 px-2 py-1.5 rounded-lg border border-dashed border-purple-700/60 text-[11px] text-purple-300/80 hover:bg-purple-900/30 transition w-full"
                    >
                      <span className="w-8 h-8 rounded-lg border border-dashed border-purple-700/60 flex items-center justify-center text-base">＋</span>
                      <span>导入 KPC</span>
                    </button>
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
                    <img
                      src={member.profile?.avatar_url || DEFAULT_AVATAR}
                      alt=""
                      className="w-full h-full object-cover"
                    />
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
                      <img src={character.avatar || DEFAULT_AVATAR} alt="" className="w-full h-full object-cover" />
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
                          <img src={c.avatar || DEFAULT_AVATAR} alt="" className="w-full h-full object-cover" />
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

      {/* 右侧主内容区域（min-h-0 配合根元素 h-screen，保证内部历史记录栏独立滚动） */}
      <div className="flex-1 min-h-0 flex flex-col">
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

        {/* 主内容区：中央背景区 + 右列（历史记录面板 + 输入区，常态显示） */}
        <div className="flex-1 min-h-0 flex gap-3 px-4 pb-4">
          {/* 中央列：背景区（上）+ 与底部悬浮掷骰面板等高的留白（下），两者不重合 */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">
            <div ref={bgAreaRef} className="relative flex-1 min-h-0 rounded-2xl overflow-hidden bg-slate-900">
              {/* 自定义背景优先；未设置或移除后回退到默认背景（不可删除） */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={currentRoom.background_url || DEFAULT_BACKGROUND}
                alt={currentRoom.background_note || '房间背景'}
                className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
                draggable={false}
              />
              {/* 轻遮罩：压暗四周，保证前景内容可读 */}
              <div className="absolute inset-0 bg-gradient-to-b from-slate-950/20 via-transparent to-slate-950/45 pointer-events-none" />

            {/* KP 快捷操作：背景图库 / 移除当前背景 */}
            {isCreator && (
              <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
                <button
                  onClick={() => setBgGalleryOpen(true)}
                  title="打开背景图库"
                  className="px-3 py-1.5 rounded-xl bg-slate-900/75 backdrop-blur border border-slate-700 text-slate-300 hover:text-white hover:border-cyan-600 text-[11px] font-bold transition"
                >
                  🖼 背景图库
                </button>
                {currentRoom.background_url && (
                  <button
                    onClick={() => handleApplyBackground(null, null)}
                    title="移除当前背景"
                    className="px-2.5 py-1.5 rounded-xl bg-slate-900/75 backdrop-blur border border-slate-700 text-slate-400 hover:text-red-300 hover:border-red-700 text-[11px] font-bold transition"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}

            {/* KP：当前背景备注（左上角，避开顶部快捷栏） */}
            {isCreator && currentRoom.background_url && currentRoom.background_note && (
              <div className="absolute top-3 left-3 z-10 px-2.5 py-1 rounded-lg bg-slate-950/60 backdrop-blur border border-slate-700/70 text-[10px] text-slate-300 max-w-[16rem] truncate">
                🖼 {currentRoom.background_note}
              </div>
            )}
            </div>

            {/* 与底部悬浮掷骰面板等高留白：保证背景区不与下侧面板重合 */}
            <div aria-hidden className="shrink-0 h-[calc(25vh+0.75rem)] min-h-[13.75rem]" />
          </div>

          {/* 右列：历史记录（上）+ 输入区（下） */}
          <div className="w-[22rem] flex-shrink-0 flex flex-col gap-2 min-h-0">
            {/* 历史记录面板 */}
            <div className="flex-1 min-h-0 bg-slate-900/85 backdrop-blur border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
              {/* 头部：标题 + 设置 / 导出 */}
              <div className="px-3 py-2.5 border-b border-slate-700 flex items-center gap-2 flex-shrink-0">
                <span>📜</span>
                <span className="font-bold text-sm">历史记录</span>
                <span className="text-[10px] text-slate-500">
                  {visibleDiceLogs.length}{diceLogs.length !== visibleDiceLogs.length && `/${diceLogs.length}`}
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    onClick={() => setLogFilterOpen(v => !v)}
                    title="设置显示内容"
                    className={`w-7 h-7 rounded-md border text-xs transition ${
                      logFilterOpen
                        ? 'bg-cyan-700 border-cyan-600 text-white'
                        : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
                    }`}
                  >
                    ⚙
                  </button>
                  <button
                    onClick={exportLogs}
                    title="导出为 TXT（按当前显示内容）"
                    className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-bold text-cyan-300 transition"
                  >
                    ⬇ EXPORT TXT
                  </button>
                </div>
              </div>

              {/* 日志列表（单机版卡片式渲染，按设置过滤） */}
              <div ref={logListRef} className="flex-1 overflow-y-auto p-3 space-y-2">
                {visibleDiceLogs.length === 0 && (
                  <p className="text-center text-slate-600 text-xs py-10 italic">
                    {diceLogs.length === 0 ? '暂无掷骰记录，等待第一掷…' : '当前筛选条件下没有记录'}
                  </p>
                )}

                {visibleDiceLogs.map(log =>
                  renderLogCard(
                    log,
                    // 房间发言任何人（含 KP）都不可删除
                    log.msg_type !== 'speech' && (isCreator || (log.msg_type === 'note' && log.user_id === userId))
                  )
                )}
              </div>
            </div>

            {/* 输入区：频道（公屏/密聊）与笔记共用输入框 */}
            <div className="relative bg-slate-900/90 backdrop-blur border border-slate-700 rounded-2xl shadow-2xl p-2.5 flex flex-col gap-1.5 flex-shrink-0">
              {/* 当前模式提示行 */}
              <div className="flex items-center gap-1.5 text-[10px] min-h-[16px]">
                {noteMode ? (
                  <span className="px-2 py-0.5 rounded-full bg-amber-900/60 border border-amber-700 text-amber-200 font-bold">
                    📝 笔记模式 · 仅自己可见
                  </span>
                ) : channel === 'public' ? (
                  <span className="px-2 py-0.5 rounded-full bg-blue-950/60 border border-blue-800 text-blue-200 font-bold">
                    💬 公屏 · 全体可见
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-red-950/60 border border-red-800 text-red-200 font-bold max-w-[10rem] truncate">
                    🤫 密聊 · {privateGroups.find(g => g.id === channel)?.name ?? ''}
                  </span>
                )}
                {channel !== 'public' && !noteMode && (() => {
                  const g = privateGroups.find(x => x.id === channel);
                  const muted = g && !isCreator && !g.members.find(m => m.user_id === userId)?.can_speak;
                  return muted ? <span className="text-red-400">🔇 已被禁言</span> : null;
                })()}
                {inputBusy && <span className="text-slate-500 ml-auto">发送中…</span>}
              </div>

              <textarea
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendInput();
                  }
                }}
                rows={2}
                placeholder={
                  noteMode
                    ? '输入剧情笔记（仅自己可见）…'
                    : channel === 'public'
                      ? '在公屏发言…'
                      : `在「${privateGroups.find(g => g.id === channel)?.name ?? ''}」中密聊…`
                }
                className="w-full px-2.5 py-2 bg-slate-950/70 border border-slate-700 rounded-xl text-xs text-white outline-none focus:border-cyan-500 resize-none transition placeholder:text-slate-600"
              />

              {/* 按钮行：频道 / 笔记 / KP 角色选择 / 发送 */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => { if (noteMode) setNoteMode(false); setChannelMenuOpen(v => !v); }}
                  title="切换发言频道（公屏 / 密聊群）；笔记模式下点击可切回发言模式"
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition ${
                    channel === 'public' && !noteMode
                      ? 'bg-blue-950/60 border-blue-800 text-blue-200 hover:bg-blue-900/60'
                      : 'bg-red-950/60 border-red-800 text-red-200 hover:bg-red-900/60'
                  }`}
                >
                  {channel === 'public' ? '频道：公屏' : `频道：${privateGroups.find(g => g.id === channel)?.name ?? '密聊'}`}
                </button>
                <button
                  onClick={() => setNoteMode(v => !v)}
                  title="笔记（仅自己可见，随记录导出 TXT）"
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition ${
                    noteMode
                      ? 'bg-amber-800 border-amber-600 text-amber-50'
                      : 'bg-amber-950/40 border-amber-900 text-amber-300/80 hover:bg-amber-900/50'
                  }`}
                >
                  笔记
                </button>
                {/* KP 角色选择：发言/密聊署名（守秘人/KPC/NPC/怪物） */}
                {isCreator && (
                  <select
                    value={kpSelectedCharName ?? ''}
                    onChange={e => setKpSelectedCharName(e.target.value || null)}
                    title="KP 发言署名角色"
                    className="max-w-28 text-[11px] bg-slate-900/70 border border-slate-700 rounded-lg px-1.5 py-1.5 text-slate-300 outline-none focus:border-purple-500"
                  >
                    {kpCharOptions.map(opt => (
                      <option key={opt.label} value={opt.name ?? ''}>{opt.label}</option>
                    ))}
                  </select>
                )}
                <button
                  onClick={handleSendInput}
                  disabled={inputBusy || !inputText.trim()}
                  className="ml-auto px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-[11px] font-bold text-white transition disabled:opacity-40"
                >
                  发送
                </button>
              </div>

              {/* 频道选择弹窗：公屏 / 密聊群列表（KP 含建群、禁言、解散管理） */}
              {channelMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setChannelMenuOpen(false)} />
                  <PrivateChatPanel
                    roomId={currentRoom.id}
                    userId={userId}
                    isCreator={isCreator}
                    members={membersWithCharName}
                    groups={privateGroups}
                    selectedGroupId={channel === 'public' ? null : channel}
                    onSelectGroup={gid => setChannel(gid ?? 'public')}
                    notifyChanged={notifyPrivateChanged}
                    onClose={() => setChannelMenuOpen(false)}
                  />
                </>
              )}
            </div>
          </div>
        </div>

        {/* KP 发起检定请求弹窗：项目 + 目标玩家（默认全选 PL；仅按勾选人数发送，不设通过条件） */}
        {requestModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setRequestModalOpen(false)}>
            <div className="absolute inset-0 bg-black/60" />
            <div
              className="relative w-96 max-w-[90vw] bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl p-5 flex flex-col gap-4"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-2">
                <span className="font-bold text-amber-300 text-sm">📣 发起检定请求</span>
                <button
                  onClick={() => setRequestModalOpen(false)}
                  className="ml-auto w-7 h-7 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition text-sm leading-none"
                >
                  ✕
                </button>
              </div>

              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">发起频道</label>
                <select
                  value={reqChannel}
                  onChange={e => handleReqChannelChange(e.target.value)}
                  className="mt-1.5 w-full bg-slate-900/70 border border-slate-700 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-500 transition"
                >
                  <option value="public">公屏（全房可见）</option>
                  {privateGroups.map(g => (
                    <option key={g.id} value={g.id}>密聊 · {g.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-slate-500">
                  {reqGroup
                    ? `仅「${reqGroup.name}」群成员可见并应答；被禁言的成员无法选择。`
                    : '公屏发起时全房可见，所有 PL 都可应答。'}
                </p>
              </div>

              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">检定项目</label>
                <input
                  autoFocus
                  type="text"
                  value={reqLabel}
                  onChange={e => setReqLabel(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSendRequest(); }}
                  placeholder="如：聆听 / 侦查 / 理智"
                  className="mt-1.5 w-full bg-slate-900/70 border border-slate-700 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-amber-500 transition"
                />
                <p className="mt-1 text-[10px] text-slate-500">玩家端目标值自动取自各自角色卡；卡上没有该技能的玩家将无法应答。过或没过由你自行判断。</p>
              </div>

              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                  目标玩家（{reqChannel === 'public' ? '默认全选' : '仅该群可发言成员'}）
                </label>
                <div className="mt-1.5 flex flex-col gap-1 max-h-36 overflow-y-auto">
                  {reqCandidates.length === 0 && (
                    <p className="text-[11px] text-slate-500 italic py-2">
                      该密聊群没有可应答的 PL（可能均已被禁言）。
                    </p>
                  )}
                  {reqCandidates.map(m => {
                    const muted = !!reqGroup && !reqGroupSpeakableIds.has(m.user_id);
                    return (
                      <label
                        key={m.user_id}
                        className={`flex items-center gap-2 text-sm cursor-pointer ${
                          muted ? 'text-slate-600 cursor-not-allowed' : 'text-slate-300 hover:text-white'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={reqTargets.has(m.user_id)}
                          disabled={muted}
                          onChange={() => toggleReqTarget(m.user_id)}
                          className="accent-amber-500"
                        />
                        <span className="truncate">{m.profile?.display_name || '未知玩家'}</span>
                        {m.status === 'detached' && <span className="text-[10px] text-slate-500 flex-shrink-0">（暂离）</span>}
                        {muted && <span className="text-[10px] text-slate-600 flex-shrink-0">（已禁言，无法应答）</span>}
                      </label>
                    );
                  })}
                </div>
              </div>

              <button
                onClick={handleSendRequest}
                disabled={reqBusy}
                className="w-full py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-sm transition disabled:opacity-40"
              >
                {reqBusy ? '发送中…' : '发出请求'}
              </button>
            </div>
          </div>
        )}

        {/* KP：背景图库（导入 / 备注 / 删除 / 设为背景） */}
        {isCreator && bgGalleryOpen && (
          <BackgroundGallery
            roomId={currentRoom.id}
            userId={userId}
            activeUrl={currentRoom.background_url}
            aspect={bgAspect}
            onApply={handleApplyBackground}
            onClose={() => setBgGalleryOpen(false)}
          />
        )}

        {/* 底部掷骰面板（悬浮窗）：贴页面下方、避开左侧角色栏与右侧历史记录列；内容单行排布，不做内部滚动 */}
        <div className="fixed left-[19rem] right-[24rem] bottom-4 z-30 h-[25vh] min-h-[13rem] rounded-2xl border border-slate-700 bg-slate-900/85 backdrop-blur shadow-2xl p-4 flex flex-col gap-3 overflow-hidden">
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
                检定类掷骰必须绑定角色：请先导入 KPC，或在左侧添加 NPC / 怪物并加入房间
              </p>
            )}
            {/* KP：发起检定请求（指定若干玩家各掷一次） */}
            {isCreator && (
              <button
                onClick={openRequestModal}
                title="要求玩家进行某项检定"
                className="ml-auto px-4 py-1.5 rounded-xl bg-amber-600/20 border border-amber-700/60 text-amber-300 hover:bg-amber-600/30 text-xs font-bold transition flex-shrink-0"
              >
                📣 请求检定
              </button>
            )}
          </div>

          {/* 左右两栏：左=掷骰操作，右=检定请求区 */}
          <div className="flex-1 min-h-0 flex gap-3">
            <div className="flex-1 min-w-0 min-h-0">

          {/* 技能检定：两行布局（第一行角色 / 第二行搜索+三档数值+掷骰） */}
          {rollTab === 'check' && (
            <div className="flex-1 min-h-0 flex flex-col justify-start gap-2.5">
              {/* 第一行：掷骰角色 */}
              <div className="flex items-center gap-2">
                {isCreator ? (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">代掷角色</span>
                    <select
                      value={selectedEntryId || npcOptions[0]?.entryId || (kpcCharacter ? 'kpc' : '')}
                      onChange={e => setSelectedEntryId(e.target.value)}
                      className="w-44 bg-slate-900/70 border border-slate-700 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-cyan-500"
                    >
                      {kpcCharacter && (
                        <option key="kpc" value="kpc">KPC·{kpcCharacter.name}</option>
                      )}
                      {npcOptions.map(o => (
                        <option key={o.entryId} value={o.entryId}>
                          {o.character.type === 'mob' ? '怪物·' : 'NPC·'}{o.display}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  /* PL 掷骰角色名：墨绿色圆角底框徽章 */
                  <div className="flex-shrink-0 px-4 py-2.5 rounded-xl bg-emerald-950/70 border border-emerald-800/60 flex items-center gap-2">
                    <span className="text-[10px] font-black text-emerald-500/90 uppercase tracking-widest">角色</span>
                    <span className="text-[15px] font-bold text-emerald-100">
                      {(myCharacterId && allCharacters[myCharacterId]?.name) || '未选择角色'}
                    </span>
                  </div>
                )}
                <div className="ml-auto">{rollChannelSelect}</div>
              </div>
              {/* 第二行：搜索 + 三档数值 + 掷骰 */}
              <div className="flex items-center gap-2">
              {/* 模糊搜索：以检定角色卡（PL 自己 / KP 代掷对象）的属性+技能为候选，选中后目标值取自卡片 */}
              <div className="relative flex-1 min-w-0">
                <input
                  type="text"
                  placeholder={checkCharacter ? '搜索技能或属性，如：侦查' : (isCreator ? '无可代掷角色' : '请先选择角色卡')}
                  disabled={!checkCharacter}
                  className="w-full bg-slate-900/70 border border-slate-700 rounded-xl px-4 py-2.5 text-[15px] outline-none focus:border-cyan-500 transition disabled:opacity-40"
                  value={checkSearch}
                  onFocus={() => setCheckSearchFocused(true)}
                  onBlur={() => setCheckSearchFocused(false)}
                  onChange={e => {
                    const v = e.target.value;
                    setCheckSearch(v);
                    // 输入内容与已选技能名不一致时清空选择，防止用旧目标值掷骰
                    if (v.trim() !== checkLabel) { setCheckLabel(v); setCheckTarget(''); }
                  }}
                  onKeyDown={e => {
                    if (e.key !== 'Enter') return;
                    // 未选中时 Enter 快速选中第一个匹配项；已选中则直接掷骰
                    if (checkTarget === '' && filteredCheckItems.length > 0) {
                      pickCheckItem(filteredCheckItems[0]);
                      return;
                    }
                    handlePerformCheck();
                  }}
                />
                {/* 上拉候选列表：仅在输入框有文字且聚焦时展开（与角色卡武器栏下拉一致） */}
                {checkSearchFocused && checkSearch.trim() !== '' && filteredCheckItems.length > 0 && (
                  <div className="absolute bottom-full mb-2 left-0 right-0 max-h-48 overflow-y-auto bg-slate-800/95 border border-slate-700 rounded-xl shadow-2xl shadow-black/50 z-50 py-1">
                    {filteredCheckItems.map(it => (
                      <button
                        key={it.name}
                        // onMouseDown 抢在输入框 blur 之前完成选中
                        onMouseDown={e => { e.preventDefault(); pickCheckItem(it); }}
                        className={`w-full flex items-center justify-between px-4 py-2 text-sm transition ${
                          checkLabel === it.name && checkTarget !== ''
                            ? 'bg-cyan-950/60 text-cyan-200'
                            : 'text-slate-200 hover:bg-slate-700/80'
                        }`}
                      >
                        <span className="font-bold truncate">{it.name}</span>
                        <span className="font-mono text-cyan-300 flex-shrink-0 ml-3">{it.value}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* 三档成功线：成功 = 卡面值，困难成功 = 1/2，极难成功 = 1/5（向下取整） */}
              {checkTarget !== '' && Number(checkTarget) > 0 ? (
                <div className="flex items-center gap-2 flex-shrink-0 text-xs font-bold">
                  <span className="px-3 py-2 rounded-xl bg-cyan-950/60 border border-cyan-800/60 text-cyan-300 whitespace-nowrap">
                    成功 <b className="text-sm font-black">≤{checkTarget}</b>
                  </span>
                  <span className="px-3 py-2 rounded-xl bg-indigo-950/60 border border-indigo-800/60 text-indigo-300 whitespace-nowrap">
                    困难 <b className="text-sm font-black">≤{Math.floor(Number(checkTarget) / 2)}</b>
                  </span>
                  <span className="px-3 py-2 rounded-xl bg-purple-950/60 border border-purple-800/60 text-purple-300 whitespace-nowrap">
                    极难 <b className="text-sm font-black">≤{Math.floor(Number(checkTarget) / 5)}</b>
                  </span>
                </div>
              ) : (
                <p className="text-xs text-slate-500 italic flex-shrink-0 whitespace-nowrap">
                  {checkCharacter ? '搜索并选择技能后掷骰' : ''}
                </p>
              )}
              <button
                onClick={handlePerformCheck}
                disabled={!checkCharacter}
                className="px-7 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-[15px] transition active:scale-[0.99] flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                掷骰
              </button>
              </div>
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
                {rollChannelSelect}
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
                    {/* 多组骰子之间显示 + 号，明确"相加"关系 */}
                    {index > 0 && <span className="font-black text-cyan-400/80">+</span>}
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

            {/* 右栏：检定请求区（KP 看进度并管理，PL 看自己的待办并应答） */}
            <div className="w-56 flex-shrink-0 border-l border-slate-700/70 pl-3 min-h-0 overflow-y-auto flex flex-col gap-2">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex-shrink-0">📣 检定请求</p>

              {(!isCreator ? myActiveRequests : activeCheckRequests).length === 0 && (
                <p className="text-[11px] text-slate-600 italic py-1 leading-relaxed">
                  {isCreator ? '暂无进行中的检定请求，点击上方「📣 请求检定」发起' : '暂无进行中的检定请求'}
                </p>
              )}

              {(!isCreator ? myActiveRequests : activeCheckRequests).map(({ req, p }) => (
                <div
                  key={p.rid}
                  className={`rounded-xl border p-2.5 flex flex-col gap-1.5 flex-shrink-0 ${
                    p.done ? 'border-emerald-800/60 bg-emerald-950/30' : 'border-amber-800/60 bg-amber-950/20'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs font-bold text-amber-200 truncate">{req.label}</span>
                    {req.payload?.group_id && (
                      <span className="text-[9px] font-bold text-rose-400 flex-shrink-0">
                        🤫 {(req.payload?.group_name as string) || '密聊'}
                      </span>
                    )}
                    {isCreator && (
                      <button
                        onClick={() => handleCancelRequest(p.rid)}
                        title="取消请求"
                        className="ml-auto text-slate-500 hover:text-red-400 text-xs leading-none flex-shrink-0"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 flex-shrink-0">
                    已掷 {p.rolledCount}/{p.targetIds.length}
                    {p.done && ' · 已全部掷骰'}
                  </div>

                  {/* PL：已应答显示自己的结果，未应答时显示掷骰按钮 */}
                  {!isCreator && (
                    p.byUser.has(userId) ? (
                      <div className={`text-[11px] font-bold ${p.isSuccess(p.byUser.get(userId)!) ? 'text-emerald-400' : 'text-red-400'}`}>
                        我的出目 {p.byUser.get(userId)!.roll} · {p.byUser.get(userId)!.level}
                      </div>
                    ) : (
                      <button
                        onClick={() => handleAnswerRequest(req)}
                        className="px-2 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-bold transition flex-shrink-0"
                      >
                        掷骰应答
                      </button>
                    )
                  )}

                  {/* KP：各目标玩家的应答明细 */}
                  {isCreator && (
                    <div className="flex flex-col gap-0.5">
                      {p.targetIds.map(uid => {
                        const log = p.byUser.get(uid);
                        return (
                          <div key={uid} className="flex items-center justify-between gap-2 text-[11px] min-w-0">
                            <span className="text-slate-300 truncate">{memberNameOf(uid)}</span>
                            {log ? (
                              <span className={`font-bold flex-shrink-0 ${p.isSuccess(log) ? 'text-emerald-400' : 'text-red-400'}`}>
                                {log.roll} {log.level}
                              </span>
                            ) : (
                              <span className="text-slate-600 flex-shrink-0">未掷</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 掷骰结果 / 发言悬浮弹窗：掷骰框上方锚定堆叠——新弹窗入队把先出现的顶上去，
          左侧头像 + 右侧内容框，左上角圆环为 10 秒剩余时间；左右缘与掷骰面板对齐（右侧贴近聊天记录栏） */}
      <div className="fixed left-[19rem] right-[24rem] bottom-[calc(25vh+1.25rem)] z-[45] flex flex-col gap-3 pointer-events-none">
        {rollToasts.map(log => renderToastCard(log))}
      </div>

      {/* LOGS 显示内容设置：右侧跳出小弹窗（发言 / 掷骰 / 笔记 + 各密聊群组，默认全选；TXT 导出同步遵循） */}
      {logFilterOpen && (
        <>
          {/* 透明点击层：点击弹窗外部关闭 */}
          <div className="fixed inset-0 z-[55]" onClick={() => setLogFilterOpen(false)} />
          <div className="popup-slide-right fixed right-4 top-[20%] z-[56] w-60 max-h-[70vh] overflow-y-auto bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-200">显示内容</h3>
              <button
                onClick={() => setLogFilterOpen(false)}
                className="text-slate-500 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <div className="space-y-1">
              {([
                { key: 'speech', icon: '💬', label: '发言' },
                { key: 'dice', icon: '🎲', label: '掷骰' },
                { key: 'note', icon: '📝', label: '笔记' },
              ] as const).map(item => {
                const checked = logFilter[item.key];
                return (
                  <label
                    key={item.key}
                    className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-slate-700/60 cursor-pointer transition"
                  >
                    <span
                      className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] flex-shrink-0 transition ${
                        checked
                          ? 'bg-cyan-600 border-cyan-500 text-white'
                          : 'bg-slate-900 border-slate-600 text-transparent'
                      }`}
                    >
                      ✓
                    </span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleLogFilter(item.key)}
                      className="sr-only"
                    />
                    <span className="text-xs">{item.icon} {item.label}</span>
                  </label>
                );
              })}
            </div>

            {/* 密聊群组逐群过滤（含已解散群：列表从历史密聊消息中提取） */}
            {whisperGroupList.length > 0 && logFilter.speech && (
              <div className="mt-3 pt-3 border-t border-slate-700/70">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                  🤫 密聊群组
                </p>
                <div className="space-y-1">
                  {whisperGroupList.map(g => {
                    const checked = logFilter.whisperGroups[g.id] !== false;
                    return (
                      <label
                        key={g.id}
                        className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-slate-700/60 cursor-pointer transition"
                      >
                        <span
                          className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] flex-shrink-0 transition ${
                            checked
                              ? 'bg-red-800 border-red-600 text-white'
                              : 'bg-slate-900 border-slate-600 text-transparent'
                          }`}
                        >
                          ✓
                        </span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleWhisperGroupFilter(g.id)}
                          className="sr-only"
                        />
                        <span className="text-xs truncate">{g.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <p className="mt-3 pt-3 border-t border-slate-700/70 text-[10px] text-slate-500 leading-relaxed">
              设置会即时生效，EXPORT TXT 导出的内容也按当前显示状态过滤。
            </p>
          </div>
        </>
      )}

      {Dialog}

      {/* KP 添加 NPC / 怪物弹窗（由侧栏虚线加号框打开，类型由所在分区决定） */}
      {npcImportType && (
        <NpcImportModal
          userId={userId}
          roomId={currentRoom.id}
          addType={npcImportType}
          onClose={() => setNpcImportType(null)}
        />
      )}

      {/* KPC 导入弹窗：KP 从角色库选一个 PC 作为 KPC */}
      {kpcImportOpen && (
        <KpcImportModal
          userId={userId}
          busy={npcOpBusy}
          onSelect={handleImportKpc}
          onClose={() => setKpcImportOpen(false)}
        />
      )}

      {/* 角色卡查看浮窗：点击左侧角色栏的 PC/NPC/怪物打开（NPC/怪物仅 KP 可打开）。
          PC 卡：KP 端带揭示控件；其他 PL 端按房规 + 已揭示分区过滤；自己的卡完整可见 */}
      {viewCard && (() => {
        // 查找角色卡所属的成员（PL 或 KP 的 KPC）
        const ownerMember = currentRoom.members.find(
          m => m.character_id === viewCard.id && (m.role === 'pl' || (m.role === 'kp' && m.user_id === currentRoom.creator_id))
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
                className="w-full py-3 bg-red-900 hover:bg-red-900 rounded-xl font-bold transition text-sm"
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
                      <img
                        src={member.profile?.avatar_url || DEFAULT_AVATAR}
                        alt=""
                        className="w-full h-full object-cover"
                      />
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
