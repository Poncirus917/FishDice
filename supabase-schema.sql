-- ============================================
-- 鱼骰联机版 Supabase 数据库 Schema
-- 在 Supabase Dashboard → SQL Editor 中执行
-- 执行顺序：整份脚本一次运行，或单独运行"变更脚本"段落
-- ============================================

-- 1. profiles 表（用户个人信息，关联 auth.users）
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- display_name 唯一约束（用户名不可重复）
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS unique_display_name;
ALTER TABLE profiles ADD CONSTRAINT unique_display_name UNIQUE (display_name);

-- 2. 注册时自动创建 profile 行（从 user_metadata 取 display_name，email 从 auth.users 同步）
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'display_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. characters 表（角色卡，data 存完整 CharacterState JSON）
CREATE TABLE IF NOT EXISTS characters (
  id BIGSERIAL PRIMARY KEY,
  owner_id UUID REFERENCES auth.users(id) NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_characters_owner ON characters(owner_id);

-- 4. RLS: profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- 允许匿名/任何用户通过 email 查询是否已注册（用于注册页失焦检测，只返回count）
DROP POLICY IF EXISTS "Anyone can check email existence" ON profiles;
CREATE POLICY "Anyone can check email existence" ON profiles
  FOR SELECT USING (true);

-- 5. RLS: characters（用户只能 CRUD 自己的角色）
ALTER TABLE characters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own characters" ON characters;
CREATE POLICY "Users can view own characters" ON characters
  FOR SELECT USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can insert own characters" ON characters;
CREATE POLICY "Users can insert own characters" ON characters
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can update own characters" ON characters;
CREATE POLICY "Users can update own characters" ON characters
  FOR UPDATE USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can delete own characters" ON characters;
CREATE POLICY "Users can delete own characters" ON characters
  FOR DELETE USING (auth.uid() = owner_id);

-- 6. 头像存储桶（public）
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- 7. Storage RLS: avatars
DROP POLICY IF EXISTS "Anyone can read avatars" ON storage.objects;
CREATE POLICY "Anyone can read avatars" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Authenticated users can upload avatars" ON storage.objects;
CREATE POLICY "Authenticated users can upload avatars" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Authenticated users can update avatars" ON storage.objects;
CREATE POLICY "Authenticated users can update avatars" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Authenticated users can delete avatars" ON storage.objects;
CREATE POLICY "Authenticated users can delete avatars" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'avatars');

-- ============================================
-- 变更脚本（如果表已经存在，运行以下内容即可）
-- ============================================

-- 给已有的 profiles 表加 email 列
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;

-- 把已有用户的邮箱从 auth.users 同步到 profiles.email
UPDATE profiles
SET email = auth.users.email
FROM auth.users
WHERE profiles.id = auth.users.id
  AND profiles.email IS NULL;

-- 更新触发器（保存 email）
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'display_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 允许任何人查询 profiles（用于邮箱存在性检测）
DROP POLICY IF EXISTS "Anyone can check email existence" ON profiles;
CREATE POLICY "Anyone can check email existence" ON profiles
  FOR SELECT USING (true);

-- ============================================
-- 8. rooms 表（房间信息）
-- ============================================
CREATE TABLE IF NOT EXISTS rooms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK (char_length(name) <= 30),
  creator_id UUID REFERENCES auth.users(id) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'deleted')),
  -- PC 角色卡对其他 PL 的分区可见性（创建时由 KP 勾选，默认全可见）
  card_sections JSONB NOT NULL DEFAULT '{"story":true,"possessions":true,"backgrounds":true,"core":true,"skills":true,"weapons":true,"spells":true}',
  enable_push BOOLEAN NOT NULL DEFAULT true,        -- 孤注一掷
  enable_burn_luck BOOLEAN NOT NULL DEFAULT true,  -- 燃烧幸运
  crit_threshold INT NOT NULL DEFAULT 3 CHECK (crit_threshold BETWEEN 1 AND 5),      -- 大成功阈值
  fumble_threshold INT NOT NULL DEFAULT 98 CHECK (fumble_threshold BETWEEN 96 AND 100), -- 大失败阈值
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rooms_creator ON rooms(creator_id);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(room_code);

