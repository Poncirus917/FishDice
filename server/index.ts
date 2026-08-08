// server/index.ts
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
// 1. 加载环境变量
dotenv.config();
import User from './models/User';
import Character from './models/Character';
import { sendCode } from './utils/mailer'; // 确保你创建了这个文件

const app = express();
app.use(cors());
app.use(express.json());

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/fishdice";

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ DB error:', err));

// 临时存储验证码（内存存储，重启服务器会失效，后期可换成 Redis）
const codeCache = new Map<string, { code: string, expires: number }>();

// --- 1. 发送验证码接口 ---
app.post('/api/send-code', async (req: any, res: any) => {
  try {
    const { email, purpose } = req.body; // purpose: 'register' | 'reset'
    if (!email) return res.status(400).json({ message: '请输入邮箱' });

    const existingUser = await User.findOne({ username: email });

    if (purpose === 'reset') {
      // 找回密码：邮箱必须已注册
      if (!existingUser) {
        return res.status(400).json({ message: '该邮箱未注册' });
      }
    } else {
      // 注册：邮箱不能已存在
      if (existingUser) {
        return res.status(200).json({ message: '该邮箱已注册', registered: true });
      }
    }

    // 生成 6 位随机验证码
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // 存入缓存，5 分钟过期
    codeCache.set(email, { 
      code, 
      expires: Date.now() + 5 * 60 * 1000 
    });

    // 发送邮件
    await sendCode(email, code);
    
    console.log(`给 ${email} 发送了验证码: ${code} (purpose: ${purpose || 'register'})`);
    res.json({ message: '验证码已发送' });
  } catch (error) {
    console.error('发送验证码失败:', error);
    res.status(500).json({ message: '邮件发送失败，请检查后端配置' });
  }
});

// --- 2. 注册接口 (带验证码校验) ---
app.post('/api/register', async (req: any, res: any) => {
  try {
    const { username, displayName, password, code } = req.body; // username 对应邮箱

    // A. 校验验证码
    const cached = codeCache.get(username);
    if (!cached) {
      return res.status(400).json({ message: '请先获取验证码' });
    }
    if (cached.code !== code) {
      return res.status(400).json({ message: '验证码错误' });
    }
    if (Date.now() > cached.expires) {
      return res.status(400).json({ message: '验证码已过期' });
    }

    // B. 检查用户是否在注册过程中被抢注
    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ message: '用户名已存在' });

    // C. 加密密码并保存
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, displayName, password: hashedPassword });
    await newUser.save();

    // D. 注册成功，清除验证码缓存
    codeCache.delete(username);

    res.status(201).json({ message: '注册成功' });
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// --- 3. 登录接口 ---
app.post('/api/login', async (req: any, res: any) => {
  try {
    const { username, password } = req.body;

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ message: '用户不存在' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: '密码错误' });
    }

    res.json({ 
      message: '登录成功！',
      username: user.username,
      displayName: user.displayName
    });
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// --- 4. 重置密码接口 ---
app.post('/api/reset-password', async (req: any, res: any) => {
  try {
    const { username, newPassword, code } = req.body;

    // A. 校验验证码
    const cached = codeCache.get(username);
    if (!cached) {
      return res.status(400).json({ message: '请先获取验证码' });
    }
    if (cached.code !== code) {
      return res.status(400).json({ message: '验证码错误' });
    }
    if (Date.now() > cached.expires) {
      return res.status(400).json({ message: '验证码已过期' });
    }

    // B. 更新密码
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.updateOne({ username }, { password: hashedPassword });

    // C. 清除验证码缓存
    codeCache.delete(username);

    res.json({ message: '密码重置成功' });
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// --- 5. 获取个人信息 ---
app.get('/api/profile', async (req: any, res: any) => {
  try {
    const { username } = req.query; // username 是邮箱
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message: '用户不存在' });

    res.json({
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar || ''
    });
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// --- 6. 更新个人信息 ---
app.put('/api/profile', async (req: any, res: any) => {
  try {
    const { username, displayName, avatar } = req.body;

    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message: '用户不存在' });

    // 如果要改用户名，检查是否与他人重复
    if (displayName && displayName !== user.displayName) {
      const existing = await User.findOne({ displayName, username: { $ne: username } });
      if (existing) {
        return res.status(400).json({ message: '该用户名已被使用' });
      }
      user.displayName = displayName;
    }

    // 更新头像
    if (avatar !== undefined) {
      user.avatar = avatar;
    }

    await user.save();
    res.json({ message: '更新成功', displayName: user.displayName, avatar: user.avatar });
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// --- 7. 角色管理 CRUD ---

// 获取用户的所有角色
app.get('/api/characters', async (req: any, res: any) => {
  try {
    const { owner } = req.query;
    if (!owner) return res.status(400).json({ message: '缺少 owner 参数' });

    const chars = await Character.find({ owner }).sort({ createdAt: 1 });
    res.json(chars);
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// 创建角色
app.post('/api/characters', async (req: any, res: any) => {
  try {
    const { owner, id, name, type, avatar, plName, hp, mp, san, luck, skills, attributes, status } = req.body;
    if (!owner || !id || !name || !type) {
      return res.status(400).json({ message: '缺少必要字段' });
    }

    const existing = await Character.findOne({ owner, id });
    if (existing) return res.status(400).json({ message: '角色 ID 已存在' });

    const char = new Character({ owner, id, name, type, avatar, plName, hp, mp, san, luck, skills, attributes, status });
    await char.save();
    res.status(201).json({ message: '创建成功', id });
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// 更新角色
app.put('/api/characters/:id', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { owner, name, type, avatar, plName, hp, mp, san, luck, skills, attributes, status } = req.body;

    const updated = await Character.findOneAndUpdate(
      { owner, id },
      { name, type, avatar, plName, hp, mp, san, luck, skills, attributes, status },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: '角色不存在' });

    res.json({ message: '更新成功' });
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// 删除角色
app.delete('/api/characters/:id', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { owner } = req.query;

    const deleted = await Character.findOneAndDelete({ owner, id });
    if (!deleted) return res.status(404).json({ message: '角色不存在' });

    res.json({ message: '删除成功' });
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

app.get('/', (req, res) => {
  res.send('鱼骰后端服务已就绪！');
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});