import React, { useState, useRef } from 'react';
import { UploadCloud, X, Film, AlertTriangle, FileVideo, CheckCircle2 } from 'lucide-react';
import { Video } from '../types/index.ts';
import { api } from '../api/client.ts';

interface NewVersionModalProps {
  video: Video;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newVideo: Video) => void;
}

export const NewVersionModal: React.FC<NewVersionModalProps> = ({
  video,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(`${video.title} (نسخه ${video.versionNumber + 1})`);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleSelectFile = (selected: File) => {
    setError(null);
    setFile(selected);
  };

  const formatFileSize = (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(2)} گیگابایت`;
    }
    return `${mb.toFixed(1)} مگابایت`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('لطفاً فایل ویدیوی اصلاح‌شده را انتخاب کنید.');
      return;
    }

    setError(null);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('video', file);
    formData.append('title', title.trim());

    try {
      const created = await api.uploadNewVersion(video.id, formData, (percent) => {
        setUploadProgress(percent);
      });
      setIsProcessing(true);
      setTimeout(() => {
        onSuccess(created);
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err.message || 'بارگذاری نسخه اصلاح‌شده با خطا مواجه شد.');
      setUploadProgress(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-3xl shadow-2xl overflow-hidden" dir="rtl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-600/20 border border-purple-500/30 text-purple-400 flex items-center justify-center">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-100">ارسال کات و نسخه اصلاح‌شده جدید</h3>
              <p className="text-xs text-zinc-400">نسخه {video.versionNumber + 1} • {video.title}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={uploadProgress !== null}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {video.rejectionReason && (
            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300">
              <div className="flex items-center gap-1.5 font-bold text-rose-400 mb-1">
                <AlertTriangle className="w-4 h-4" />
                توضیحات و دلیل رد ناظر کیفی:
              </div>
              <p className="italic text-xs leading-relaxed">"{video.rejectionReason}"</p>
            </div>
          )}

          <div>
            <label className="block font-semibold text-zinc-300 mb-1.5">
              عنوان نسخه جدید پروژه
            </label>
            <input
              type="text"
              required
              disabled={uploadProgress !== null}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500 rounded-xl px-3.5 py-2.5 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>

          <div>
            <label className="block font-semibold text-zinc-300 mb-1.5">
              فایل ویدیوی رندر شده جدید
            </label>
            {!file ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-zinc-700 hover:border-purple-500/60 rounded-2xl p-6 text-center cursor-pointer bg-zinc-950/40 hover:bg-zinc-950/70 transition-colors"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  onChange={(e) => e.target.files?.[0] && handleSelectFile(e.target.files[0])}
                  className="hidden"
                />
                <UploadCloud className="w-8 h-8 text-purple-400 mx-auto mb-2" />
                <div className="font-bold text-zinc-200">انتخاب کات جدید ویدیو</div>
                <div className="text-[11px] text-zinc-500 mt-1">فرمت‌های MP4, MOV, MKV (تا ۵۰۰ مگابایت)</div>
              </div>
            ) : (
              <div className="p-3.5 rounded-2xl bg-zinc-950 border border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-3 overflow-hidden">
                  <FileVideo className="w-5 h-5 text-purple-400 shrink-0" />
                  <div className="overflow-hidden">
                    <div className="text-zinc-200 font-semibold truncate">{file.name}</div>
                    <div className="text-zinc-500 font-mono mt-0.5">{formatFileSize(file.size)}</div>
                  </div>
                </div>
                {uploadProgress === null && (
                  <button
                    type="button"
                    onClick={() => setFile(null)}
                    className="text-xs text-zinc-400 hover:text-rose-400 px-2 py-1 rounded hover:bg-zinc-800"
                  >
                    تعویض
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Progress */}
          {uploadProgress !== null && (
            <div className="p-4 rounded-2xl bg-purple-950/20 border border-purple-500/30 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-200 font-medium">
                  {isProcessing ? 'بارگذاری انجام شد! در حال شروع تبدیل مجدد...' : 'در حال بارگذاری نسخه اصلاح‌شده...'}
                </span>
                <span className="font-mono text-purple-400 font-bold">{uploadProgress}%</span>
              </div>
              <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-purple-600 h-full rounded-full transition-all duration-200"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              {isProcessing && (
                <p className="text-[11px] text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  ناظر کیفی به صورت خودکار از ثبت نسخه جدید باخبر شد.
                </p>
              )}
            </div>
          )}

          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
              {error}
            </div>
          )}

          {/* Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              disabled={uploadProgress !== null}
              className="px-4 py-2 text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-800 transition-colors"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={!file || uploadProgress !== null}
              className="px-5 py-2.5 font-bold rounded-xl bg-purple-600 hover:bg-purple-500 text-white transition-all shadow-lg shadow-purple-950/50 disabled:opacity-50 flex items-center gap-2"
            >
              <UploadCloud className="w-4 h-4" />
              {uploadProgress !== null ? 'در حال ارسال...' : 'ثبت نسخه جدید برای بازبینی'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
