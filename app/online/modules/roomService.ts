import { supabase } from '../../lib/supabase';
import type { Room, RoomWithMembers, RoomListItem, CreateRoomInput, DiceLog, DiceLogInsert, RoomNpcEntry, PrivateGroupWithMembers, CreatePrivateGroupInput } from './roomTypes';
import type { CharacterState } from '../../(single)/page';
import { DEFAULT_RULES, rulesToInsert, revealedFromMember } from './roomRules';
import type { CardSection } from './roomRules';

// 获取房间信息（包含成员列表）
export const getRoom = async (roomId: string): Promise<RoomWithMembers | null> => {
  const { data: room, error } = await supabase
    .from('rooms')
    .select()
    .eq('id', roomId)
    .single();

  if (error || !room) {
    console.log('getRoom - room not found:', { roomId, error });
    return null;
  }

  console.log('getRoom - room found:', room);

  // 获取成员记录（过滤掉 status='left' 的成员）
  const { data: membersData, error: membersError } = await supabase
    .from('room_members')
    .select('*')
    .eq('room_id', roomId)
    .in('status', ['active', 'detached']);

  console.log('getRoom - members raw:', {
    count: membersData?.length || 0,
    error: membersError,
    members: membersData
  });

  if (membersError) {
    console.error('getRoom - members error:', membersError);
  }

  // 如果有成员，批量获取用户信息
  let membersWithProfile: any[] = [];
  if (membersData && membersData.length > 0) {
    const userIds = [...new Set(membersData.map(m => m.user_id))];

    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url')
      .in('id', userIds);

    console.log('getRoom - profiles:', { profiles, error: profilesError });

    const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);

    membersWithProfile = membersData.map(m => ({
      ...m,
      profile: profileMap.get(m.user_id) || null,
    }));
  }

  console.log('getRoom - members with profile:', membersWithProfile);

  const { data: creatorProfile } = await supabase
    .from('profiles')
    .select('display_name, avatar_url')
    .eq('id', room.creator_id)
    .single();

  console.log('getRoom - creator:', creatorProfile);

  return {
    ...room,
    members: membersWithProfile,
    creator: creatorProfile || undefined,
  };
};