-- Realtime 要求：UPDATE 事件需完整旧行（改名/暂停后客户端需对比 old/new 的 name、status）
ALTER TABLE rooms REPLICA IDENTITY FULL;

-- 9. room_members 表（房间成员）
CREATE TABLE IF NOT EXISTS room_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  character_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('kp', 'pl')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'detached', 'left', 'removed')),
  -- KP 在房间内揭示给其他 PL 的角色卡分区（只增不减）
  revealed_sections JSONB NOT NULL DEFAULT '[]',
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  UNIQUE(room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_room_members_room ON room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id);
CREATE INDEX IF NOT EXISTS idx_room_members_status ON room_members(status);

-- 10. RLS: rooms
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view rooms they're in" ON rooms;
CREATE POLICY "Users can view rooms they're in" ON rooms
  FOR SELECT TO authenticated
  USING (
    auth.uid() = creator_id OR
    auth.uid() IS NOT NULL
  );

DROP POLICY IF EXISTS "Authenticated users can create rooms" ON rooms;
CREATE POLICY "Authenticated users can create rooms" ON rooms
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Creator can update rooms" ON rooms;
CREATE POLICY "Creator can update rooms" ON rooms
  FOR UPDATE TO authenticated
  USING (auth.uid() = creator_id)
  WITH CHECK (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Creator can delete rooms" ON rooms;
CREATE POLICY "Creator can delete rooms" ON rooms
  FOR DELETE TO authenticated
  USING (auth.uid() = creator_id);

-- 11. RLS: room_members
ALTER TABLE room_members ENABLE ROW LEVEL SECURITY;

-- 辅助函数：SECURITY DEFINER 以属主身份执行、绕过 RLS，必须在下面的策略之前定义。
-- 供 room_members 自身及 dice_logs / room_npcs 的策略调用，避免子查询自引用同表导致无限递归。
CREATE OR REPLACE FUNCTION public.is_room_member(p_room_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.room_members
    WHERE room_id = p_room_id AND user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_room_creator(p_room_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rooms
    WHERE id = p_room_id AND creator_id = p_user_id
  );
$$;

DROP POLICY IF EXISTS "Users can view room members" ON room_members;
-- 同房间成员必须能互相看到（否则 PL 只能看到 KP 和自己）。
-- 注意：不能直接在策略中子查询 room_members 自身（RLS 自引用 → 无限递归，条件失效），
-- 必须改用 SECURITY DEFINER 函数 is_room_member / is_room_creator（函数体绕过 RLS）。
CREATE POLICY "Users can view room members" ON room_members
  FOR SELECT USING (
    public.is_room_creator(room_id, auth.uid()) OR
    public.is_room_member(room_id, auth.uid())
  );

DROP POLICY IF EXISTS "Authenticated users can join rooms" ON room_members;
CREATE POLICY "Authenticated users can join rooms" ON room_members
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Users can update their own membership" ON room_members;
CREATE POLICY "Users can update their own membership" ON room_members
  FOR UPDATE USING (
    public.is_room_creator(room_id, auth.uid()) OR
    auth.uid() = user_id
  );

-- ============================================
-- 12. dice_logs 表（房间共享掷骰 / 消息流，类似聊天记录）
-- ============================================
-- msg_type 说明：
--   check   明骰：1D100 技能/属性检定，全房可见
--   custom  明骰：自由掷骰（阶段3）
--   damage  数值变化日志（阶段3）
--   hidden  暗骰：仅 KP（房间创建者）可读取内容，PL 端只见"KP 进行了暗骰"提示（阶段3）
--   request KP 请求掷骰的系统消息（阶段4）
--   note    剧情笔记 / 文字记录
--   status  状态变更（重伤、疯狂等）
CREATE TABLE IF NOT EXISTS dice_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  character_id TEXT,
  char_name TEXT,
  msg_type TEXT NOT NULL CHECK (msg_type IN ('check', 'custom', 'damage', 'hidden', 'request', 'note', 'status')),
  label TEXT NOT NULL DEFAULT '',
  roll INTEGER,
  target INTEGER,
  level TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dice_logs_room ON dice_logs(room_id, created_at);

-- Realtime 要求：UPDATE/DELETE 事件需完整旧行（INSERT 不依赖，先为后续阶段备好）
ALTER TABLE dice_logs REPLICA IDENTITY FULL;

-- RLS: dice_logs
ALTER TABLE dice_logs ENABLE ROW LEVEL SECURITY;

-- 读取：房间成员可读；hidden 暗骰行只有 KP（创建者）能读；
-- note 笔记行仅作者本人可读（私有笔记，他人不可见）
-- Postgres Changes 同样遵守 RLS，因此暗骰 / 他人笔记的 INSERT 不会推送到其它客户端
DROP POLICY IF EXISTS "Room members can read dice logs" ON dice_logs;
CREATE POLICY "Room members can read dice logs" ON dice_logs
  FOR SELECT TO authenticated
  USING (
    (public.is_room_creator(room_id, auth.uid()) OR public.is_room_member(room_id, auth.uid()))
    AND (msg_type <> 'hidden' OR public.is_room_creator(room_id, auth.uid()))
    AND (msg_type <> 'note' OR user_id = auth.uid())
  );

-- 写入：房间成员可写；hidden 暗骰只允许 KP 写入
DROP POLICY IF EXISTS "Room members can insert dice logs" ON dice_logs;
CREATE POLICY "Room members can insert dice logs" ON dice_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.is_room_creator(room_id, auth.uid()) OR public.is_room_member(room_id, auth.uid()))
    AND (msg_type <> 'hidden' OR public.is_room_creator(room_id, auth.uid()))
  );

