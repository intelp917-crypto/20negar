import React, { useState, useEffect } from 'react';
import { X, CheckCircle2, XCircle, AlertTriangle, UserCheck } from 'lucide-react';
import { Video, User } from '../types/index.ts';
import { api } from '../api/client.ts';

interface ReviewModalProps {
  video: Video;
  mode: 'approve' | 'reject';
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedVideo: Video) => void;
}

export const ReviewModal: React.FC<ReviewModalProps> = ({
  video,
  mode,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [comment, setComment] = useState('');
  const [selectedAdminId, setSelectedAdminId] = useState<string>(video.adminId ? String(video.adminId) : '');
  const [admins, setAdmins] = useState<User[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && mode === 'approve') {
      api.getAdmins()
        .then((data) => {
          setAdmins(data);
          if (video.adminId) {
            setSelectedAdminId(String(video.adminId));
          } else if (data.length > 0 && !selectedAdminId) {
            setSelectedAdminId(String(data[0].id));
          }
        })
        .catch(() => {});
    }
  }, [isOpen, mode, video.adminId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === 'reject' && !comment.trim()) {
      setError('ثبت دلیل رد پروژه الزامی است تا تدوین‌گر بداند چه اصلاحاتی را باید اعمال کند.');
      return;
    }

    setIsSubmitting(true);
    try {
      let updated: Video;
      if (mode === 'approve') {
        const targetAdmin = selectedAdminId ? parseInt(selectedAdminId, 10) : null;
        updated = await api.approveVideo(video.id, comment.trim() || undefined, targetAdmin);
      } else {
        updated = await api.rejectVideo(video.id, comment.trim());
      }
      onSuccess(updated);
      onClose();
    } catch (err: any) {
      setError(err.message || 'عملیات با خطا مواجه شد.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-3xl shadow-2xl overflow-hidden" dir="rtl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            {mode === 'approve' ? (
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            ) : (
              <div className="w-9 h-9 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center">
                <XCircle className="w-5 h-5" />
              </div>
            )}
            <div>
              <h3 className="text-base font-bold text-zinc-100">
                {mode === 'approve' ? 'تایید و ترخیص ویدیوی پروژه' : 'رد ویدیو و درخواست اصلاحات'}
              </h3>
              <p className="text-xs text-zinc-400">{video.title}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {mode === 'approve' ? (
            <>
              <p className="text-sm text-zinc-300 leading-relaxed">
                با تایید این ویدیو، پروژه به بخش <strong>ویدیوهای تایید شده</strong> منتقل شده و اختصاصاً در پنل ادمین انتخابی نمایش داده خواهد شد.
              </p>

              <div className="p-3.5 rounded-2xl bg-zinc-950 border border-purple-500/30 space-y-2">
                <label className="flex items-center gap-2 text-xs font-bold text-zinc-200">
                  <UserCheck className="w-4 h-4 text-purple-400" />
                  <span>انتخاب ادمین مقصد (نمایش اختصاصی در پنل ادمین):</span>
                </label>
                <select
                  value={selectedAdminId}
                  onChange={(e) => setSelectedAdminId(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-700 focus:border-purple-500 rounded-xl px-3 py-2 text-xs text-zinc-100 focus:outline-none"
                >
                  <option value="">بدون ادمین (فقط در آرشیو مدیرکل)</option>
                  {admins.map((ad) => (
                    <option key={ad.id} value={ad.id}>
                      {ad.displayName} (@{ad.username})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-zinc-400">
                  پروژه پس از تایید، فقط در پنل این ادمین و پنل مدیرکل قابل مشاهده خواهد بود.
                </p>
              </div>
            </>
          ) : (
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <strong>قانون اجباری ناظر کیفی:</strong> لطفا مشخصات دقیق نقایص را ذکر کنید (مثلا: هماهنگی صدا در ثانیه ۲، اصلاح رنگ سکانس پایانی یا ریتم کات‌ها).
              </div>
            </div>
          )}

          <div>
            <label className="block text-zinc-300 font-semibold mb-1.5">
              {mode === 'approve' ? 'یادداشت یا توضیحات تایید (اختیاری)' : 'دلیل رد ویدیو و توضیحات اصلاح (الزامی)'}
            </label>
            <textarea
              rows={4}
              required={mode === 'reject'}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={
                mode === 'approve'
                  ? 'مثال: رنگ، نور و تطابق صدا بررسی شد. کیفیت کار بی‌نقص است.'
                  : 'مثال: صدای دیالوگ در صحنه ۳ دچار نویز است و سکانس آخر باید کوتاه‌تر شود.'
              }
              className="w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500 rounded-xl p-3 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all resize-none leading-relaxed"
            />
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-800 transition-colors"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`px-5 py-2.5 font-bold rounded-xl text-white transition-all shadow-lg flex items-center gap-2 ${
                mode === 'approve'
                  ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-950/50'
                  : 'bg-rose-600 hover:bg-rose-500 shadow-rose-950/50'
              }`}
            >
              {isSubmitting ? (
                'در حال ثبت...'
              ) : mode === 'approve' ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>تایید نهایی ویدیو</span>
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4" />
                  <span>رد ویدیو و ارسال بازخورد</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