// 创建房间
export const createRoom = async (creatorId: string, input: CreateRoomInput): Promise<Room> => {
  // 生成4位数字房间号
  const generateRoomCode = () => {
    return Math.floor(1000 + Math.random() * 9000).toString();
  };

  const roomCode = generateRoomCode();

  const rules = input.rules ?? DEFAULT_RULES;
  const { data, error } = await supabase
    .from('rooms')
    .insert({
      creator_id: creatorId,
      name: input.name,
      room_code: roomCode,
      ...rulesToInsert(rules),
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('创建房间失败');

  // 将创建者加入房间
  const { error: memberError } = await supabase
    .from('room_members')
    .insert({
      room_id: data.id,
      user_id: creatorId,
      role: 'kp',
      status: 'active',
    });

  if (memberError) throw new Error(memberError.message);

  return data;
};

// KP 修改房间名（RLS 仅允许 creator_id 本人更新，用 .select() 校验确实更新了行）
export const renameRoom = async (roomId: string, name: string): Promise<void> => {
  const { data, error } = await supabase
    .from('rooms')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', roomId)
    .select();

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error('房间名更新失败，可能没有操作权限');
  }
};

// 加入房间
export const joinRoom = async (userId: string, input: { room_code: string; character_id?: string }): Promise<Room> => {
  // 先查找房间
  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('*')
    .eq('room_code', input.room_code)
    .single();

  if (roomError || !room) {
    throw new Error('房间不存在或房间号错误');
  }

  // 检查是否已在房间中
  const { data: existingMember } = await supabase
    .from('room_members')
    .select('id, status')
    .eq('room_id', room.id)
    .eq('user_id', userId)
    .single();

  if (existingMember) {
    if (existingMember.status === 'active') {
      // 已在房间中，直接返回房间信息
      return room;
    } else if (existingMember.status === 'detached') {
      // 暂离状态确认加入：恢复为 active，保留原角色卡
      const { error: resumeError } = await supabase
        .from('room_members')
        .update({ status: 'active', left_at: null })
        .eq('id', existingMember.id);

      if (resumeError) throw new Error(resumeError.message);
      return room;
    } else if (existingMember.status === 'left' || existingMember.status === 'removed') {
      // 之前主动退出或被 KP 移除：需要重新加入（更新状态和重新绑定角色卡）
      const { error: updateError } = await supabase
        .from('room_members')
        .update({
          status: 'active',
          character_id: input.character_id || null,
          joined_at: new Date().toISOString(),
        })
        .eq('id', existingMember.id);

      if (updateError) throw new Error(updateError.message);
      return room;
    }
  }

  // 检查角色卡是否存在
  // 注意：character_id 存的是 characters.data 里的 CharacterState.id（时间戳字符串），
  // 不是 BIGSERIAL 行主键，因此必须按 data->>id 查询（与 RoomView 的查询方式保持一致）
  if (input.character_id) {
    const { data: character, error: characterError } = await supabase
      .from('characters')
      .select('id')
      .eq('data->>id', input.character_id)
      .eq('owner_id', userId)
      .maybeSingle();

    if (characterError) {
      throw new Error(characterError.message);
    }

    if (!character) {
      throw new Error('角色卡不存在或不属于当前用户');
    }
  }

  // 加入房间
  const { error: memberError } = await supabase
    .from('room_members')
    .insert({
      room_id: room.id,
      user_id: userId,
      role: 'pl',
      status: 'active',
      character_id: input.character_id || null,
      joined_at: new Date().toISOString(),
    });

  if (memberError) throw new Error(memberError.message);

  return room;
};

// 离开房间
export const leaveRoom = async (roomId: string, userId: string, removeOthers = false): Promise<void> => {
  console.log('[leaveRoom] 开始执行:', { roomId, userId, removeOthers });

  if (removeOthers) {
    // KP 移除所有成员（排除KP自己）：清空 character_id 并标记为 removed（历史记录中不再显示）
    const { data, error } = await supabase
      .from('room_members')
      .update({
        status: 'removed',
        character_id: null,
        left_at: new Date().toISOString()
      })
      .eq('room_id', roomId)
      .neq('user_id', userId)
      .select();

    console.log('[leaveRoom] 移除结果:', { affected: data?.length, error, data });
    if (error) throw error;
  } else {
    // 先检查当前状态
    const { data: checkData, error: checkError } = await supabase
      .from('room_members')
      .select('id, user_id, status')
      .eq('room_id', roomId)
      .eq('user_id', userId);

    console.log('[leaveRoom] 检查当前状态:', { checkData, checkError });

    // 如果检查失败或没有数据，尝试查询所有成员来调试
    if (!checkData || checkData.length === 0) {
      const { data: allData, error: allError } = await supabase
        .from('room_members')
        .select('id, user_id, status, room_id')
        .eq('room_id', roomId);

      console.log('[leaveRoom] 查询房间所有成员（调试）:', { allData, allError, targetUserId: userId });
    }

    // 退出时清空角色卡
    const { data, error } = await supabase
      .from('room_members')
      .update({ status: 'left', left_at: new Date().toISOString(), character_id: null })
      .eq('room_id', roomId)
      .eq('user_id', userId)
      .select();

    console.log('[leaveRoom] 自己退出结果:', { affected: data?.length, error, data, roomId, userId });
    if (error) throw error;

    // 验证更新是否成功 - 查询该房间所有成员状态
    const { data: verifyData, error: verifyError } = await supabase
      .from('room_members')
      .select('id, user_id, status, character_id')
      .eq('room_id', roomId);

    console.log('[leaveRoom] 验证更新后所有成员状态:', { verifyData, verifyError });
  }
};

// 暂离房间（保留角色卡）
export const detachFromRoom = async (roomId: string, userId: string): Promise<void> => {
  // 用 .select() 校验确实更新了行（RLS 拒绝时会返回 0 行且不报错）
  const { data, error } = await supabase
    .from('room_members')
    .update({ status: 'detached', left_at: new Date().toISOString() })
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .select();

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('暂离失败，可能没有操作权限');
  }
};

// 恢复房间（原离开者的成员）
export const resumeRoom = async (roomId: string, userId: string): Promise<void> => {
  const { error } = await supabase
    .from('room_members')
    .update({ status: 'active', left_at: null })
    .eq('room_id', roomId)
    .eq('user_id', userId);

  if (error) throw error;
};

