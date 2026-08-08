// 前端 API 基础地址
// 开发环境默认 http://localhost:3001
// 生产环境通过 NEXT_PUBLIC_API_URL 环境变量注入（Cloudflare Pages 构建时设置）
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
