-- ============================================
-- Supabase Realtime 配置脚本（幂等版本）
-- 在 Supabase Dashboard → SQL Editor 中执行
-- ============================================

-- 1. 设置 room_members 表的 replica identity 为 FULL
--    这是关键步骤：没有它 Supabase Postgres Changes 不会发送 UPDATE/DELETE 事件
--    即使表已在 publication 中，也需要此设置才能触发 UPDATE 事件
ALTER TABLE public.room_members REPLICA IDENTITY FULL;

-- 2. 同样为 rooms 表配置（用于房间状态变更通知）
ALTER TABLE public.rooms REPLICA IDENTITY FULL;

-- ============================================
-- 验证配置（执行后运行查看结果）
-- ============================================

-- 查看发布中包含哪些表（确认 room_members 已在其中）
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';

-- 查看 room_members 表的 replica identity 设置
SELECT relname, relreplident FROM pg_class WHERE relname = 'room_members';
-- relreplident: d=default, f=full, i=index, n=nothing
-- 期望结果: f (full)
