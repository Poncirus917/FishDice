export type RoomStatus = 'active' | 'paused' | 'deleted';
export type MemberStatus = 'active' | 'detached' | 'left' | 'removed';
export type MemberRole = 'kp' | 'pl';

export interface Room {
  id: string;
  room_code: string;
  name: string;
  creator_id: string;
  status: RoomStatus;
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
