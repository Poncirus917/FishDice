// E:\coc-tool\fish-dice\app\layout.tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from 'react-hot-toast';
import "./globals.css"; // 路径改为当前目录

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "鱼骰FishDice",
  description: "鱼骰-FishDice，COC跑团掷骰工具",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function(){
                try {
                  var host = window.location.hostname || '';
                  var isOnline =
                    /fish-dice-online/i.test(host) ||
                    /online/i.test(host);
                  if (isOnline && window.location.pathname === '/') {
                    window.location.replace('/online/auth');
                    document.documentElement.style.display = 'none';
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        {/* 把 Toaster 留在这里，这样全站（包括联机版）都可以用弹窗 */}
        <Toaster 
          position="top-center" 
          toastOptions={{
            style: {
              borderRadius: '16px',
              background: '#333',
              color: '#fff',
              fontSize: '14px',
            },
          }}
        />
      </body>
    </html>
  );
}