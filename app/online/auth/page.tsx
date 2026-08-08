"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

type Mode = 'login' | 'register' | 'verify' | 'reset' | 'reset-confirm';

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [emailExists, setEmailExists] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const router = useRouter();

  // 倒计时
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  // 注册模式下：检测邮箱是否已注册
  const checkEmailExists = async (targetEmail?: string) => {
    if (mode !== 'register') return;
    const emailToCheck = (targetEmail ?? email).trim().toLowerCase();
    if (!emailToCheck || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailToCheck)) return;
    setCheckingEmail(true);
    try {
      const { count, error } = await supabase
        .from('profiles')
        .select('email', { count: 'exact', head: true })
        .eq('email', emailToCheck);
      if (!error) {
        setEmailExists((count ?? 0) > 0);
      }
    } finally {
      setCheckingEmail(false);
    }
  };

  // 邮箱变更时：防抖 500ms 自动检测（不输完也会检测）
  useEffect(() => {
    setEmailExists(false);
    if (mode !== 'register') return;
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return;
    const timer = setTimeout(() => checkEmailExists(trimmed), 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, mode]);

  // 登录
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message === 'Invalid login credentials' ? '邮箱或密码错误' : error.message);
      return;
    }
    toast.success('欢迎回来，调查员！');
    router.push('/online');
  };

  // 注册 → 发送验证码
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (emailExists) {
      toast.error('该邮箱已注册，请返回登录');
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (data.user && (!data.user.identities || data.user.identities.length === 0)) {
      setEmailExists(true);
      toast.error('该邮箱已注册，请返回登录');
      return;
    }
    if (data.session) {
      toast.success('注册成功！');
      router.push('/online');
    } else {
      toast.success('验证码已发送至邮箱');
      setMode('verify');
      setCountdown(60);
    }
  };

  // 验证码验证
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: 'signup',
    });
    setLoading(false);
    if (error) {
      toast.error(error.message === 'Token has expired or is invalid' ? '验证码错误或已过期' : error.message);
      return;
    }
    toast.success('邮箱验证成功，请登录');
    setMode('login');
    setCode('');
    setPassword('');
  };

  // 重新发送注册验证码
  const handleResendCode = async () => {
    if (countdown > 0) return;
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('验证码已重新发送');
    setCountdown(60);
  };

  // 发送密码重置验证码
  const handleSendReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('验证码已发送至邮箱');
    setMode('reset-confirm');
    setCountdown(60);
  };

  // 验证码 + 新密码重置
  const handleResetConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error('两次输入的密码不一致');
      return;
    }
    setLoading(true);
    // 先验证 OTP
    const { error: otpError } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: 'recovery',
    });
    if (otpError) {
      setLoading(false);
      toast.error(otpError.message === 'Token has expired or is invalid' ? '验证码错误或已过期' : otpError.message);
      return;
    }
    // 再更新密码
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);
    if (updateError) {
      toast.error(updateError.message);
      return;
    }
    toast.success('密码重置成功，请登录');
    setMode('login');
    setCode('');
    setNewPassword('');
    setConfirmPassword('');
  };

  // 重新发送重置验证码
  const handleResendReset = async () => {
    if (countdown > 0) return;
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('验证码已重新发送');
    setCountdown(60);
  };

  const handleSubmit = (e: React.FormEvent) => {
    switch (mode) {
      case 'login': return handleLogin(e);
      case 'register': return handleRegister(e);
      case 'verify': return handleVerify(e);
      case 'reset': return handleSendReset(e);
      case 'reset-confirm': return handleResetConfirm(e);
    }
  };

  const switchMode = (newMode: Mode) => {
    setMode(newMode);
    setShowPassword(false);
    setCode('');
  };

  const titleText = {
    'login': '调查员登录',
    'register': '调查员注册',
    'verify': '验证邮箱',
    'reset': '找回密码',
    'reset-confirm': '重置密码',
  }[mode];

  const submitText = {
    'login': loading ? '登录中...' : '立即进入',
    'register': loading ? '注册中...' : '完成注册',
    'verify': loading ? '验证中...' : '验证',
    'reset': loading ? '发送中...' : '发送验证码',
    'reset-confirm': loading ? '重置中...' : '重置密码',
  }[mode];

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white p-4">
      <div className="w-full max-w-md p-8 bg-slate-800 rounded-2xl shadow-2xl border border-slate-700">
        <h1 className="text-3xl font-bold mb-6 text-center text-cyan-400 font-serif">
          {titleText}
        </h1>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* 邮箱 */}
          {(mode === 'login' || mode === 'register' || mode === 'reset') && (
            <div>
              <label className="block text-sm font-medium mb-1.5 text-slate-300">电子邮箱</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => checkEmailExists()}
                className={`w-full p-3 rounded-xl bg-slate-900 border transition-all outline-none focus:ring-1 ${
                  emailExists
                    ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                    : 'border-slate-700 focus:border-cyan-500 focus:ring-cyan-500'
                }`}
                placeholder="your@email.com"
                required
              />
              {mode === 'register' && checkingEmail && (
                <p className="mt-1.5 text-xs text-slate-500">正在检查邮箱...</p>
              )}
              {mode === 'register' && emailExists && (
                <p className="mt-1.5 text-xs text-red-400">该邮箱已注册，请返回登录</p>
              )}
            </div>
          )}

          {/* 验证模式：显示邮箱（只读）+ 验证码 */}
          {(mode === 'verify' || mode === 'reset-confirm') && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1.5 text-slate-300">邮箱</label>
                <input
                  type="email"
                  value={email}
                  disabled
                  className="w-full p-3 rounded-xl bg-slate-900/50 border border-slate-700 text-slate-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5 text-slate-300">验证码</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    maxLength={8}
                    className="flex-1 p-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-cyan-500 outline-none transition-all text-center text-lg tracking-[0.5em]"
                    placeholder="验证码"
                    required
                  />
                  <button
                    type="button"
                    disabled={countdown > 0}
                    onClick={mode === 'verify' ? handleResendCode : handleResendReset}
                    className={`px-4 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
                      countdown > 0
                        ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                        : 'bg-slate-700 hover:bg-slate-600 text-cyan-400 border border-slate-600'
                    }`}
                  >
                    {countdown > 0 ? `${countdown}s` : '重新发送'}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* 用户名 - 仅注册 */}
          {mode === 'register' && (
            <div>
              <label className="block text-sm font-medium mb-1.5 text-slate-300">用户名</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full p-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none transition-all"
                placeholder="录入调查员姓名"
                maxLength={20}
                required
              />
            </div>
          )}

          {/* 密码 - 登录和注册 */}
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
                <span className="text-xs">{showPassword ? '隐藏' : '显示'}</span>
              </button>
            </div>
          )}

          {/* 新密码 - 重置确认 */}
          {mode === 'reset-confirm' && (
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
                  <span className="text-xs">{showPassword ? '隐藏' : '显示'}</span>
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

          {/* 重置密码提示 */}
          {mode === 'reset' && (
            <div className="text-sm text-slate-400 bg-slate-900/50 rounded-xl p-4 border border-slate-700">
              输入注册邮箱，系统将发送验证码至你的邮箱。
            </div>
          )}

          <button
            type="submit"
            disabled={loading || (mode === 'register' && emailExists) || checkingEmail}
            className="w-full py-3.5 mt-2 bg-cyan-600 hover:bg-cyan-500 active:scale-[0.98] disabled:opacity-50 rounded-xl font-bold transition-all shadow-lg shadow-cyan-900/30"
          >
            {submitText}
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
          {mode === 'verify' && (
            <button
              onClick={() => switchMode('login')}
              className="text-slate-400 hover:text-cyan-400 text-sm transition-colors"
            >
              ← 返回登录
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
          {mode === 'reset-confirm' && (
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
