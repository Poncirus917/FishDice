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