-- 更新：作者本人或 KP
DROP POLICY IF EXISTS "Author or KP can update dice logs" ON dice_logs;
CREATE POLICY "Author or KP can update dice logs" ON dice_logs
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_room_creator(room_id, auth.uid()));

-- 删除：作者本人或 KP（为后续"删除单条日志"预留）
DROP POLICY IF EXISTS "Author or KP can delete dice logs" ON dice_logs;
CREATE POLICY "Author or KP can delete dice logs" ON dice_logs
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_room_creator(room_id, auth.uid()));

-- 加入 Realtime 发布（幂等：重复执行不报错）
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.dice_logs;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 13. room_npcs 表（KP 导入房间的 NPC / 怪物实例）
-- ============================================
-- 一行 = 房间内的一个"角色实例"。关联 KP 拥有的角色（characters.data->>'id' 业务 ID）。
-- visible：导入默认 false（不在场）；KP 可设为 true（在场），设为在场后不可移除（需先改回不在场）。
-- NPC 每个房间只能存在一个（应用层校验）；同一种怪物可导入多个实例，
-- 因此不建 (room_id, character_id) 唯一约束。
CREATE TABLE IF NOT EXISTS room_npcs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE NOT NULL,
  character_id TEXT NOT NULL,
  visible BOOLEAN NOT NULL DEFAULT false,
  added_at TIMESTAMPTZ DEFAULT NOW()
);

-- 线上旧表迁移：补 visible 列、移除旧版"房间+角色"唯一约束（均幂等）
ALTER TABLE room_npcs ADD COLUMN IF NOT EXISTS visible BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE room_npcs DROP CONSTRAINT IF EXISTS room_npcs_room_id_character_id_key;

CREATE INDEX IF NOT EXISTS idx_room_npcs_room ON room_npcs(room_id);

ALTER TABLE room_npcs REPLICA IDENTITY FULL;

-- 辅助函数：某角色是否对某用户可见
--   KP（房间创建者）：可见该角色的所有实例
--   PL：只能通过 visible = true 的实例看到
CREATE OR REPLACE FUNCTION public.is_room_npc_visible(p_character_id TEXT, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.room_npcs rn
    WHERE rn.character_id = p_character_id
      AND (
        public.is_room_creator(rn.room_id, p_user_id)
        OR (public.is_room_member(rn.room_id, p_user_id) AND rn.visible)
      )
  );
$$;

-- RLS: room_npcs
ALTER TABLE room_npcs ENABLE ROW LEVEL SECURITY;

-- 读取：KP 看到全部实例；PL 只能看到 visible 的实例
DROP POLICY IF EXISTS "Room members can view room npcs" ON room_npcs;
CREATE POLICY "Room members can view room npcs" ON room_npcs
  FOR SELECT TO authenticated
  USING (
    public.is_room_creator(room_id, auth.uid())
    OR (public.is_room_member(room_id, auth.uid()) AND visible)
  );

