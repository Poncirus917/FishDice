// server/models/Character.ts
import mongoose from 'mongoose';

const CharacterSchema = new mongoose.Schema({
  owner: { type: String, required: true }, // 用户邮箱
  id: { type: String, required: true }, // 角色的本地 ID
  name: { type: String, required: true },
  type: { type: String, required: true, enum: ['pc', 'npc', 'mob'] },
  avatar: { type: String, default: '' },
  plName: { type: String, default: '' },
  hp: { current: { type: Number, default: 0 }, max: { type: Number, default: 0 } },
  mp: { current: { type: Number, default: 0 }, max: { type: Number, default: 0 } },
  san: { current: { type: Number, default: 0 }, max: { type: Number, default: 0 } },
  luck: { current: { type: Number, default: 0 }, max: { type: Number, default: 0 } },
  skills: { type: mongoose.Schema.Types.Mixed, default: {} },
  attributes: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now }
});

// 按 owner + id 建复合索引，确保同一用户下角色 ID 不重复
CharacterSchema.index({ owner: 1, id: 1 }, { unique: true });

export default mongoose.models.Character || mongoose.model('Character', CharacterSchema);