// KP 揭示某 PL 角色卡的一个分区给其他 PL（追加到 revealed_sections，不可逆）
// 返回更新后的完整分区列表；RLS 拒绝 / 行不存在时明确报错
export const revealCardSection = async (memberId: string, section: CardSection): Promise<CardSection[]> => {
  // 先读当前值（RLS 允许房间成员读 room_members）
  const { data: cur, error: readErr } = await supabase
    .from('room_members')
    .select('revealed_sections')
    .eq('id', memberId)
    .single();
  if (readErr) throw new Error(readErr.message);

  const next = revealedFromMember(cur?.revealed_sections);
  if (next.includes(section)) return next;
  next.push(section);

  const { data: updated, error: updErr } = await supabase
    .from('room_members')
    .update({ revealed_sections: next })
    .eq('id', memberId)
    .select('revealed_sections')
    .single();
  if (updErr) throw new Error(updErr.message);
  if (!updated) throw new Error('揭示失败，可能没有操作权限');

  return revealedFromMember(updated.revealed_sections);
};

// KP 暂停房间：KP 与所有 PL 全部暂离（detached），房间进入 paused；
// KP 再次进入时自动恢复（见 RoomContext.loadRoom）
export const pauseRoom = async (roomId: string): Promise<void> => {
  // 更新房间状态（用 .select() 校验确实更新了行，RLS 拒绝时会返回 0 行且不报错）
  const { data: roomData, error: roomError } = await supabase
    .from('rooms')
    .update({ status: 'paused' })
    .eq('id', roomId)
    .select();

  if (roomError) throw roomError;
  if (!roomData || roomData.length === 0) {
    throw new Error('房间状态更新失败，可能没有操作权限');
  }

  // 所有活跃成员（含 KP）标记为 detached
  const { error: memberError } = await supabase
    .from('room_members')
    .update({ status: 'detached' })
    .eq('room_id', roomId)
    .eq('status', 'active');

  if (memberError) throw memberError;
};

// KP 恢复房间
export const resumeRoomByKP = async (roomId: string): Promise<void> => {
  const { error } = await supabase
    .from('rooms')
    .update({ status: 'active' })
    .eq('id', roomId);

  if (error) throw error;
};

// 删除房间
export const deleteRoom = async (roomId: string): Promise<void> => {
  const { error } = await supabase
    .from('rooms')
    .delete()
    .eq('id', roomId);

  if (error) throw error;
};

// 获取用户创建的房间列表
export const getUserCreatedRooms = async (userId: string): Promise<RoomListItem[]> => {
  const { data, error } = await supabase
    .from('rooms')
    .select('id, room_code, name, status, created_at')
    .eq('creator_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  return (data || []).map(room => ({
    id: room.id,
    room_code: room.room_code,
    name: room.name,
    status: room.status,
    created_at: room.created_at,
    member_count: 0,
    user_role: 'kp' as const,
  }));
};

// 获取用户加入的房间列表
export const getUserJoinedRooms = async (userId: string): Promise<RoomListItem[]> => {
  console.log('[getUserJoinedRooms] 开始, userId:', userId);
  // 只查询确定存在的列（线上旧表可能没有 role 字段，引用不存在的列会导致整个查询失败）
  // 仅保留 active / detached：主动退出（left）的房间不入历史，被移除（removed）的房间同样不显示
  const { data, error } = await supabase
    .from('room_members')
    .select('room_id, status, joined_at')
    .eq('user_id', userId)
    .in('status', ['active', 'detached']);

  console.log('[getUserJoinedRooms] 成员记录:', { count: data?.length, error, data });
  if (error) throw new Error(error.message);

  if (!data || data.length === 0) return [];

  const roomIds = data.map(m => m.room_id);

  const { data: rooms, error: roomsError } = await supabase
    .from('rooms')
    .select('id, room_code, name, status, created_at, creator_id')
    .in('id', roomIds)
    .order('created_at', { ascending: false });

  console.log('[getUserJoinedRooms] 房间记录:', { count: rooms?.length, roomsError, rooms });
  if (roomsError) throw new Error(roomsError.message);

  // 合并房间信息和成员状态
  const result = (rooms || [])
    // KP 自己创建的房间不在"我加入的"中重复展示（已在"我创建的"里）
    .filter(room => room.creator_id !== userId)
    .map(room => {
      const memberInfo = data.find(m => m.room_id === room.id);
      return {
        id: room.id,
        room_code: room.room_code,
        name: room.name,
        status: room.status,
        created_at: room.created_at,
        member_count: 0,
        // 已过滤掉自己创建的房间，剩下的记录身份必然是 PL
        user_role: 'pl' as const,
        member_status: memberInfo?.status as 'active' | 'detached',
      };
    });

  console.log('[getUserJoinedRooms] 最终返回:', result.length, result);
  return result;
};

