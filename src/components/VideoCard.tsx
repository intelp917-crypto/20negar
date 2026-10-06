import React, { useState } from 'react';
import { Video } from '../types/index.ts';
import { StatusBadge, ProcessingBadge } from './StatusBadge.tsx';
import { DownloadMenu } from './DownloadMenu.tsx';
import { api } from '../api/client.ts';
import { Play, Film, Clock, User, Shield, AlertTriangle, ArrowUpLeft } from 'lucide-react';

interface VideoCardProps {
  video: Video;
  onWatch: (video: Video) => void;
  onViewDetails: (video: Video) => void;
  onUploadNewVersion?: (video: Video) => void;
  onQuickReview?: (video: Video) => void;
  showSupervisorActions?: boolean;
}

export const VideoCard: React.FC<VideoCardProps> = ({
  video,
  onWatch,
  onViewDetails,
  onUploadNewVersion,
  onQuickReview,
  showSupervisorActions = false,
}) => {
  const [thumbError, setThumbError] = useState(false);

  const formatDuration = (seconds: number) => {
    if (!seconds || seconds <= 0) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '0 مگابایت';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(2)} گیگابایت`;
    }
    return `${mb.toFixed(1)} مگابایت`;
  };

  const thumbnailUrl = video.thumbnailPath ? api.getThumbnailUrl(video.id) : null;

  return (
    <div className="group bg-zinc-900 border border-zinc-800 hover:border-zinc-700/80 rounded-3xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300 flex flex-col" dir="rtl">
      {/* Thumbnail Area */}
      <div className="relative aspect-video bg-zinc-950 overflow-hidden cursor-pointer" onClick={() => onWatch(video)}>
        {thumbnailUrl && !thumbError ? (
          <img
            src={thumbnailUrl}
            alt={video.title}
            onError={() => setThumbError(true)}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-zinc-700 group-hover:text-zinc-500 transition-colors">
            <Film className="w-12 h-12 mb-1" />
            <span className="text-xs font-mono text-zinc-600">پیش‌نمایش ویدیو</span>
          </div>
        )}

        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
          <div className="w-12 h-12 rounded-full bg-purple-600/90 text-white flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition-transform">
            <Play className="w-6 h-6 mr-0.5 fill-white" />
          </div>
        </div>

        {video.duration > 0 && (
          <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-lg bg-black/80 backdrop-blur-sm text-white font-mono text-[11px] font-semibold flex items-center gap-1">
            <Clock className="w-3 h-3 text-zinc-400" />
            {formatDuration(video.duration)}
          </div>
        )}

        {video.versionNumber > 1 && (
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-purple-600/90 text-white font-mono text-[10px] font-bold shadow-md">
            نسخه {video.versionNumber}
          </div>
        )}

        <div className="absolute top-2 left-2 flex flex-col items-end gap-1">
          <StatusBadge status={video.status} size="sm" />
        </div>
      </div>

      {/* Card Body */}
      <div className="p-4 flex-1 flex flex-col justify-between">
        <div>
          <div className="flex items-start justify-between gap-2 mb-1">
            <h4
              onClick={() => onViewDetails(video)}
              className="text-sm font-bold text-zinc-100 group-hover:text-purple-300 transition-colors line-clamp-1 cursor-pointer"
              title={video.title}
            >
              {video.title}
            </h4>
          </div>

          <div className="text-xs text-zinc-500 font-mono truncate mb-3" title={video.originalFilename} dir="ltr">
            {video.originalFilename}
          </div>

          {/* Editor & Supervisor Info */}
          <div className="space-y-1.5 text-xs text-zinc-400 border-t border-zinc-800/80 pt-2.5 mb-3">
            <div className="flex items-center justify-between">
              <span className="text-zinc-500 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" /> تدوین‌گر:
              </span>
              <span className="font-semibold text-zinc-300 truncate max-w-[140px]" title={video.editorName}>
                {video.editorName}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-500 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-purple-400/80" /> ناظر کیفی:
              </span>
              <span className="font-semibold text-zinc-300 truncate max-w-[140px]" title={video.supervisorName}>
                {video.supervisorName}
              </span>
            </div>
          </div>

          {/* Resolution & File Size */}
          <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500 pb-2 mb-2 border-b border-zinc-800/60">
            <span>{video.originalResolution || 'در صف آنالیز'}</span>
            <span>{formatFileSize(video.fileSize)}</span>
          </div>

          <div className="mb-3">
            <ProcessingBadge status={video.processingStatus} size="sm" />
          </div>

          {video.status === 'Rejected' && video.rejectionReason && (
            <div className="mb-3 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
              <div className="flex items-center gap-1 font-bold text-rose-400 mb-0.5">
                <AlertTriangle className="w-3 h-3" /> بازخورد رد پروژه:
              </div>
              <p className="line-clamp-2 italic text-[11px] leading-relaxed">"{video.rejectionReason}"</p>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="space-y-2 pt-2 border-t border-zinc-800">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onWatch(video)}
              className="flex-1 py-1.5 px-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-md shadow-purple-950/40 transition-colors"
            >
              <Play className="w-3.5 h-3.5 fill-white" />
              تماشا
            </button>

            <button
              onClick={() => onViewDetails(video)}
              className="py-1.5 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium border border-zinc-700 transition-colors flex items-center gap-1"
            >
              جزئیات
              <ArrowUpLeft className="w-3 h-3 text-zinc-400" />
            </button>

            <DownloadMenu video={video} size="sm" />
          </div>

          {showSupervisorActions && video.status === 'PendingReview' && onQuickReview && (
            <button
              onClick={() => onQuickReview(video)}
              className="w-full py-2 px-3 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-xs font-bold transition-colors flex items-center justify-center gap-1"
            >
              بازبینی و تصمیم‌گیری
            </button>
          )}

          {video.status === 'Rejected' && onUploadNewVersion && (
            <button
              onClick={() => onUploadNewVersion(video)}
              className="w-full py-2 px-3 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 text-xs font-bold transition-colors flex items-center justify-center gap-1"
            >
              بارگذاری نسخه جدید
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
