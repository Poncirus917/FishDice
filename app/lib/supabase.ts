import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // 本项目登录 / 验证码 / 重置均在页面内完成，无 OAuth URL 回调；
    // 关闭 URL 检测以避免其它链接参数被误判为鉴权回调
    detectSessionInUrl: false,
  },
});
