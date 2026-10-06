import React from 'react';
import { VideoStatus, ProcessingStatus } from '../types/index.ts';
import { CheckCircle2, Clock, XCircle, AlertTriangle, Loader2 } from 'lucide-react';

export const StatusBadge: React.FC<{ status: VideoStatus; size?: 'sm' | 'md' }> = ({
  status,
  size = 'md',
}) => {
  const isSm = size === 'sm';
  const sizeClasses = isSm ? 'text-[11px] px-2 py-0.5 gap-1' : 'text-xs font-medium px-2.5 py-1 gap-1.5';

  switch (status) {
    case 'Approved':
      return (
        <span
          className={`inline-flex items-center rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm shadow-emerald-950/50 ${sizeClasses}`}
        >
          <CheckCircle2 className={isSm ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          تایید شده
        </span>
      );
    case 'PendingReview':
      return (
        <span
          className={`inline-flex items-center rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-sm shadow-amber-950/50 ${sizeClasses}`}
        >
          <Clock className={isSm ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          در انتظار بازبینی
        </span>
      );
    case 'Rejected':
      return (
        <span
          className={`inline-flex items-center rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 shadow-sm shadow-rose-950/50 ${sizeClasses}`}
        >
          <XCircle className={isSm ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          رد شده / اصلاح
        </span>
      );
    case 'Uploaded':
    default:
      return (
        <span
          className={`inline-flex items-center rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700 ${sizeClasses}`}
        >
          <Clock className={isSm ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          بارگذاری شده
        </span>
      );
  }
};

export const ProcessingBadge: React.FC<{ status: ProcessingStatus; size?: 'sm' | 'md' }> = ({
  status,
  size = 'md',
}) => {
  const isSm = size === 'sm';
  const sizeClasses = isSm ? 'text-[11px] px-2 py-0.5 gap-1' : 'text-xs px-2.5 py-0.5 gap-1.5';

  switch (status) {
    case 'Ready':
      return (
        <span className={`inline-flex items-center rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 ${sizeClasses}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          آماده پخش
        </span>
      );
    case 'Processing':
    case 'Uploading':
      return (
        <span className={`inline-flex items-center rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20 ${sizeClasses}`}>
          <Loader2 className="w-3 h-3 animate-spin text-purple-400" />
          در حال آماده‌سازی کیفیت‌ها...
        </span>
      );
    case 'ProcessingFailed':
      return (
        <span className={`inline-flex items-center rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 ${sizeClasses}`}>
          <AlertTriangle className="w-3 h-3 text-amber-400" />
          نیازمند بررسی
        </span>
      );
    default:
      return null;
  }
};
