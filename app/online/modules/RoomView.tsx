"use client";

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useRoom } from './RoomContext';
import { useConfirmDialog } from './ConfirmDialog';
import { supabase } from '../../lib/supabase';
import type { CharacterState } from '../../(single)/page';

interface RoomViewProps {
  userId: string;
  displayName: string;
  avatarUrl: string;
  onBackToLobby: () => void;
}

export default function RoomView({ userId, displayName, avatarUrl, onBackToLobby }: RoomViewProps) {
  const { currentRoom, loading, pauseRoom, deleteRoom, leaveRoom, detachFromRoom, loadRoom, broadcastMemberRemoved } = useRoom();
  const { showConfirm, Dialog } = useConfirmDialog();
  const [allCharacters, setAllCharacters] = useState<Record<string, CharacterState>>({});
  const [myCharacterId, setMyCharacterId] = useState<string | null>(null);
  const [manageMembersModal, setManageMembersModal] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  // 调试日志
  useEffect(() => {
    if (currentRoom) {
      console.log('RoomView - currentRoom:', {
        id: currentRoom.id,
        name: currentRoom.name,
        status: currentRoom.status,
        membersCount: currentRoom.members.length,
        members: currentRoom.members.map(m => ({
          id: m.id,
          user_id: m.user_id,
          status: m.status,
          role: m.role,
          character_id: m.character_id,
          profile: m.profile
        }))
      });
    }
  }, [currentRoom]);

  const isCreator = currentRoom?.creator_id === userId;
  const myMembership = currentRoom?.members.find(m => m.user_id === userId);
  const myRole = isCreator ? 'kp' : (myMembership?.role || 'pl');

  // 加载所有成员的角色数据
  useEffect(() => {
    if (!currentRoom) return;

    // 先清空旧的角色数据，避免显示过时的信息
    setAllCharacters({});

    const memberCharacterIds = currentRoom.members
      .filter(m => m.character_id && m.character_id !== '')
      .map(m => m.character_id);

    console.log('RoomView - loading characters:', memberCharacterIds);
    console.log('RoomView - currentRoom members:', currentRoom.members.map(m => ({
      id: m.id,
      user_id: m.user_id,
      role: m.role,
      character_id: m.character_id,
      character_id_type: typeof m.character_id,
      character_id_length: m.character_id?.length
    })));

    if (memberCharacterIds.length === 0) {
      setAllCharacters({});
      return;
    }

    // 尝试两种查询方式
    supabase
      .from('characters')
      .select('id, data')
      .in('data->>id', memberCharacterIds)  // 直接用 data->>id 查询，因为 character_id 就是 data.id
      .then(({ data, error }) => {
        console.log('RoomView - characters result:', { data, error, count: data?.length });
        if (error) {
          console.error('RoomView - characters error:', error);
          setAllCharacters({});
          return;
        }
        if (data && data.length > 0) {
          const charMap: Record<string, CharacterState> = {};
          data.forEach(row => {
            console.log('RoomView - row:', { rowId: row.id, dataId: row.data?.id });
            if (row.data) {
              const charData = row.data as CharacterState;
              // 用 data.id（角色自定义 ID）作为 key
              if (charData.id) {
                charMap[charData.id] = charData;
              }
              // 也用数据库 id 作为 key
              charMap[String(row.id)] = charData;
            }
          });
          console.log('RoomView - charMap:', charMap);
          setAllCharacters(charMap);
        } else {
          console.warn('RoomView - no characters found for memberCharacterIds:', memberCharacterIds);
          setAllCharacters({});
        }
      });
  }, [currentRoom]);

  useEffect(() => {
    if (myMembership?.character_id && myMembership.character_id !== '') {
      setMyCharacterId(myMembership.character_id);
    }
  }, [myMembership]);

  // 监听被踢出房间的事件
  useEffect(() => {
    const handleMemberRemoved = (event: Event) => {
      if (isCreator) {
        return;
      }
      const detail = (event as CustomEvent).detail as { removedUserIds?: string[] } | undefined;
      const removedUserIds = detail?.removedUserIds || [];
      
      // 如果是 'all' 或者当前用户在被移除列表中，则显示弹窗
      const isRemoved = removedUserIds.includes('all') || removedUserIds.includes(userId);
      if (!isRemoved) {
        return;
      }
      
      showConfirm({
        title: '你已被移除',
        message: '你已被 KP 移出房间，无法再参与此跑团。\n\n是否返回首页？',
        confirmText: '返回主页',
        cancelText: '',
        onConfirm: () => {
          onBackToLobby();
        },
        onCancel: () => {
          onBackToLobby();
        },
      });
    };
    window.addEventListener('member-removed', handleMemberRemoved);
    return () => {
      window.removeEventListener('member-removed', handleMemberRemoved);
    };
  }, [showConfirm, onBackToLobby, isCreator, userId]);

  // 监听房间暂停事件（KP 暂停房间，PL 弹窗并可暂离）
  useEffect(() => {
    const handleRoomPaused = () => {
      if (isCreator) {
        return;
      }

      const doDetach = async () => {
        try {
          // 数据库此时已将 PL 标记为 detached，此处确保本地状态同步并返回主页
          await detachFromRoom();
        } catch (err) {
          console.error('[RoomView] 暂离失败:', err);
        } finally {
          onBackToLobby();
        }
      };

      showConfirm({
        title: '房间已暂停',
        message: 'KP 已暂停本次跑团。\n\n点击「暂离」返回主页，房间恢复后可使用原角色重新加入。',
        confirmText: '暂离',
        cancelText: '',
        confirmColor: '#f59e0b',
        onConfirm: doDetach,
        onCancel: doDetach,
      });
    };
    window.addEventListener('room-paused', handleRoomPaused);
    return () => {
      window.removeEventListener('room-paused', handleRoomPaused);
    };
  }, [showConfirm, onBackToLobby, isCreator, detachFromRoom]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-cyan-400 animate-pulse text-sm tracking-widest">加载房间中...</div>
      </div>
    );
  }

  if (!currentRoom) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="text-6xl mb-4">📭</div>
        <h2 className="text-xl font-bold text-slate-400 mb-2">房间不存在</h2>
        <button
          onClick={onBackToLobby}
          className="mt-4 px-6 py-2 bg-slate-700 hover:bg-slate-600 rounded-xl text-slate-300"
        >
          返回大厅
        </button>
      </div>
    );
  }

  const handlePauseRoom = () => {
    showConfirm({
      title: '暂停房间',
      message: '暂停后所有成员将暂离房间，跑团暂时中止。\n\n当你重新进入房间时暂停将自动解除，成员可使用原角色重新加入。',
      confirmText: '暂停房间',
      confirmColor: '#f59e0b',
      onConfirm: async () => {
        try {
          await pauseRoom();
          toast.success('房间已暂停');
          onBackToLobby();
        } catch (err: any) {
          toast.error(err.message || '操作失败');
        }
      },
    });
  };

  const handleDeleteRoom = () => {
    showConfirm({
      title: '删除房间',
      message: '⚠️ 警告：此操作不可恢复！\n\n删除后：\n• 所有成员将被移出\n• 房间内所有信息将被清空\n• 无法再次加入\n\n你确定要删除此房间吗？',
      confirmText: '永久删除',
      onConfirm: async () => {
        try {
          await deleteRoom();
          toast.success('房间已删除');
          onBackToLobby();
        } catch (err: any) {
          toast.error(err.message || '操作失败');
        }
      },
    });
  };

  const handleLeaveRoom = () => {
    if (isCreator) {
      // KP 点击管理成员
      setManageMembersModal(true);
      return;
    }
    // PL 点击退出房间
    showConfirm({
      title: '退出房间',
      message: '退出后将不再参与此房间的跑团。\n\n你确定要退出吗？',
      confirmText: '退出房间',
      onConfirm: async () => {
        try {
          console.log('[RoomView] PL 主动退出房间');
          await leaveRoom(false);
          console.log('[RoomView] 退出完成，返回首页');
          toast.success('已退出房间');
          onBackToLobby();
        } catch (err: any) {
          console.error('[RoomView] 退出失败:', err);
          toast.error(err.message || '操作失败');
        }
      },
    });
  };

  const toggleMemberSelection = (userId: string) => {
    setSelectedMembers(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const handleRemoveSelectedMembers = async () => {
    if (selectedMembers.length === 0) {
      toast('请先选择要移除的成员');
      return;
    }
    showConfirm({
      title: '移除成员',
      message: `确定要移除选中的 ${selectedMembers.length} 名成员吗？`,
      confirmText: '移除',
      confirmColor: '#dc2626',
      onConfirm: async () => {
        try {
          console.log('[handleRemoveSelectedMembers] 开始移除:', { selectedMembers, roomId: currentRoom.id });

          // 1. 先更新数据库：设置 status 为 removed（历史记录不再显示），清空 character_id
          const { data, error } = await supabase
            .from('room_members')
            .update({ 
              status: 'removed', 
              character_id: null, 
              left_at: new Date().toISOString() 
            })
            .in('user_id', selectedMembers)
            .eq('room_id', currentRoom.id)
            .select();

          console.log('[handleRemoveSelectedMembers] 数据库更新结果:', { affected: data?.length, error });

          if (error) throw error;

          // 2. 广播通知被移除的 PL（在数据库更新之后，确保 PL 能收到并显示弹窗）
          await broadcastMemberRemoved(currentRoom.id, selectedMembers);
          console.log('[handleRemoveSelectedMembers] 广播已发送:', selectedMembers);

          toast.success(`已移除 ${selectedMembers.length} 名成员`);
          setSelectedMembers([]);
          
          // 3. 刷新 KP 端成员列表
          await loadRoom(currentRoom.id);
        } catch (err: any) {
          console.error('[handleRemoveSelectedMembers] 错误:', err);
          toast.error(err.message || '操作失败');
        }
      },
    });
  };

  const handleDetachRoom = () => {
    showConfirm({
      title: '暂离房间',
      message: '暂离后，你将暂时离开房间，但保留会话信息。\n\n下次进入同一房间时，无需重新选择角色卡。',
      confirmText: '暂离房间',
      confirmColor: '#6b7280',
      onConfirm: async () => {
        try {
          await detachFromRoom();
          toast.success('已暂离房间');
          onBackToLobby();
        } catch (err: any) {
          toast.error(err.message || '操作失败');
        }
      },
    });
  };

  const paused = currentRoom.status === 'paused';
  
  // 活跃成员（PL，排除 KP）
  const activeMembers = currentRoom.members.filter(m => m.status === 'active' && m.role !== 'kp');
  const detachedMembers = currentRoom.members.filter(m => m.status === 'detached');

  // 管理成员弹窗中可操作的成员：在房与暂离的 PL（排除 KP 自己）
  const manageableMembers = currentRoom.members.filter(
    m => (m.status === 'active' || m.status === 'detached')
      && m.user_id !== currentRoom.creator_id
      && m.role !== 'kp'
  );
  
  // 构造 KP 成员对象
  const kpMember = {
    id: `kp-${currentRoom.creator_id}`,
    user_id: currentRoom.creator_id,
    role: 'kp' as const,
    status: 'active' as const,
    character_id: null as string | null,
    profile: currentRoom.creator || undefined,
  };
  
  // 排序：KP 在前，其他活跃成员在后
  const sortedActiveMembers = [
    kpMember,
    ...activeMembers,
  ];

  return (
    <div className="min-h-screen bg-slate-900 text-white flex">
      {/* 左侧侧边栏 - 成员列表 */}
      <aside className="w-80 bg-slate-800 border-r border-slate-700 flex flex-col">
        <div className="p-4 border-b border-slate-700">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <span>👥</span> 房间成员
            <span className="text-sm font-normal text-slate-500">({sortedActiveMembers.length})</span>
          </h3>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {/* 活跃成员 */}
          {sortedActiveMembers.map(member => {
            if (!member) return null;
            const isKP = member.user_id === currentRoom.creator_id;
            const isMe = member.user_id === userId;
            
            // 尝试多种 key 查找角色
            let character: CharacterState | null = null;
            
            if (member.character_id) {
              // 1. 直接用 character_id 查找
              character = allCharacters[member.character_id] || null;
              console.log('RoomView - direct lookup:', {
                key: member.character_id,
                found: !!character,
                allKeys: Object.keys(allCharacters)
              });
              
              // 2. 如果没找到，遍历所有 available characters 查找匹配
              if (!character) {
                for (const key in allCharacters) {
                  if (allCharacters[key]) {
                    const char = allCharacters[key];
                    // 尝试用 data.id 匹配
                    if (char.id === member.character_id) {
                      character = char;
                      break;
                    }
                  }
                }
              }
            }
            
            console.log('RoomView - rendering member:', {
              user_id: member.user_id,
              isKP,
              character_id: member.character_id,
              character_found: !!character,
              character_name: character?.name
            });
            
            return (
              <div
                key={member.id}
                className={`rounded-xl ${
                  isKP 
                    ? 'bg-purple-900/30 border border-purple-800/50' 
                    : 'bg-slate-700/50'
                }`}
              >
                {/* 上方面板：头像和用户名 */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold overflow-hidden flex-shrink-0 ${
                    isKP ? 'bg-purple-600' : 'bg-cyan-700'
                  }`}>
                    {member.profile?.avatar_url ? (
                      <img src={member.profile.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span>{(member.profile?.display_name || '?')[0]}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white text-sm truncate">
                        {member.profile?.display_name || '未知'}
                      </span>
                      {isMe && <span className="text-xs text-cyan-400">(我)</span>}
                      {isKP ? (
                        <span className="px-1.5 py-0.5 bg-purple-600 rounded text-xs font-bold text-white">KP</span>
                      ) : (
                        <span className="px-1.5 py-0.5 bg-cyan-600 rounded text-xs font-bold text-white">PL</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 下方角色卡片 */}
                {!isKP && character && (
                  <div className="px-4 pb-3 pl-16">
                    <div className="flex items-center gap-2 mt-2">
                      <div className="w-8 h-8 rounded-lg bg-cyan-600 flex items-center justify-center text-sm font-bold overflow-hidden">
                        {character.avatar ? (
                          <img src={character.avatar} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span>{character.name[0]}</span>
                        )}
                      </div>
                      <span className="text-xs font-medium text-cyan-300 truncate max-w-32">
                        {character.name}
                      </span>
                    </div>
                  </div>
                )}


              </div>
            );
          })}

          {/* 暂离成员 */}
          {detachedMembers.map(member => {
            const character = member.character_id ? allCharacters[member.character_id] : null;
            return (
              <div
                key={member.id}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/50 opacity-60"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-slate-600 flex items-center justify-center text-lg font-bold overflow-hidden">
                    {member.profile?.avatar_url ? (
                      <img src={member.profile.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span>{(member.profile?.display_name || '?')[0]}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="font-bold text-slate-400 text-sm truncate">
                        {member.profile?.display_name || '未知'}
                      </span>
                      <span className="px-1.5 py-0.5 bg-slate-600 rounded text-xs font-bold text-slate-300">暂离</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {character && (
                    <div className="w-8 h-8 rounded-lg bg-slate-700 flex items-center justify-center text-sm overflow-hidden">
                      {character.avatar ? (
                        <img src={character.avatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-slate-400">{character.name[0]}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {activeMembers.length === 0 && detachedMembers.length === 0 && sortedActiveMembers.length <= 1 && (
            <p className="text-slate-500 text-sm text-center py-4">
              暂无成员加入
            </p>
          )}
        </div>
      </aside>

      {/* 右侧主内容区域 */}
      <div className="flex-1 flex flex-col">
        {/* 顶部导航 */}
        <header className="flex justify-between items-center px-6 py-4 border-b border-slate-800 bg-slate-900">
          <div className="flex items-center gap-2">
            <span className="text-xl">🎭</span>
            <span className="font-bold text-lg">{currentRoom.name}</span>
            {paused && (
              <span className="px-2 py-0.5 bg-amber-600 text-xs rounded-full">已暂停</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="px-3 py-1 bg-slate-800 rounded-lg border border-slate-700">
              <span className="text-xs text-slate-500 mr-2">房间号</span>
              <span className="text-sm font-bold text-cyan-400">{currentRoom.room_code}</span>
            </div>
            {/* KP 进入暂停房间时会自动恢复，因此正常渲染操作按钮 */}
            <div className="flex items-center gap-2">
              {myRole === 'pl' && (
                <button
                  onClick={handleDetachRoom}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition"
                >
                  暂离
                </button>
              )}
              {isCreator && (
                <button
                  onClick={handlePauseRoom}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm font-bold transition"
                >
                  暂停房间
                </button>
              )}
              {isCreator && (
                <button
                  onClick={handleDeleteRoom}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-bold transition"
                >
                  删除房间
                </button>
              )}
              <button
                onClick={handleLeaveRoom}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold transition ${
                  isCreator
                    ? 'bg-slate-700 hover:bg-slate-600'
                    : 'bg-red-600/50 hover:bg-red-600 text-red-300'
                }`}
              >
                {isCreator ? '管理成员' : '退出房间'}
              </button>
            </div>
          </div>
        </header>

        {/* 主内容 */}
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto space-y-6">
          </div>
        </main>
      </div>

      {Dialog}

      {/* 管理成员弹窗 */}
      {manageMembersModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[55] p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col">
            {/* 标题栏 */}
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <h2 className="text-lg font-bold text-white">管理成员</h2>
              <button
                onClick={() => { setManageMembersModal(false); setSelectedMembers([]); }}
                className="text-slate-400 hover:text-white text-xl"
              >
                ×
              </button>
            </div>

            {/* 成员列表（在房 + 暂离的 PL 均可被移除） */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {manageableMembers.length === 0 && (
                <p className="text-center text-slate-500 text-sm py-6">暂无可管理的成员</p>
              )}
              {manageableMembers.map(member => {
                if (!member || member.user_id === userId) return null;
                const isKP = member.user_id === currentRoom.creator_id;
                const isSelected = selectedMembers.includes(member.user_id);
                const isDetached = member.status === 'detached';
                return (
                  <div
                    key={member.id}
                    onClick={() => toggleMemberSelection(member.user_id)}
                    className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition ${
                      isSelected ? 'bg-cyan-900/30 border border-cyan-600' : 'bg-slate-800 hover:bg-slate-700'
                    }`}
                  >
                    <div className="w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0">
                      {isSelected && <span className="text-cyan-400 text-xs">✓</span>}
                    </div>
                    <div className="w-8 h-8 rounded-full bg-cyan-700 flex items-center justify-center text-sm font-bold overflow-hidden flex-shrink-0">
                      {member.profile?.avatar_url ? (
                        <img src={member.profile.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span>{(member.profile?.display_name || '?')[0]}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm truncate">{member.profile?.display_name || '未知'}</span>
                        {isKP ? (
                          <span className="px-1.5 py-0.5 bg-purple-600 rounded text-xs font-bold text-white">KP</span>
                        ) : (
                          <>
                            <span className="px-1.5 py-0.5 bg-cyan-600 rounded text-xs font-bold text-white">PL</span>
                            {isDetached ? (
                              <span className="px-1.5 py-0.5 bg-slate-600 rounded text-xs font-bold text-slate-200">暂离</span>
                            ) : (
                              <span className="px-1.5 py-0.5 bg-emerald-700 rounded text-xs font-bold text-white">在房</span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 底部按钮 */}
            <div className="p-4 border-t border-slate-800 flex items-center justify-between gap-3">
              <span className="text-sm text-slate-400">
                已选择: <span className="text-cyan-400 font-bold">{selectedMembers.length}</span> 人
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => { setManageMembersModal(false); setSelectedMembers([]); }}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition"
                >
                  取消
                </button>
                <button
                  onClick={handleRemoveSelectedMembers}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-bold transition"
                >
                  移除选中
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
