"use client";
import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import ImportView from './ImportView';
import { CharacterState } from '../../(single)/page';
import { supabase } from '../../lib/supabase';

/**
 * CharacterManager 包装 ImportView，将角色数据持久化到 Supabase。
 * - onConfirm（新建角色）→ INSERT
 * - setCharacters（编辑/删除）→ 自动 diff 前后数组，UPDATE/DELETE 对应记录
 * 用 rowIdMap 维护 character.id → 数据库行 ID 的映射。
 */
export default function CharacterManager({ userId }: { userId: string }) {
  const [characters, setCharacters] = useState<CharacterState[]>([]);
  const [loaded, setLoaded] = useState(false);
  const rowIdMap = useRef<Map<string, number>>(new Map());

  // 加载数据
  useEffect(() => {
    supabase
      .from('characters')
      .select('id, data')
      .eq('owner_id', userId)
      .then(({ data, error }) => {
        if (error) {
          toast.error('加载角色数据失败');
          setLoaded(true);
          return;
        }
        if (data) {
          const list: CharacterState[] = [];
          data.forEach((row: any) => {
            const char = row.data as CharacterState;
            list.push(char);
            rowIdMap.current.set(char.id, row.id);
          });
          setCharacters(list);
        }
        setLoaded(true);
      });
  }, [userId]);

  // 新建角色 → INSERT
  const handleAddCharacter = useCallback(async (newChar: CharacterState) => {
    setCharacters(prev => [...prev, newChar]);
    try {
      const { data, error } = await supabase
        .from('characters')
        .insert({ owner_id: userId, data: newChar })
        .select('id')
        .single();

      if (error) {
        toast.error('保存到服务器失败');
      } else if (data) {
        rowIdMap.current.set(newChar.id, data.id);
      }
    } catch {
      toast.error('网络错误，角色仅保存在本地');
    }
  }, [userId]);

  // 包装 setCharacters：diff 前后数组，同步增删改到 DB
  const wrappedSetCharacters: React.Dispatch<React.SetStateAction<CharacterState[]>> = useCallback(
    (updater) => {
      setCharacters(prev => {
        const next = typeof updater === 'function' ? updater(prev) : updater;

        // 检测删除
        prev.forEach(p => {
          if (!next.find(n => n.id === p.id)) {
            const rowId = rowIdMap.current.get(p.id);
            if (rowId) {
              supabase.from('characters').delete().eq('id', rowId)
                .then(() => rowIdMap.current.delete(p.id));
            }
          }
        });

        // 检测更新
        next.forEach(n => {
          const old = prev.find(p => p.id === n.id);
          if (old && JSON.stringify(old) !== JSON.stringify(n)) {
            const rowId = rowIdMap.current.get(n.id);
            if (rowId) {
              supabase.from('characters').update({ data: n, updated_at: new Date().toISOString() })
                .eq('id', rowId).then();
            }
          }
        });

        return next;
      });
    },
    []
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
