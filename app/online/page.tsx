"use client";
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import Sidebar from '../components/Sidebar';
import ImportView from './modules/ImportView';
import ConsoleView from './modules/ConsoleView';
import CharacterManager from './modules/CharacterManager';
import { CharacterState } from '../(single)/page';

export default function OnlinePage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  // 房间状态
  const [view, setView] = useState<'lobby' | 'room' | 'characters'>('lobby');
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [isKP, setIsKP] = useState(false);

  // 内容状态（与单机版一致）
  const [activeTab, setActiveTab] = useState<'import' | 'console'>('import');
  const [characters, setCharacters] = useState<CharacterState[]>([]);

  // 个人信息
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [showProfile, setShowProfile] = useState(false);
  const [editName, setEditName] = useState('');
  const [editAvatarFile, setEditAvatarFile] = useState<File | null>(null);
  const [editAvatarPreview, setEditAvatarPreview] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 登录检查 + 加载个人信息
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        router.push('/online/auth');
        return;
      }
      const uid = session.user.id;
      setUserId(uid);

      // 拉取 profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, avatar_url')
        .eq('id', uid)
        .single();

      if (profile) {
        setDisplayName(profile.display_name || session.user.email || '调查员');
        setAvatarUrl(profile.avatar_url || '');
      } else {
        setDisplayName(session.user.email || '调查员');
      }
      setChecking(false);
    });
  }, [router]);

  // 创建房间
  const handleCreateRoom = () => {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    setRoomCode(code);
    setIsKP(true);
    setView('room');
    toast.success(`房间已创建！房间号：${code}`);
  };

  // 加入房间
  const handleJoinRoom = () => {
    if (joinCode.length !== 4) {
      toast.error("请输入4位房间号");
      return;
    }
    setRoomCode(joinCode);
    setIsKP(false);
    setView('room');
    toast.success(`已加入房间：${joinCode}`);
  };

  // 离开房间
  const handleLeaveRoom = () => {
    setView('lobby');
    setRoomCode('');
    setJoinCode('');
    setCharacters([]);
    setActiveTab('import');
  };

  // 退出登录
  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/online/auth');
  };

  const handleAddCharacter = (newChar: CharacterState) => {
    setCharacters(prev => [...prev, newChar]);
  };

  // 打开个人信息弹窗
  const handleOpenProfile = () => {
    setEditName(displayName);
    setEditAvatarPreview(avatarUrl);
    setEditAvatarFile(null);
    setShowProfile(true);
  };

  // 头像上传处理（本地预览）
  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("头像图片不能超过2MB");
      return;
    }
    setEditAvatarFile(file);
    const reader = new FileReader();
    reader.onload = () => setEditAvatarPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  // 保存个人信息
  const handleSaveProfile = async () => {
    if (!editName.trim()) {
      toast.error("用户名不能为空");
      return;
    }
    if (!userId) return;
    setSavingProfile(true);
    try {
      // 更新用户名
      const { error: nameError } = await supabase
        .from('profiles')
        .update({ display_name: editName.trim() })
        .eq('id', userId);

      if (nameError) {
        if (nameError.message.includes('duplicate')) {
          toast.error("该用户名已被使用");
        } else {
          toast.error(nameError.message);
        }
        setSavingProfile(false);
        return;
      }

      // 如果选了新头像，上传到 Storage
      if (editAvatarFile) {
        const fileExt = editAvatarFile.name.split('.').pop() || 'jpg';
        const filePath = `${userId}/avatar.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(filePath, editAvatarFile, { upsert: true });

        if (uploadError) {
          toast.error("头像上传失败");
          setSavingProfile(false);
          return;
        }

        const { data: urlData } = supabase.storage
          .from('avatars')
          .getPublicUrl(filePath);

        await supabase
          .from('profiles')
          .update({ avatar_url: urlData.publicUrl })
          .eq('id', userId);

        setAvatarUrl(urlData.publicUrl);
      }

      setDisplayName(editName.trim());
      toast.success("个人信息已更新");
      setShowProfile(false);
    } catch {
      toast.error("更新失败");
    }
    setSavingProfile(false);
  };

  // 加载中
  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-cyan-400 animate-pulse text-sm tracking-widest">LOADING...</div>
      </div>
    );
  }

  // 用户名 + 头像按钮
  const UserBadge = ({ dark }: { dark?: boolean }) => (
    <button
      onClick={handleOpenProfile}
      className={`flex items-center gap-2 px-2 py-1 rounded-lg transition ${
        dark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'
      }`}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="头像" className="w-7 h-7 rounded-full object-cover" />
      ) : (
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
          dark ? 'bg-slate-700 text-cyan-400' : 'bg-slate-200 text-slate-500'
        }`}>
          {displayName?.[0] || '?'}
        </div>
      )}
      <span className={`text-sm ${dark ? 'text-slate-300' : 'text-slate-600'}`}>{displayName}</span>
    </button>
  );

  // ===================== 大厅视图 =====================
  if (view === 'lobby') {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col">
        <header className="flex justify-between items-center px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🐟</span>
            <span className="font-bold text-lg">鱼骰 <span className="text-cyan-400 text-xs font-normal">联机版</span></span>
          </div>
          <div className="flex items-center gap-4">
            <a href="/" className="text-xs text-slate-500 hover:text-cyan-400 transition">← 单机版</a>
            <UserBadge dark />
          </div>
        </header>

        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md space-y-6">
            <div className="text-center">
              <h1 className="text-3xl font-bold mb-2">调查员大厅</h1>
              <p className="text-slate-500 text-xl">调查员{displayName}已接入系统。</p>
              <p className="text-slate-500 text-xl">系统功能仍在开发中，敬请期待。</p>
            </div>

            {/* 角色管理 */}
            <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 hover:border-cyan-800 transition">
              <h2 className="font-bold mb-2 flex items-center gap-2">
                <span className="text-xl">📚</span> 角色管理
              </h2>
              <p className="text-slate-400 text-xs mb-4 leading-relaxed">创建和管理你的 PC、NPC 和怪物，数据跟随账号保存</p>
              <button
                onClick={() => setView('characters')}
                className="w-full py-3 bg-slate-700 hover:bg-cyan-600 rounded-xl font-bold transition active:scale-[0.98]"
              >
                进入角色管理
              </button>
            </div>

            {/* 创建房间 */}
            <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 hover:border-cyan-800 transition">
              <h2 className="font-bold mb-2 flex items-center gap-2">
                <span className="text-xl">🎭</span> 创建房间
              </h2>
              <p className="text-slate-400 text-xs mb-4 leading-relaxed">作为 KP 创建新房间，获得4位房间号分享给玩家</p>
              <button
                onClick={handleCreateRoom}
                className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 rounded-xl font-bold transition active:scale-[0.98] shadow-lg shadow-cyan-900/30"
              >
                创建新房间
              </button>
            </div>

            {/* 加入房间 */}
            <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 hover:border-cyan-800 transition">
              <h2 className="font-bold mb-2 flex items-center gap-2">
                <span className="text-xl">🚪</span> 加入房间
              </h2>
              <p className="text-slate-400 text-xs mb-4 leading-relaxed">输入 KP 分享的4位房间号</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={4}
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && handleJoinRoom()}
                  className="flex-1 p-3 text-center text-2xl font-bold tracking-[0.5em] bg-slate-900 border border-slate-700 rounded-xl outline-none focus:border-cyan-500 transition"
                  placeholder="0000"
                />
                <button
                  onClick={handleJoinRoom}
                  disabled={joinCode.length !== 4}
                  className="px-6 bg-slate-700 hover:bg-cyan-600 disabled:opacity-30 disabled:cursor-not-allowed rounded-xl font-bold transition"
                >
                  加入
                </button>
              </div>
            </div>
          </div>
        </div>

        {showProfile && (
          <ProfileModal
            editName={editName}
            setEditName={setEditName}
            editAvatarPreview={editAvatarPreview}
            handleAvatarChange={handleAvatarChange}
            fileInputRef={fileInputRef}
            handleSave={handleSaveProfile}
            handleClose={() => setShowProfile(false)}
            handleLogout={handleLogout}
            saving={savingProfile}
          />
        )}
      </div>
    );
  }

  // ===================== 角色管理视图 =====================
  if (view === 'characters') {
    return (
      <div className="min-h-screen bg-slate-50 text-black font-sans">
        <header className="flex justify-between items-center px-6 py-4 bg-white border-b border-slate-200 shadow-sm sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setView('lobby')}
              className="text-slate-400 hover:text-cyan-600 text-sm font-bold transition"
            >
              ← 返回大厅
            </button>
            <div className="h-4 w-px bg-slate-200" />
            <span className="font-bold text-lg">📚 角色管理</span>
          </div>
          <UserBadge />
        </header>

        <div className="max-w-6xl mx-auto p-4">
          <CharacterManager userId={userId!} />
        </div>

        {showProfile && (
          <ProfileModal
            editName={editName}
            setEditName={setEditName}
            editAvatarPreview={editAvatarPreview}
            handleAvatarChange={handleAvatarChange}
            fileInputRef={fileInputRef}
            handleSave={handleSaveProfile}
            handleClose={() => setShowProfile(false)}
            handleLogout={handleLogout}
            saving={savingProfile}
          />
        )}
      </div>
    );
  }

  // ===================== 房间视图 =====================
  return (
    <div className="flex h-screen w-full bg-slate-50 text-black font-sans overflow-hidden">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-slate-200 shadow-sm flex-shrink-0">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Room</span>
              <span className="text-lg font-black text-cyan-600 tracking-widest">{roomCode}</span>
            </div>
            <div className="h-4 w-px bg-slate-200" />
            <span className={`text-xs px-2 py-1 rounded-md font-bold ${isKP ? 'bg-slate-900 text-white' : 'bg-blue-100 text-blue-600'}`}>
              {isKP ? 'KP 守秘人' : 'PL 玩家'}
            </span>
            <span className="text-xs text-slate-300 hidden sm:block">在线: 1人</span>
          </div>

          <div className="flex items-center gap-3">
            <UserBadge />
            <button
              onClick={handleLeaveRoom}
              className="px-3 py-1.5 text-xs font-bold text-slate-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
            >
              离开房间
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="w-full h-full p-4">
            {activeTab === 'import' && (
              <div className="max-w-6xl mx-auto">
                <ImportView
                  onConfirm={handleAddCharacter}
                  characters={characters}
                  setCharacters={setCharacters}
                />
              </div>
            )}
            {activeTab === 'console' && (
              <ConsoleView characters={characters} setCharacters={setCharacters} />
            )}
          </div>
        </div>
      </main>

      {showProfile && (
        <ProfileModal
          editName={editName}
          setEditName={setEditName}
          editAvatarPreview={editAvatarPreview}
          handleAvatarChange={handleAvatarChange}
          fileInputRef={fileInputRef}
          handleSave={handleSaveProfile}
          handleClose={() => setShowProfile(false)}
          handleLogout={handleLogout}
          saving={savingProfile}
        />
      )}
    </div>
  );
}

