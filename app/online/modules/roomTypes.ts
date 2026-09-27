import type { DiceGroup } from '../../utils/dice';
import type { CardSectionsState } from './roomRules';

export type RoomStatus = 'active' | 'paused' | 'deleted';
export type MemberStatus = 'active' | 'detached' | 'left' | 'removed';
export type MemberRole = 'kp' | 'pl';

export interface Room {
  id: string;
  room_code: string;
  name: string;
  creator_id: string;
  status: RoomStatus;
  // 房规（创建时确定；老房间由 rulesFromRoom 回退默认）
  card_sections: CardSectionsState;
  enable_push: boolean;
  enable_burn_luck: boolean;
  crit_threshold: number;
  fumble_threshold: number;
  created_at: string;
  updated_at: string;
}

export interface RoomMember {
  id: string;
  room_id: string;
  user_id: string;
  character_id: string | null;
  role: MemberRole;
  status: MemberStatus;
  // KP 在房间内揭示给其他 PL 的角色卡分区（不可逆）
  revealed_sections: string[];
  joined_at: string;
  left_at: string | null;
}

export interface RoomWithMembers extends Room {
  members: (RoomMember & { profile?: { display_name: string; avatar_url: string | null } })[];
  creator?: { display_name: string; avatar_url: string | null };
}

export interface RoomListItem {
  id: string;
  room_code: string;
  name: string;
  status: RoomStatus;
  created_at: string;
  member_count: number;
  user_role: MemberRole;
  member_status?: MemberStatus;
}

export interface CreateRoomInput {
  name: string;
  rules?: import('./roomRules').RoomRules;
  system?: string;
  playerLimit?: number;
  roundLimit?: number;
  gameMode?: string;
  maxRounds?: number;
  description?: string;
}

export interface JoinRoomInput {
  room_code: string;
  character_id: string;
}

// ---------- 掷骰 / 共享消息流 ----------

// check   明骰 1D100 技能/属性检定
// custom  明骰 自由掷骰
// damage  数值变化
// hidden  暗骰（仅 KP 可读）
// request KP 请求掷骰
// note    剧情笔记/文字记录
// status  状态变更
export type DiceMsgType = 'check' | 'custom' | 'damage' | 'hidden' | 'request' | 'note' | 'status';

export interface DiceLog {
  id: string;
  room_id: string;
  user_id: string;
  character_id: string | null;
  char_name: string | null;
  msg_type: DiceMsgType;
  label: string;
  roll: number | null;
  target: number | null;
  level: string | null;
  payload: Record<string, any> | null;
  created_at: string;
}

export interface DiceLogInsert {
  room_id: string;
  user_id: string;
  character_id?: string | null;
  char_name?: string | null;
  msg_type: DiceMsgType;
  label: string;
  roll?: number | null;
  target?: number | null;
  level?: string | null;
  payload?: Record<string, any> | null;
}

// 发起一次 1D100 检定的入参（掷骰者客户端产生结果后写库）
export interface PerformCheckInput {
  label: string;
  target: number;
  characterId?: string | null;
  charName?: string | null;
  hidden?: boolean;
}

// 发起一次自由掷骰（NdM 多组骰子 + 加值）的入参
export interface PerformCustomInput {
  label?: string;
  groups: DiceGroup[];
  bonus?: number;
  characterId?: string | null;
  charName?: string | null;
}

// room_npcs 一行：房间内的一个 NPC/怪物实例
export interface RoomNpcEntry {
  id: string;
  room_id: string;
  character_id: string;
  visible: boolean;
  added_at: string;
}
