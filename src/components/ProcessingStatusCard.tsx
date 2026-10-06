import React, { useEffect, useState } from 'react';
import { Video, ProcessingDetails } from '../types/index.ts';
import { api } from '../api/client.ts';
import { CheckCircle2, Clock, Loader2, XCircle, Minus } from 'lucide-react';

interface ProcessingStatusCardProps {
  video: Video;
  onReady?: () => void;
}

export const ProcessingStatusCard: React.FC<ProcessingStatusCardProps> = ({ video, onReady }) => {
  const [details, setDetails] = useState<ProcessingDetails | null>(video.processingDetails || null);
  const [isPolling, setIsPolling] = useState<boolean>(video.processingStatus === 'Processing');

  useEffect(() => {
    if (!isPolling) return;

    const interval = setInterval(async () => {
      try {
        const job = await api.getJobStatus(video.id);
        if (job) {
          setDetails({
            status: job.status,
            progress: job.progress,
            currentStep: job.currentStep,
            details: job.details,
            errorMessage: job.errorMessage,
          });

          if (job.status === 'completed' || job.status === 'failed') {
            setIsPolling(false);
            if (job.status === 'completed' && onReady) {
              onReady();
            }
          }
        }
      } catch (err) {
        console.warn('Job status check:', err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [video.id, isPolling, onReady]);

  const steps: { key: string; label: string }[] = [
    { key: 'original', label: 'نسخه اصلی ویدیو' },
    { key: 'thumbnail', label: 'تصویر پیش‌نمایش پوستر' },
    { key: '1080p', label: 'کیفیت ۱۰۸۰p (فول اچ‌دی)' },
    { key: '720p', label: 'کیفیت ۷۲۰p (اچ‌دی)' },
    { key: '480p', label: 'کیفیت ۴۸۰p (معمولی)' },
    { key: '360p', label: 'کیفیت ۳۶۰p (بهینه موبایل)' },
    { key: 'hls', label: 'پخش خودکار متناسب با سرعت نت' },
  ];

  const getStepIcon = (stepKey: string) => {
    if (!details || !details.details) {
      if (video.processingStatus === 'Ready') return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
      return <Clock className="w-4 h-4 text-zinc-500" />;
    }

    const state = (details.details as any)[stepKey];
    if (state === 'completed') return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
    if (state === 'processing') return <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />;
    if (state === 'failed') return <XCircle className="w-4 h-4 text-rose-400" />;
    if (state === 'skipped') return <Minus className="w-4 h-4 text-zinc-600" />;
    return <Clock className="w-4 h-4 text-zinc-500" />;
  };

  const getStepBadge = (stepKey: string) => {
    if (!details || !details.details) {
      return video.processingStatus === 'Ready' ? (
        <span className="text-emerald-400 font-mono text-[11px]">آماده پخش</span>
      ) : (
        <span className="text-zinc-500 font-mono text-[11px]">در نوبت</span>
      );
    }

    const state = (details.details as any)[stepKey];
    switch (state) {
      case 'completed':
        return <span className="text-emerald-400 font-mono text-[11px] font-medium">آماده</span>;
      case 'processing':
        return <span className="text-purple-400 font-mono text-[11px] animate-pulse">در حال آماده‌سازی...</span>;
      case 'failed':
        return <span className="text-rose-400 font-mono text-[11px]">خطا</span>;
      case 'skipped':
        return <span className="text-zinc-500 font-mono text-[11px]">صرف‌نظر</span>;
      default:
        return <span className="text-zinc-500 font-mono text-[11px]">در نوبت</span>;
    }
  };

  return (
    <div className="bg-zinc-900/90 border border-zinc-800 rounded-3xl p-5 shadow-lg" dir="rtl">
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800 mb-3">
        <div>
          <h4 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            وضعیت کیفیت‌های ویدیو
            {isPolling && <Loader2 className="w-3.5 h-3.5 text-purple-400 animate-spin" />}
          </h4>
          <p className="text-xs text-zinc-400 mt-0.5">
            {video.processingStatus === 'Ready'
              ? 'کیفیت‌های ۱۰۸۰p، ۷۲۰p، ۴۸۰p و ۳۶۰p آماده پخش هستند.'
              : 'در حال آماده‌سازی و بهینه‌سازی کیفیت‌های ویدیو...'}
          </p>
        </div>
        {details && details.progress < 100 && (
          <div className="text-left font-mono">
            <span className="text-sm font-bold text-purple-400">{details.progress}%</span>
          </div>
        )}
      </div>

      {details && details.progress < 100 && (
        <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden mb-3">
          <div
            className="bg-gradient-to-r from-purple-600 to-indigo-500 h-full rounded-full transition-all duration-300"
            style={{ width: `${details.progress}%` }}
          />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        {steps.map((step) => (
          <div
            key={step.key}
            className="flex items-center justify-between p-2.5 rounded-2xl bg-zinc-950/60 border border-zinc-800/80"
          >
            <div className="flex items-center gap-2 text-zinc-300">
              {getStepIcon(step.key)}
              <span>{step.label}</span>
            </div>
            {getStepBadge(step.key)}
          </div>
        ))}
      </div>

      {details?.errorMessage && (
        <div className="mt-3 p-3 rounded-2xl bg-red-950/40 border border-red-800/50 text-red-300 text-xs">
          <strong>خطا:</strong> {details.errorMessage}
        </div>
      )}
    </div>
  );
};