// 获取角色的 KP 信息
export const getCharacterKP = async (characterId: string): Promise<{ kp_id: string; kp_name: string } | null> => {
  const { data, error } = await supabase
    .from('characters')
    .select('kp_id, kp_name')
    .eq('id', characterId)
    .single();

  if (error || !data) return null;
  return data;
};

// ---------- 掷骰 / 共享消息流 ----------

// 写入一条掷骰 / 消息日志（写入后由 Postgres Changes 实时推送给房间内其他客户端）
export const insertDiceLog = async (input: DiceLogInsert): Promise<DiceLog> => {
  const { data, error } = await supabase
    .from('dice_logs')
    .insert({
      room_id: input.room_id,
      user_id: input.user_id,
      character_id: input.character_id ?? null,
      char_name: input.char_name ?? null,
      msg_type: input.msg_type,
      label: input.label,
      roll: input.roll ?? null,
      target: input.target ?? null,
      level: input.level ?? null,
      payload: input.payload ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('写入掷骰日志失败');
  return data as DiceLog;
};

// 读取房间最近的掷骰 / 消息日志（按时间正序，便于像聊天记录一样从旧到新展示）
// hidden 暗骰 / 他人 note 笔记行由 RLS 自动过滤，客户端无需特殊处理
export const getDiceLogs = async (roomId: string, limit: number = 200): Promise<DiceLog[]> => {
  const { data, error } = await supabase
    .from('dice_logs')
    .select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data || []) as DiceLog[];
};

// 删除单条掷骰 / 消息日志（RLS：作者本人或 KP 可删；UI 上仅 KP 提供入口）
export const deleteDiceLog = async (logId: string): Promise<void> => {
  const { data, error } = await supabase
    .from('dice_logs')
    .delete()
    .eq('id', logId)
    .select();

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error('删除失败，可能没有操作权限');
  }
};

// ---------- 房间 NPC / 怪物实例 ----------

// 查询房间的角色实例（KP 看到全部；PL 受 RLS 限制只返回 visible 实例）
export const getRoomNpcEntries = async (roomId: string): Promise<RoomNpcEntry[]> => {
  const { data, error } = await supabase
    .from('room_npcs')
    .select('*')
    .eq('room_id', roomId)
    .order('added_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data || []) as RoomNpcEntry[];
};

// 把一个角色加入房间（默认 visible=false 对 PL 隐藏）。
// NPC 每个房间只能存在一个；怪物可重复加入多个实例。
export const addRoomNpcEntry = async (roomId: string, character: CharacterState): Promise<RoomNpcEntry> => {
  if (character.type === 'npc') {
    const { data: existing, error: checkError } = await supabase
      .from('room_npcs')
      .select('id')
      .eq('room_id', roomId)
      .eq('character_id', character.id);

    if (checkError) throw new Error(checkError.message);
    if (existing && existing.length > 0) {
      throw new Error(`NPC「${character.name}」已在房间中，不能重复加入`);
    }
  }

  const { data, error } = await supabase
    .from('room_npcs')
    .insert({ room_id: roomId, character_id: character.id, visible: false })
    .select()
    .single();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('加入房间失败');
  return data as RoomNpcEntry;
};

// 切换实例的 PL 可见性
export const setRoomNpcVisible = async (entryId: string, visible: boolean): Promise<void> => {
  const { data, error } = await supabase
    .from('room_npcs')
    .update({ visible })
    .eq('id', entryId)
    .select();

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error('可见性更新失败，可能没有操作权限');
  }
};

// 移除实例（只删关联，角色仍在 KP 角色库）。
// RLS 保证只有 visible=false 才能删，可见角色需先改回不可见。
export const removeRoomNpcEntry = async (entryId: string): Promise<void> => {
  const { data, error } = await supabase
    .from('room_npcs')
    .delete()
    .eq('id', entryId)
    .select();

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error('移除失败：该角色当前在场，请先改为不在场');
  }
};

// KP 设置/更换/移除 KPC（KP 扮演的 PC 角色）
// 存储于 room_members.character_id（KP 的成员记录）
// characterId 传 null 表示移除 KPC
export const setKpcCharacter = async (roomId: string, userId: string, characterId: string | null): Promise<void> => {
  const { data, error } = await supabase
    .from('room_members')
    .update({ character_id: characterId })
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .eq('role', 'kp')
    .select('id');

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error('设置 KPC 失败，请确认你是该房间的 KP');
  }
};

