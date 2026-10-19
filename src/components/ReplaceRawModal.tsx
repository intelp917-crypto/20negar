import React, { useState, useEffect, useRef } from 'react';
import { UploadCloud, X, Film, AlertTriangle, FileVideo, CheckCircle2, Shield, Loader2 } from 'lucide-react';
import { Video, User } from '../types/index.ts';
import { api } from '../api/client.ts';

interface ReplaceRawModalProps {
  video: Video;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updated: Video) => void;
}

/**
 * جایگزینی فایل خام تصویربردار با نسخه ادیت‌شده روی همان فایل.
 * انتخاب ناظر کیفی اینجا انجام می‌شود تا کات در پنل او نمایش داده شود.
 */
export const ReplaceRawModal: React.FC<ReplaceRawModalProps> = ({
  video,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(video.title);
  const [supervisorId, setSupervisorId] = useState<number | ''>('');
  const [supervisors, setSupervisors] = useState<User[]>([]);
  const [isLoadingSupervisors, setIsLoadingSupervisors] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setFile(null);
    setTitle(video.title);
    setError(null);
    setUploadProgress(null);
    setIsPublishing(false);
    setIsLoadingSupervisors(true);

    let cancelled = false;
    api.getSupervisors()
      .then((list) => {
        if (cancelled) return;
        setSupervisors(list);
        setSupervisorId(list.length > 0 ? list[0].id : '');
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(err?.message || 'بارگذاری فهرست ناظران کیفی با خطا مواجه شد.');
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSupervisors(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, video.id, video.title]);

  if (!isOpen) return null;

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
      setError('لطفاً فایل ویدیوی ادیت‌شده را انتخاب کنید.');
      return;
    }
    if (!supervisorId) {
      setError('انتخاب ناظر کیفی برای نمایش نسخه ادیت‌شده الزامی است.');
      return;
    }

    setError(null);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('video', file);
    formData.append('title', title.trim() || video.title);
    formData.append('supervisorId', String(supervisorId));

    try {
      const updated = await api.uploadReplacement(video.id, formData, (percent) => {
        setUploadProgress(percent);
      });
      setIsPublishing(true);
      setTimeout(() => {
        onSuccess(updated);
        onClose();
      }, 900);
    } catch (err: any) {
      setError(err.message || 'جایگزینی فایل ادیت‌شده با خطا مواجه شد.');
      setUploadProgress(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-3xl shadow-2xl overflow-hidden" dir="rtl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-400 flex items-center justify-center">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-100">انتشار نسخه ادیت‌شده و جایگزینی فایل</h3>
              <p className="text-xs text-zinc-400">
                نسخه {video.versionNumber + 1} • {video.title}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={uploadProgress !== null}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          <div className="p-4 rounded-2xl bg-sky-500/10 border border-sky-500/25 text-sky-200 leading-relaxed">
            <div className="flex items-center gap-1.5 font-bold mb-1">
              <UploadCloud className="w-4 h-4" />
              فایل ادیت‌شده جایگزین همان فایل خام می‌شود
            </div>
            <p className="text-[11px]">
              فایل اصلی خام پس از موفقیت جایگزینی پاک می‌شود. با انتخاب ناظر کیفی، این کات
              مستقیماً در پنل او برای بازبینی نمایش داده خواهد شد.
            </p>
          </div>

          <div>
            <label className="block font-semibold text-zinc-300 mb-1.5">
              عنوان نسخه منتشرشده
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
              فایل ویدیوی ادیت‌شده <span className="text-purple-400">*</span>
            </label>
            {!file ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-zinc-700 hover:border-purple-500/60 rounded-2xl p-6 text-center cursor-pointer bg-zinc-950/40 hover:bg-zinc-950/70 transition-colors"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*,.mkv,.mpg,.mpeg,.mts,.m2ts,.mxf,.ogv,.flv,.3gp,.vob,.ts,.divx,.f4v,.wmv,.mov,.mp4,.webm,.avi,.m4v"
                  onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])}
                  className="hidden"
                />
                <UploadCloud className="w-8 h-8 text-purple-400 mx-auto mb-2" />
                <div className="font-bold text-zinc-200">انتخاب فایل رندر نهایی</div>
                <div className="text-[11px] text-zinc-500 mt-1">همه فرمت‌های ویدیویی پشتیبانی می‌شوند</div>
              </div>
            ) : (
              <div className="p-3.5 rounded-2xl bg-zinc-950 border border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-3 overflow-hidden">
                  <FileVideo className="w-5 h-5 text-purple-400 shrink-0" />
                  <div className="min-w-0 overflow-hidden">
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

          <div>
            <label className="block font-semibold text-zinc-300 mb-1.5">
              ناظر کیفی برای بازبینی <span className="text-purple-400">*</span>
            </label>
            <div className="relative">
              <Shield className="w-4 h-4 text-amber-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                required
                disabled={uploadProgress !== null || isLoadingSupervisors}
                value={supervisorId}
                onChange={(e) => { setSupervisorId(Number(e.target.value)); setError(null); }}
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500 rounded-xl pr-10 pl-3.5 py-2.5 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all disabled:opacity-50"
              >
                {isLoadingSupervisors && <option value="">در حال بارگذاری ناظران...</option>}
                {!isLoadingSupervisors && supervisors.length === 0 && (
                  <option value="">هیچ ناظر فعالی یافت نشد</option>
                )}
                {supervisors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.displayName} (@{s.username})
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">
              این کات فقط در پنل ناظر انتخاب‌شده و مدیرکل دیده می‌شود.
            </p>
          </div>

          {uploadProgress !== null && (
            <div className="p-4 rounded-2xl bg-purple-950/20 border border-purple-500/30 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-200 font-medium">
                  {isPublishing ? 'جایگزینی انجام شد! نسخه ادیت‌شده برای ناظر ارسال شد.' : 'در حال ارسال نسخه ادیت‌شده...'}
                </span>
                <span className="font-mono text-purple-400 font-bold">{uploadProgress}%</span>
              </div>
              <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-purple-600 h-full rounded-full transition-all duration-200"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              {isPublishing && (
                <p className="text-[11px] text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  ناظر کیفی انتخاب‌شده در جریان انتشار قرار گرفت.
                </p>
              )}
            </div>
          )}

          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              disabled={uploadProgress !== null}
              className="px-4 py-2 text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={!file || !supervisorId || uploadProgress !== null}
              className="px-5 py-2.5 font-bold rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 transition-all shadow-lg shadow-amber-950/40 disabled:opacity-50 flex items-center gap-2"
            >
              {uploadProgress !== null ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <UploadCloud className="w-4 h-4" />
              )}
              {uploadProgress !== null ? 'در حال انتشار...' : 'انتشار نسخه ادیت‌شده برای ناظر'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
