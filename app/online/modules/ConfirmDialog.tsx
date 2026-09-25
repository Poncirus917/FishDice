"use client";

import { useState, useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmColor?: string;
  countdownSeconds?: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  confirmColor = '#0891b2',
  countdownSeconds = 0,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (!isOpen) {
      setCountdown(0);
      return;
    }

    if (countdownSeconds <= 0) {
      setCountdown(0);
      return;
    }

    setCountdown(countdownSeconds);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isOpen, countdownSeconds]);

  if (!isOpen) return null;

  const canConfirm = countdown <= 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-slate-800 rounded-2xl shadow-2xl border border-slate-700 p-6 mx-4">
        <h3 className="text-xl font-bold text-white mb-3">{title}</h3>
        <p className="text-slate-400 mb-6 whitespace-pre-line">{message}</p>

        {countdownSeconds > 0 && countdown > 0 && (
          <div className="mb-4 text-center">
            <span className="text-amber-400 text-sm">
              请等待 <span className="font-bold text-lg">{countdown}</span> 秒后才能确认
            </span>
          </div>
        )}

        <div className={cancelText ? 'flex gap-3' : 'flex justify-center'}>
          {cancelText && (
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 px-4 bg-slate-700 hover:bg-slate-600 rounded-xl font-medium tracking-wide text-slate-300 transition"
            >
              {cancelText}
            </button>
          )}
          <button
            onClick={onConfirm}
            disabled={!canConfirm}
            style={{ backgroundColor: confirmColor }}
            className={`${
              cancelText ? 'flex-1' : 'min-w-[10rem] px-10'
            } py-2.5 rounded-xl font-bold text-[15px] tracking-widest text-center text-white transition whitespace-nowrap ${
              !canConfirm ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
            }`}
          >
            {countdownSeconds > 0 && countdown > 0 ? `${countdown}s 后可确认` : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useConfirmDialog() {
  const [dialogState, setDialogState] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: '确认',
    cancelText: '取消',
    confirmColor: '#0891b2',
    countdownSeconds: 0,
    onConfirm: null as (() => void) | null,
    onCancel: null as (() => void) | null,
  });

  const showConfirm = (options: {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    confirmColor?: string;
    countdownSeconds?: number;
    onConfirm: () => void;
    onCancel?: () => void;
  }) => {
    setDialogState({
      isOpen: true,
      title: options.title,
      message: options.message,
      confirmText: options.confirmText ?? '确认',
      cancelText: options.cancelText ?? '取消',
      confirmColor: options.confirmColor ?? '#0891b2',
      countdownSeconds: options.countdownSeconds ?? 0,
      onConfirm: options.onConfirm,
      onCancel: options.onCancel ?? (() => {}),
    });
  };

  const handleConfirm = () => {
    const callback = dialogState.onConfirm;
    setDialogState(prev => ({ ...prev, isOpen: false }));
    if (callback) callback();
  };

  const handleCancel = () => {
    const callback = dialogState.onCancel;
    setDialogState(prev => ({ ...prev, isOpen: false }));
    if (callback) callback();
  };

  const Dialog = (
    <ConfirmDialog
      isOpen={dialogState.isOpen}
      title={dialogState.title}
      message={dialogState.message}
      confirmText={dialogState.confirmText}
      cancelText={dialogState.cancelText}
      confirmColor={dialogState.confirmColor}
      countdownSeconds={dialogState.countdownSeconds}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );

  return { showConfirm, Dialog };
}
