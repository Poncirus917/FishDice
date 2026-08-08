"use client";
import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import ImportView from './ImportView';
import { CharacterState } from '../../(single)/page';
import { API_BASE } from '../../lib/apiConfig';

const API = `${API_BASE}/api/characters`;

/**
 * CharacterManager 包装 ImportView，将角色数据持久化到数据库（绑定用户邮箱）。
 * - onConfirm（新建角色）→ POST 到 API
 * - setCharacters（编辑/删除）→ 自动 diff 前后数组，PUT/DELETE 对应记录
 */
export default function CharacterManager({ email }: { email: string }) {
  const [characters, setCharacters] = useState<CharacterState[]>([]);
  const [loaded, setLoaded] = useState(false);

  // 加载数据
  useEffect(() => {
    fetch(`${API}?owner=${encodeURIComponent(email)}`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          // 去掉 MongoDB 的 _id 和 __v 字段，只保留 CharacterState 需要的字段
          const cleaned = data.map((c: any) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            avatar: c.avatar || undefined,
            plName: c.plName,
            hp: c.hp,
            mp: c.mp,
            san: c.san,
            luck: c.luck,
            skills: c.skills || {},
            attributes: c.attributes || {},
            status: c.status || [],
          }));
          setCharacters(cleaned);
        }
        setLoaded(true);
      })
      .catch(() => {
        toast.error('加载角色数据失败');
        setLoaded(true);
      });
  }, [email]);

  // 新建角色 → POST
  const handleAddCharacter = useCallback(async (newChar: CharacterState) => {
    // 先添加到本地状态，保证 UI 响应
    setCharacters(prev => [...prev, newChar]);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newChar, owner: email }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.message || '保存到服务器失败');
      }
    } catch {
      toast.error('网络错误，角色仅保存在本地');
    }
  }, [email]);

  // 包装 setCharacters：diff 前后数组，同步增删改到 DB
  const wrappedSetCharacters: React.Dispatch<React.SetStateAction<CharacterState[]>> = useCallback(
    (updater) => {
      setCharacters(prev => {
        const next = typeof updater === 'function' ? updater(prev) : updater;

        // 检测删除
        prev.forEach(p => {
          if (!next.find(n => n.id === p.id)) {
            fetch(`${API}/${p.id}?owner=${encodeURIComponent(email)}`, { method: 'DELETE' })
              .catch(() => {});
          }
        });

        // 检测更新
        next.forEach(n => {
          const old = prev.find(p => p.id === n.id);
          if (old && JSON.stringify(old) !== JSON.stringify(n)) {
            fetch(`${API}/${n.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...n, owner: email }),
            }).catch(() => {});
          }
        });

        return next;
      });
    },
    [email]
  );

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-cyan-400 animate-pulse text-sm tracking-widest">LOADING...</div>
      </div>
    );
  }

  return (
    <ImportView
      onConfirm={handleAddCharacter}
      characters={characters}
      setCharacters={wrappedSetCharacters}
    />
  );
}
