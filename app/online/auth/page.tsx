"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { API_BASE } from '../../lib/apiConfig';

type Mode = 'login' | 'register' | 'reset';

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState(''); // 邮箱
  const [displayName, setDisplayName] = useState(''); // 用户名/昵称
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const router = useRouter();

  // 倒计时计时器
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  // 发送验证码
  const handleSendCode = async () => {
    if (!username.includes('@')) {
      toast.error("请输入有效的邮箱地址");
      return;
    }

    const purpose = mode === 'reset' ? 'reset' : 'register';

    try {
      const res = await fetch(`${API_BASE}/api/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: username, purpose }),
      });
      
      const data = await res.json();
      if (data.registered) {
        toast.error("该邮箱已注册，请直接登录");
        setMode('login');
      } else if (res.ok) {
        toast.success("验证码已发送至邮箱");
        setCountdown(60);
      } else {
        toast.error(data.message || "发送失败");
      }
    } catch (err) {
      toast.error("邮件服务连接失败");
    }
  };

  // 登录 / 注册 / 重置密码
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 重置密码：前端校验两次密码一致
    if (mode === 'reset') {
      if (newPassword !== confirmPassword) {
        toast.error("两次输入的密码不一致");
        return;
      }
    }

    const loadingToast = toast.loading(
      mode === 'login' ? '正在登录...' :
      mode === 'register' ? '正在验证注册...' :
      '正在重置密码...'
    );

    try {
      let endpoint = '/api/login';
      let body: Record<string, string> = { username, password };

      if (mode === 'register') {
        endpoint = '/api/register';
        body = { username, displayName, password, code };
      } else if (mode === 'reset') {
        endpoint = '/api/reset-password';
        body = { username, newPassword, code };
      }

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (res.ok) {
        if (mode === 'login') {
          toast.success('欢迎回来，调查员！', { id: loadingToast });
          localStorage.setItem('fish_user', data.displayName || username);
          localStorage.setItem('fish_email', username);
          router.push('/online');
        } else if (mode === 'register') {
          toast.success('调查员注册成功，请登录', { id: loadingToast });
          setMode('login');
          setPassword('');
          setCode('');
          setDisplayName('');
        } else {
          toast.success('密码重置成功，请登录', { id: loadingToast });
          setMode('login');
          setNewPassword('');
          setConfirmPassword('');
          setCode('');
        }
      } else {
        toast.error(data.message || '操作失败', { id: loadingToast });
      }
    } catch (err) {
      toast.error('连接服务器失败', { id: loadingToast });
    }
  };

  const switchMode = (newMode: Mode) => {
    setMode(newMode);
    setShowPassword(false);
    setCode('');
  };

  // 标题文案
  const titleText = mode === 'login' ? '调查员登录' : mode === 'register' ? '调查员注册' : '找回密码';

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white p-4">
      <div className="w-full max-w-md p-8 bg-slate-800 rounded-2xl shadow-2xl border border-slate-700">
        <h1 className="text-3xl font-bold mb-6 text-center text-cyan-400 font-serif">
          {titleText}
        </h1>
        
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* 邮箱 */}
          <div>
            <label className="block text-sm font-medium mb-1.5 text-slate-300">电子邮箱</label>
            <input
              type="email"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full p-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none transition-all"
              placeholder="your@email.com"
              required
            />
          </div>

          {/* 用户名 - 仅注册时显示 */}
          {mode === 'register' && (
            <div>
              <label className="block text-sm font-medium mb-1.5 text-slate-300">用户名</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full p-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none transition-all"
                placeholder="录入调查员姓名"
                required
              />
            </div>
          )}

          {/* 验证码 - 注册和重置密码时显示 */}
          {(mode === 'register' || mode === 'reset') && (
            <div>
              <label className="block text-sm font-medium mb-1.5 text-slate-300">验证码</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="flex-1 p-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-cyan-500 outline-none transition-all"
                  placeholder="6位数字"
                  required
                />
                <button
                  type="button"
                  disabled={countdown > 0}
                  onClick={handleSendCode}
                  className={`px-4 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
                    countdown > 0 
                    ? 'bg-slate-700 text-slate-400 cursor-not-allowed' 
                    : 'bg-slate-700 hover:bg-slate-600 text-cyan-400 border border-slate-600'
                  }`}
                >
                  {countdown > 0 ? `${countdown}s` : '获取验证码'}
                </button>
              </div>
            </div>
          )}
          
          {/* 密码 - 登录和注册时显示 */}
          {(mode === 'login' || mode === 'register') && (
            <div className="relative">
              <label className="block text-sm font-medium mb-1.5 text-slate-300">密码</label>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-cyan-500 outline-none transition-all"
                placeholder="请输入密码"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-[38px] text-slate-500 hover:text-cyan-400"
              >
                {showPassword ? (
                  <span className="text-xs">隐藏</span>
                ) : (
                  <span className="text-xs">显示</span>
                )}
              </button>
            </div>
          )}

          {/* 新密码 - 重置密码时显示 */}
          {mode === 'reset' && (
            <>
              <div className="relative">
                <label className="block text-sm font-medium mb-1.5 text-slate-300">新密码</label>
                <input
                  type={showPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full p-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-cyan-500 outline-none transition-all"
                  placeholder="请输入新密码"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-[38px] text-slate-500 hover:text-cyan-400"
                >
                  {showPassword ? (
                    <span className="text-xs">隐藏</span>
                  ) : (
                    <span className="text-xs">显示</span>
                  )}
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5 text-slate-300">确认新密码</label>
                <input
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full p-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-cyan-500 outline-none transition-all"
                  placeholder="再次输入新密码"
                  required
                />
              </div>
            </>
          )}

          <button
            type="submit"
            className="w-full py-3.5 mt-2 bg-cyan-600 hover:bg-cyan-500 active:scale-[0.98] rounded-xl font-bold transition-all shadow-lg shadow-cyan-900/30"
          >
            {mode === 'login' ? '立即进入' : mode === 'register' ? '完成注册并激活' : '重置密码'}
          </button>
        </form>

        {/* 底部切换链接 */}
        <div className="mt-6 text-center space-y-2">
          {mode === 'login' && (
            <>
              <button
                onClick={() => switchMode('register')}
                className="text-slate-400 hover:text-cyan-400 text-sm transition-colors block w-full"
              >
                注册成为调查员
              </button>
              <button
                onClick={() => switchMode('reset')}
                className="text-slate-500 hover:text-amber-400 text-xs transition-colors block w-full"
              >
                忘记密码？
              </button>
            </>
          )}
          {mode === 'register' && (
            <button
              onClick={() => switchMode('login')}
              className="text-slate-400 hover:text-cyan-400 text-sm transition-colors"
            >
              已经注册？返回登录
            </button>
          )}
          {mode === 'reset' && (
            <button
              onClick={() => switchMode('login')}
              className="text-slate-400 hover:text-cyan-400 text-sm transition-colors"
            >
              ← 返回登录
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
