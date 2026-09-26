import { supabase } from '../../lib/supabase';
import type { Room, RoomWithMembers, RoomListItem, CreateRoomInput, DiceLog, DiceLogInsert } from './roomTypes';

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

  const { data, error } = await supabase
    .from('rooms')
    .insert({
      creator_id: creatorId,
      name: input.name,
      room_code: roomCode,
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

// 恢复房间（原离开者的角色）
export const resumeRoom = async (roomId: string, userId: string): Promise<void> => {
  const { error } = await supabase
    .from('room_members')
    .update({ status: 'active', left_at: null })
    .eq('room_id', roomId)
    .eq('user_id', userId);

  if (error) throw error;
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
  // 排除 removed：被 KP 移除的房间不在历史记录中显示；left（主动退出）仍保留
  const { data, error } = await supabase
    .from('room_members')
    .select('room_id, status, joined_at')
    .eq('user_id', userId)
    .in('status', ['active', 'detached', 'left']);

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
        member_status: memberInfo?.status as 'active' | 'detached' | 'left',
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
// hidden 暗骰行由 RLS 自动处理：PL 的查询结果中不包含，KP 正常返回
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