// ===================== 个人信息弹窗组件 =====================
function ProfileModal({
  editName,
  setEditName,
  editAvatarPreview,
  handleAvatarChange,
  fileInputRef,
  handleSave,
  handleClose,
  handleLogout,
  saving,
}: {
  editName: string;
  setEditName: (v: string) => void;
  editAvatarPreview: string;
  handleAvatarChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleSave: () => void;
  handleClose: () => void;
  handleLogout: () => void;
  saving: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-sm bg-slate-800 rounded-2xl shadow-2xl border border-slate-700 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-center text-cyan-400 mb-6">个人信息</h2>

        {/* 头像 */}
        <div className="flex flex-col items-center mb-6">
          <div className="relative w-20 h-20 rounded-full overflow-hidden border-2 border-slate-600 group cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            {editAvatarPreview ? (
              <img src={editAvatarPreview} alt="头像" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-slate-700 text-2xl font-bold text-cyan-400">
                {editName?.[0] || '?'}
              </div>
            )}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
              <span className="text-white text-xs">更换</span>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarChange}
          />
          <p className="text-xs text-slate-500 mt-2">点击头像更换，最大2MB</p>
        </div>

        {/* 用户名 */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-1.5 text-slate-300">用户名</label>
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            maxLength={20}
            className="w-full p-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none transition-all text-white"
            placeholder="给自己取个名字"
          />
        </div>

        {/* 按钮区 */}
        <div className="space-y-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 active:scale-[0.98] rounded-xl font-bold transition shadow-lg shadow-cyan-900/30"
          >
            {saving ? '保存中...' : '保存修改'}
          </button>
          <button
            onClick={handleLogout}
            className="w-full py-2.5 text-red-400 hover:bg-red-500/10 rounded-xl text-sm font-medium transition"
          >
            退出登录
          </button>
          <button
            onClick={handleClose}
            className="w-full py-2 text-slate-400 hover:text-slate-200 text-sm transition"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