// ============================================
// 密聊小群（private_groups）
// ============================================

// 拉取房间内当前用户可见的密聊群（PL 仅自己所属群；KP 全部），含成员
export const getPrivateGroups = async (roomId: string): Promise<PrivateGroupWithMembers[]> => {
  const { data: groups, error } = await supabase
    .from('private_groups')
    .select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  if (!groups || groups.length === 0) return [];

  const groupIds = groups.map(g => g.id);
  const { data: members, error: membersError } = await supabase
    .from('private_group_members')
    .select('*')
    .in('group_id', groupIds);

  if (membersError) throw new Error(membersError.message);

  return groups.map(g => ({
    ...g,
    members: (members || []).filter(m => m.group_id === g.id),
  })) as PrivateGroupWithMembers[];
};

// KP 创建密聊群：插入群 + 选定成员（不包含 KP 本人；KP 靠房间创建者权限读写）
export const createPrivateGroup = async (input: CreatePrivateGroupInput): Promise<PrivateGroupWithMembers> => {
  const memberIds = [...new Set(input.memberUserIds)].filter(Boolean);
  if (memberIds.length === 0) throw new Error('请至少选择一名玩家');

  // 群名：KP 自定义，否则取最小的未被占用序号（避免删除旧群后新群重名）
  let name = (input.name || '').trim();
  if (!name) {
    const { data: existing } = await supabase
      .from('private_groups')
      .select('name')
      .eq('room_id', input.roomId);
    const used = new Set((existing ?? []).map(r => r.name as string));
    let n = 1;
    while (used.has(`密聊 #${n}`)) n++;
    name = `密聊 #${n}`;
  }

  // 前端预生成 id，以 return=minimal 写入：
  // PostgREST 对该表 INSERT...RETURNING 的结果行可见性检查与 RLS 存在兼容问题
  // （独立 SELECT 正常、带 RETURNING 即报 42501），不回传结果行即可稳定创建
  const groupId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const { error } = await supabase
    .from('private_groups')
    .insert({ id: groupId, room_id: input.roomId, name, created_by: input.createdBy });

  if (error) throw new Error(error.message);

  const rows = memberIds.map(uid => ({ group_id: groupId, user_id: uid, can_speak: true }));
  const { error: membersError } = await supabase
    .from('private_group_members')
    .insert(rows);

  if (membersError) throw new Error(membersError.message);

  return {
    id: groupId,
    room_id: input.roomId,
    name,
    created_by: input.createdBy,
    created_at: createdAt,
    members: rows.map(r => ({ ...r, joined_at: createdAt })),
  };
};

// KP 解散密聊群（消息行存于 dice_logs，群删除后 whisper 历史仍保留在各成员日志中）
export const deletePrivateGroup = async (groupId: string): Promise<void> => {
  const { error } = await supabase
    .from('private_groups')
    .delete()
    .eq('id', groupId);

  if (error) throw new Error(error.message);
};

// KP 切换整群是否允许 PL 发言（作用于群内所有成员行；KP 本人不受 can_speak 限制）
export const setGroupCanSpeak = async (groupId: string, canSpeak: boolean): Promise<void> => {
  // 同样以 return=minimal 更新，避免该表 RETURNING 可见性检查的 42501 问题
  const { error } = await supabase
    .from('private_group_members')
    .update({ can_speak: canSpeak })
    .eq('group_id', groupId);

  if (error) throw new Error(error.message);

  // 单独查询校验更新是否真的生效（RLS 静默拒绝时行数不会变化）
  const { count } = await supabase
    .from('private_group_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('group_id', groupId)
    .eq('can_speak', !canSpeak);

  if ((count ?? 0) !== 0) {
    throw new Error('设置失败，可能没有操作权限');
  }
};

// 发送一条密聊消息（msg_type='whisper'；RLS 保证仅群成员与 KP 可读 / PL 需 can_speak）
export const sendPrivateMessage = async (params: {
  roomId: string;
  groupId: string;
  groupName: string;
  senderUserId: string;
  senderName: string;
  text: string;
  characterId?: string | null;
}): Promise<DiceLog> => {
  const text = params.text.trim();
  if (!text) throw new Error('请输入消息内容');

  return insertDiceLog({
    room_id: params.roomId,
    user_id: params.senderUserId,
    character_id: params.characterId ?? null,
    char_name: params.senderName,
    msg_type: 'whisper',
    label: params.groupName,
    level: text,
    payload: { group_id: params.groupId, group_name: params.groupName },
  });
};
