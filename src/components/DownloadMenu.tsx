import React, { useState } from 'react';
import { Download, X, Film, CheckCircle2 } from 'lucide-react';
import { Video } from '../types/index.ts';
import { api } from '../api/client.ts';

interface DownloadMenuProps {
  video: Video;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
}

export const DownloadMenu: React.FC<DownloadMenuProps> = ({
  video,
  variant = 'secondary',
  size = 'md',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const formatFileSize = (bytes: number) => {
    if (!bytes || bytes === 0) return 'محاسبه نشده';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(2)} گیگابایت`;
    }
    return `${mb.toFixed(1)} مگابایت`;
  };

  const handleDownload = () => {
    setIsDownloading(true);
    const url = api.getDownloadUrl(video.id);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', '');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => {
      setIsDownloading(false);
      setIsOpen(false);
    }, 1000);
  };

  const btnClasses = {
    primary: 'bg-purple-600 hover:bg-purple-500 text-white font-medium shadow-md shadow-purple-950/50',
    secondary: 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700',
    ghost: 'hover:bg-zinc-800 text-zinc-300',
  }[variant];

  const sizeClasses = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm';

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={`inline-flex items-center gap-1.5 rounded-xl transition-colors ${btnClasses} ${sizeClasses}`}
         title="دانلود فایل اصلی ویدیو"
        type="button"
      >
        <Download className={size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
        <span>دانلود</span>
      </button>

      {/* Rock-solid, mobile-friendly fixed Bottom Sheet & Desktop Modal */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-150"
          dir="rtl"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="w-full sm:max-w-md bg-zinc-900 border border-zinc-700/90 rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-6 space-y-4 max-h-[85vh] overflow-y-auto animate-in slide-in-from-bottom-6 sm:slide-in-from-bottom-2 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Mobile Touch Handle */}
            <div className="w-12 h-1.5 bg-zinc-700 rounded-full mx-auto sm:hidden mb-2" />

            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center shrink-0">
                  <Film className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-zinc-100">دانلود ویدیوی پروژه</h3>
                  <p className="text-xs text-zinc-400 line-clamp-1 mt-0.5">{video.title}</p>
                </div>
              </div>

              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

             {/* Original file only: no server-side quality generation. */}
             <div className="space-y-2">
               <div className="text-[11px] font-semibold text-zinc-400">فایل اصلی بدون تبدیل سمت سرور:</div>
               <button
                 onClick={handleDownload}
                 disabled={isDownloading}
                 className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-zinc-950 hover:bg-zinc-800/90 border border-zinc-800 hover:border-purple-500/50 transition-all text-right group"
               >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-zinc-900 group-hover:bg-purple-600/20 group-hover:text-purple-400 text-zinc-400 flex items-center justify-center transition-colors">
                       {isDownloading ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 animate-pulse" />
                      ) : (
                        <Download className="w-4 h-4" />
                      )}
                    </div>
                    <div>
                         <div className="text-xs font-bold text-zinc-200 group-hover:text-white">
                         نسخه اصلی منبع
                       </div>
                       <div className="text-[10px] text-zinc-400 font-mono mt-0.5">
                         {video.originalResolution || 'کیفیت اصلی'}
                       </div>
                    </div>
                  </div>

                  <div className="text-left font-mono text-xs font-semibold text-purple-400">
                     {formatFileSize(video.fileSize)}
                  </div>
                </button>
            </div>

            {/* Close Button */}
            <button
              onClick={() => setIsOpen(false)}
              className="w-full py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-750 text-zinc-200 font-bold text-xs transition-colors"
            >
              بستن
            </button>
          </div>
        </div>
      )}
    </>
  );
};
