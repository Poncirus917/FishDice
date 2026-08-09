"use client";
import { useState, useRef, useEffect, useCallback } from 'react';

interface AvatarCropperProps {
  src: string;
  onConfirm: (croppedDataUrl: string) => void;
  onCancel: () => void;
  size?: number;
}

export default function AvatarCropper({ src, onConfirm, onCancel, size = 256 }: AvatarCropperProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [containerSize, setContainerSize] = useState(400);

  const CROP_SIZE = 240;

  useEffect(() => {
    const updateSize = () => {
      const s = Math.min(window.innerWidth - 80, 480);
      setContainerSize(Math.max(300, s));
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      setImgSize({ w: img.width, h: img.height });
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const displaySize = Math.min(containerSize, 480);
          const scaleX = displaySize / img.width;
          const scaleY = displaySize / img.height;
          const initScale = Math.max(scaleX, scaleY);
          setScale(initScale);
          const drawW = img.width * initScale;
          const drawH = img.height * initScale;
          setOffset({
            x: (displaySize - drawW) / 2,
            y: (displaySize - drawH) / 2,
          });
        }
      }
    };
    img.src = src;
  }, [src, containerSize]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || imgSize.w === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const displaySize = Math.min(containerSize, 480);
    canvas.width = displaySize;
    canvas.height = displaySize;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, displaySize, displaySize);

    const drawW = imgSize.w * scale;
    const drawH = imgSize.h * scale;

    ctx.save();
    ctx.beginPath();
    ctx.rect((displaySize - CROP_SIZE) / 2, (displaySize - CROP_SIZE) / 2, CROP_SIZE, CROP_SIZE);
    ctx.clip();

    ctx.drawImage(img, offset.x, offset.y, drawW, drawH);
    ctx.restore();

    const cropX = (displaySize - CROP_SIZE) / 2;
    const cropY = (displaySize - CROP_SIZE) / 2;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
    ctx.fillRect(0, 0, displaySize, cropY);
    ctx.fillRect(0, cropY + CROP_SIZE, displaySize, displaySize - cropY - CROP_SIZE);
    ctx.fillRect(0, cropY, cropX, CROP_SIZE);
    ctx.fillRect(cropX + CROP_SIZE, cropY, displaySize - cropX - CROP_SIZE, CROP_SIZE);

    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2;
    ctx.strokeRect(cropX, cropY, CROP_SIZE, CROP_SIZE);

    ctx.strokeStyle = 'rgba(34, 211, 238, 0.3)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(cropX + (CROP_SIZE / 3) * i, cropY);
      ctx.lineTo(cropX + (CROP_SIZE / 3) * i, cropY + CROP_SIZE);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cropX, cropY + (CROP_SIZE / 3) * i);
      ctx.lineTo(cropX + CROP_SIZE, cropY + (CROP_SIZE / 3) * i);
      ctx.stroke();
    }
  }, [imgSize, scale, offset, containerSize]);

  useEffect(() => {
    draw();
  }, [draw]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale(prev => Math.max(0.1, Math.min(10, prev * delta)));
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    setIsDragging(true);
    setDragStart({ x: touch.clientX - offset.x, y: touch.clientY - offset.y });
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    setOffset({
      x: touch.clientX - dragStart.x,
      y: touch.clientY - dragStart.y,
    });
  };

  const handleTouchEnd = () => setIsDragging(false);

  const handleScaleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setScale(parseFloat(e.target.value));
  };

  const handleConfirm = () => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || imgSize.w === 0) return;

    const displaySize = Math.min(containerSize, 480);
    const cropX = (displaySize - CROP_SIZE) / 2;
    const cropY = (displaySize - CROP_SIZE) / 2;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = size;
    outCanvas.height = size;
    const ctx = outCanvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, size, size);

    const scaleRatio = size / CROP_SIZE;
    const srcX = (cropX - offset.x) / scale;
    const srcY = (cropY - offset.y) / scale;
    const srcW = CROP_SIZE / scale;
    const srcH = CROP_SIZE / scale;

    ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, size, size);

    onConfirm(outCanvas.toDataURL('image/png'));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm">
      <div className="bg-slate-800 rounded-2xl shadow-2xl border border-slate-700 p-6 max-w-lg w-full mx-4">
        <h3 className="text-xl font-bold text-white mb-4 text-center">裁剪头像</h3>

        <div
          ref={containerRef}
          className="relative mx-auto select-none"
          style={{ width: Math.min(containerSize, 480), height: Math.min(containerSize, 480) }}
        >
          <canvas
            ref={canvasRef}
            className={`rounded-xl border border-slate-600 ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
            style={{ touchAction: 'none' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onWheel={handleWheel}
          />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <span className="text-slate-400 text-sm w-12">缩放</span>
          <input
            type="range"
            min="0.1"
            max="10"
            step="0.01"
            value={scale}
            onChange={handleScaleChange}
            className="flex-1 accent-cyan-500"
          />
          <span className="text-slate-400 text-sm w-12 text-right">{scale.toFixed(1)}x</span>
        </div>

        <p className="text-xs text-slate-500 mt-2 text-center">
          拖拽移动位置 · 滚轮或滑块缩放
        </p>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onCancel}
            className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold transition"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold transition"
          >
            确认裁剪
          </button>
        </div>
      </div>
    </div>
  );
}