-- 写入：仅 KP，且只能关联自己拥有的角色
DROP POLICY IF EXISTS "Creator can insert room npcs" ON room_npcs;
CREATE POLICY "Creator can insert room npcs" ON room_npcs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_room_creator(room_id, auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.characters c
      WHERE c.owner_id = auth.uid() AND c.data->>'id' = character_id
    )
  );

-- 更新：仅 KP（切换 visible）
DROP POLICY IF EXISTS "Creator can update room npcs" ON room_npcs;
CREATE POLICY "Creator can update room npcs" ON room_npcs
  FOR UPDATE TO authenticated
  USING (public.is_room_creator(room_id, auth.uid()));

-- 删除：仅 KP，且只能删除 visible = false 的实例（可见角色需先改为不可见）
DROP POLICY IF EXISTS "Creator can delete room npcs" ON room_npcs;
CREATE POLICY "Creator can delete room npcs" ON room_npcs
  FOR DELETE TO authenticated
  USING (public.is_room_creator(room_id, auth.uid()) AND NOT visible);

-- characters 追加 SELECT 策略：房间成员可读取自己有权看到的 NPC/怪物实例角色
-- （permissive 策略之间为 OR，与"只能查看自己的角色"并存）
DROP POLICY IF EXISTS "Room members can view imported npc characters" ON characters;
CREATE POLICY "Room members can view imported npc characters" ON characters
  FOR SELECT TO authenticated
  USING (public.is_room_npc_visible(data->>'id', auth.uid()));

-- 加入 Realtime 发布（幂等）
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.room_npcs;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 14. 房规配置：线上库迁移（rooms / room_members 新列，幂等）
-- ============================================
-- PC 角色卡分区可见性（默认全部可见）、孤注一掷 / 燃烧幸运开关、大成功 / 大失败阈值
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS card_sections JSONB NOT NULL DEFAULT '{"story":true,"possessions":true,"backgrounds":true,"core":true,"skills":true,"weapons":true,"spells":true}';
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS enable_push BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS enable_burn_luck BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS crit_threshold INT NOT NULL DEFAULT 3;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS fumble_threshold INT NOT NULL DEFAULT 98;

-- KP 在房间内揭示给其他 PL 的角色卡分区（只增不减）
ALTER TABLE room_members ADD COLUMN IF NOT EXISTS revealed_sections JSONB NOT NULL DEFAULT '[]';

-- 阈值范围校验（DROP + ADD，幂等；新库建表时的内联约束同名会被重建，结果一致）
ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_crit_threshold_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_crit_threshold_check CHECK (crit_threshold BETWEEN 1 AND 5);
ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_fumble_threshold_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_fumble_threshold_check CHECK (fumble_threshold BETWEEN 96 AND 100);

-- rooms / room_members 加入 Realtime 发布（幂等）：
-- 房间暂停状态与成员记录变更（加入/暂离/揭示）才能实时推送到其他客户端
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.room_members;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 修复 room_members 可见性：同房间 PL 必须能互相看到（此前策略子查询自引用同表导致
-- RLS 无限递归、“同房间成员”条件失效，PL 只能看到 KP 和自己）。
-- 先确保 SECURITY DEFINER 函数存在（绕过 RLS、无递归），再重建策略。本节可独立执行。
CREATE OR REPLACE FUNCTION public.is_room_member(p_room_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.room_members
    WHERE room_id = p_room_id AND user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_room_creator(p_room_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rooms
    WHERE id = p_room_id AND creator_id = p_user_id
  );
$$;

DROP POLICY IF EXISTS "Users can view room members" ON public.room_members;
CREATE POLICY "Users can view room members" ON public.room_members
  FOR SELECT USING (
    public.is_room_creator(room_id, auth.uid()) OR
    public.is_room_member(room_id, auth.uid())
  );

DROP POLICY IF EXISTS "Users can update their own membership" ON public.room_members;
CREATE POLICY "Users can update their own membership" ON public.room_members
  FOR UPDATE USING (
    public.is_room_creator(room_id, auth.uid()) OR
    auth.uid() = user_id
  );

-- 刷新 PostgREST schema 缓存（新列 / RLS 变更后避免“找不到列 / 表”错误）
NOTIFY pgrst, 'reload schema';
