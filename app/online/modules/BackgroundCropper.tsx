"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface BackgroundCropperProps {
  src: string;
  // 目标宽高比（与房间中央背景区一致）
  aspect: number;
  onConfirm: (blob: Blob) => void;
  onCancel: () => void;
}

// 输出图片最长边上限
const MAX_OUTPUT_EDGE = 1920;

export default function BackgroundCropper({ src, aspect, onConfirm, onCancel }: BackgroundCropperProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [box, setBox] = useState({ w: 720, h: 480 });
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // 编辑框尺寸随视口变化
  useEffect(() => {
    const update = () => {
      const w = Math.min(window.innerWidth - 80, 780);
      const h = Math.min(window.innerHeight - 260, 520);
      setBox({ w: Math.max(320, w), h: Math.max(220, h) });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // 裁剪框：保持目标比例并居中
  const crop = useMemo(() => {
    const maxW = Math.max(40, box.w - 32);
    const maxH = Math.max(40, box.h - 32);
    let w = maxW;
    let h = w / aspect;
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
    }
    return { w, h, x: (box.w - w) / 2, y: (box.h - h) / 2 };
  }, [box, aspect]);

  // 最小缩放：保证裁剪框始终被图片覆盖
  const minScale = useMemo(
    () => (imgSize.w > 0 ? Math.max(crop.w / imgSize.w, crop.h / imgSize.h) : 1),
    [imgSize, crop]
  );

  // 限制拖动范围，避免露出空白
  const clampOffset = useCallback(
    (next: { x: number; y: number }, s: number) => ({
      x: Math.min(crop.x, Math.max(crop.x + crop.w - imgSize.w * s, next.x)),
      y: Math.min(crop.y, Math.max(crop.y + crop.h - imgSize.h * s, next.y)),
    }),
    [crop, imgSize]
  );

  // 加载图片并让裁剪框居中覆盖
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImgSize({ w: img.width, h: img.height });
      const initScale = Math.max(crop.w / img.width, crop.h / img.height);
      setScale(initScale);
      setOffset({
        x: crop.x + crop.w / 2 - (img.width * initScale) / 2,
        y: crop.y + crop.h / 2 - (img.height * initScale) / 2,
      });
    };
    img.src = src;
  }, [src, crop.w, crop.h, crop.x, crop.y]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || imgSize.w === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = box.w;
    canvas.height = box.h;

    // 背景
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, box.w, box.h);

    // 裁剪框内绘制图片
    ctx.save();
    ctx.beginPath();
    ctx.rect(crop.x, crop.y, crop.w, crop.h);
    ctx.clip();
    ctx.drawImage(img, offset.x, offset.y, imgSize.w * scale, imgSize.h * scale);
    ctx.restore();

    // 框外压暗
    ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
    ctx.fillRect(0, 0, box.w, crop.y);
    ctx.fillRect(0, crop.y + crop.h, box.w, box.h - crop.y - crop.h);
    ctx.fillRect(0, crop.y, crop.x, crop.h);
    ctx.fillRect(crop.x + crop.w, crop.y, box.w - crop.x - crop.w, crop.h);

    // 裁剪框
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2;
    ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);

    // 三分线
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.3)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      const x = crop.x + (crop.w / 3) * i;
      const y = crop.y + (crop.h / 3) * i;
      ctx.beginPath();
      ctx.moveTo(x, crop.y);
      ctx.lineTo(x, crop.y + crop.h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(crop.x, y);
      ctx.lineTo(crop.x + crop.w, y);
      ctx.stroke();
    }
  }, [box, crop, imgSize, scale, offset]);

  useEffect(() => {
    draw();
  }, [draw]);

  // 以裁剪框中心为锚点缩放
  const applyScale = useCallback((nextScale: number) => {
    if (imgSize.w === 0) return;
    const s = Math.max(minScale, Math.min(minScale * 6, nextScale));
    const centerX = crop.x + crop.w / 2;
    const centerY = crop.y + crop.h / 2;
    const imgX = (centerX - offset.x) / scale;
    const imgY = (centerY - offset.y) / scale;
    const nextOffset = {
      x: centerX - imgX * s,
      y: centerY - imgY * s,
    };
    setScale(s);
    setOffset(clampOffset(nextOffset, s));
  }, [crop, imgSize, minScale, offset, scale, clampOffset]);

  const startDrag = (clientX: number, clientY: number) => {
    setIsDragging(true);
    dragStartRef.current = { x: clientX - offset.x, y: clientY - offset.y };
  };

  const moveDrag = (clientX: number, clientY: number) => {
    if (!isDragging) return;
    const next = {
      x: clientX - dragStartRef.current.x,
      y: clientY - dragStartRef.current.y,
    };
    setOffset(clampOffset(next, scale));
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    applyScale(scale * (e.deltaY > 0 ? 0.92 : 1.08));
  };

  // 导出：按裁剪框从原图取样，输出 JPEG
  const handleConfirm = () => {
    const img = imgRef.current;
    if (!img || imgSize.w === 0) return;

    const srcX = (crop.x - offset.x) / scale;
    const srcY = (crop.y - offset.y) / scale;
    const srcW = crop.w / scale;
    const srcH = crop.h / scale;

    const outW = Math.max(1, Math.min(MAX_OUTPUT_EDGE, Math.round(srcW)));
    const outH = Math.max(1, Math.round(outW / aspect));

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    const ctx = outCanvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outW, outH);

    outCanvas.toBlob(blob => {
      if (blob) onConfirm(blob);
    }, 'image/jpeg', 0.88);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 backdrop-blur-sm"
      onClick={e => e.stopPropagation()}
    >
      <div className="bg-slate-800 rounded-2xl shadow-2xl border border-slate-700 p-5 w-full max-w-3xl mx-4">
        <h3 className="text-lg font-bold text-white mb-1 text-center">裁剪背景图</h3>
        <p className="text-[11px] text-slate-500 text-center mb-3">
          拖拽移动 · 滚轮或滑块缩放 · 裁剪框比例与房间背景区一致（{aspect.toFixed(2)}:1）
        </p>

        <div
          className="relative mx-auto select-none overflow-hidden rounded-xl border border-slate-600 bg-slate-900"
          style={{ width: box.w, height: box.h }}
        >
          <canvas
            ref={canvasRef}
            className={isDragging ? 'cursor-grabbing' : 'cursor-grab'}
            style={{ touchAction: 'none', width: box.w, height: box.h }}
            onMouseDown={e => startDrag(e.clientX, e.clientY)}
            onMouseMove={e => moveDrag(e.clientX, e.clientY)}
            onMouseUp={() => setIsDragging(false)}
            onMouseLeave={() => setIsDragging(false)}
            onTouchStart={e => {
              const t = e.touches[0];
              startDrag(t.clientX, t.clientY);
            }}
            onTouchMove={e => {
              const t = e.touches[0];
              moveDrag(t.clientX, t.clientY);
            }}
            onTouchEnd={() => setIsDragging(false)}
            onWheel={handleWheel}
          />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <span className="text-slate-400 text-xs w-10 flex-shrink-0">缩放</span>
          <input
            type="range"
            min={minScale}
            max={minScale * 6}
            step={0.01}
            value={scale}
            onChange={e => applyScale(parseFloat(e.target.value))}
            className="flex-1 accent-cyan-500"
          />
          <span className="text-slate-400 text-xs w-12 text-right flex-shrink-0">
            {(scale / minScale).toFixed(1)}x
          </span>
        </div>

        <div className="flex gap-3 mt-5">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold text-sm transition"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold text-sm transition"
          >
            确认裁剪并导入
          </button>
        </div>
      </div>
    </div>
  );
}
