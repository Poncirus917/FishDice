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

DROP POLICY IF EXISTS "Users can view room members" ON room_members;
CREATE POLICY "Users can view room members" ON room_members
  FOR SELECT USING (
    auth.uid() = user_id OR
    auth.uid() IN (SELECT creator_id FROM rooms WHERE id = room_members.room_id) OR
    auth.uid() IN (SELECT user_id FROM room_members WHERE room_id = room_members.room_id)
  );

DROP POLICY IF EXISTS "Authenticated users can join rooms" ON room_members;
CREATE POLICY "Authenticated users can join rooms" ON room_members
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Users can update their own membership" ON room_members;
CREATE POLICY "Users can update their own membership" ON room_members
  FOR UPDATE USING (
    auth.uid() = user_id OR
    auth.uid() IN (SELECT creator_id FROM rooms WHERE id = room_members.room_id)
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

-- 辅助函数：SECURITY DEFINER 以属主身份执行、绕过 RLS，
-- 供其它表（如 dice_logs）的策略调用，避免 room_members 自引用策略导致无限递归
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

-- RLS: dice_logs
ALTER TABLE dice_logs ENABLE ROW LEVEL SECURITY;

-- 读取：房间成员可读；hidden 暗骰行只有 KP（创建者）能读，
-- Postgres Changes 同样遵守 RLS，因此暗骰 INSERT 不会推送到 PL 客户端
DROP POLICY IF EXISTS "Room members can read dice logs" ON dice_logs;
CREATE POLICY "Room members can read dice logs" ON dice_logs
  FOR SELECT TO authenticated
  USING (
    (public.is_room_creator(room_id, auth.uid()) OR public.is_room_member(room_id, auth.uid()))
    AND (msg_type <> 'hidden' OR public.is_room_creator(room_id, auth.uid()))
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
