// server/utils/mailer.ts
import nodemailer from 'nodemailer';

// 验证环境变量是否存在，避免启动后才发现没配置邮箱
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

if (!EMAIL_USER || !EMAIL_PASS) {
  console.warn("⚠️ 警告: 未检测到 EMAIL_USER 或 EMAIL_PASS 环境变量，邮件功能将无法正常使用。");
}

const transporter = nodemailer.createTransport({
  service: 'qq', 
  // 如果 service: 'qq' 连不上，可以替换为下面注释的精确配置：
  // host: 'smtp.qq.com',
  // port: 465,
  // secure: true, // 使用 SSL
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS,
  },
});

/**
 * 发送注册验证码
 * @param to 接收方邮箱
 * @param code 6位验证码
 */
export const sendCode = async (to: string, code: string) => {
  const mailOptions = {
    // 这里的 from 必须和 auth.user 一致，否则会被 QQ 邮箱拒绝
    from: `"鱼骰 FishDice" <${EMAIL_USER}>`,
    to,
    subject: '【鱼骰 FishDice】请查收您的注册验证码',
    // 纯文本版（防止部分邮箱客户端不支持 HTML）
    text: `迎加入我们，调查员。您的档案已经建立，请完成初次认证。您的注册验证码是：${code}。该验证码 5 分钟内有效。如果非本人操作，请忽略此邮件。`,
    // HTML 渲染版
    html: `
      <div style="background: #1e293b; color: #fff; padding: 20px; border-radius: 10px; font-family: sans-serif;">
        <h2 style="color: #22d3ee; border-bottom: 1px solid #334155; padding-bottom: 10px;">鱼骰 FishDice 验证</h2>
        <p>欢迎加入我们，调查员。</p>
        <p>您的档案已经建立，请完成初次认证。</p>
        <p>您的注册验证码为：</p>
        <div style="background: #0f172a; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; color: #22d3ee; letter-spacing: 5px; border-radius: 5px; margin: 20px 0;">
          ${code}
        </div>
        <p style="font-size: 12px; color: #94a3b8;">该验证码有效期为 5 分钟。为了您的账号安全，请勿将验证码转发给他人。</p>
      </div>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✨ 邮件发送成功:', info.messageId);
    return info;
  } catch (error) {
    console.error('❌ 邮件发送失败:', error);
    throw error; // 抛出异常供调用者（API 接口）处理
  }
};