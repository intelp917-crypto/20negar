import React, { useState, useEffect, useRef } from 'react';
import { X, CheckCircle2, XCircle, AlertTriangle, UserCheck, Mic, Square, Trash2 } from 'lucide-react';
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
  const [voice, setVoice] = useState<Blob | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

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

  useEffect(() => () => { if (voiceUrl) URL.revokeObjectURL(voiceUrl); }, [voiceUrl]);

  if (!isOpen) return null;

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setVoice(blob);
        setVoiceUrl(URL.createObjectURL(blob));
      };
      recorder.start();
      recorderRef.current = recorder;
      setIsRecording(true);
    } catch { setError('دسترسی به میکروفون ممکن نشد. اجازه میکروفون مرورگر را فعال کنید.'); }
  };

  const stopRecording = () => { recorderRef.current?.stop(); recorderRef.current = null; setIsRecording(false); };
  const clearVoice = () => { if (voiceUrl) URL.revokeObjectURL(voiceUrl); setVoice(null); setVoiceUrl(null); };

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
         updated = await api.approveVideo(video.id, comment.trim() || undefined, targetAdmin, voice);
      } else {
         updated = await api.rejectVideo(video.id, comment.trim(), voice);
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
              className="w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500 rounded-xl p-3 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all resize-none leading-relaxed"
            />
          </div>

          <div className="rounded-2xl bg-zinc-950 border border-zinc-800 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-zinc-300 font-semibold">پیام صوتی ناظر (اختیاری)</label>
              {!voice && !isRecording && <button type="button" onClick={startRecording} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold"><Mic className="w-4 h-4" /> ضبط ویس</button>}
              {isRecording && <button type="button" onClick={stopRecording} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-800 text-rose-300 border border-rose-500/40 font-bold"><Square className="w-3.5 h-3.5 fill-current" /> توقف ضبط</button>}
            </div>
            {voiceUrl && !isRecording && <div className="flex items-center gap-2"><audio controls src={voiceUrl} className="h-9 flex-1" /><button type="button" onClick={clearVoice} aria-label="حذف ویس" className="p-2 rounded-lg text-zinc-400 hover:text-rose-300"><Trash2 className="w-4 h-4" /></button></div>}
            <p className="text-[10px] text-zinc-500">ضبط صدا مانند پیام صوتی انجام می‌شود و همراه توضیحات برای تدوین‌گر ارسال خواهد شد.</p>
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
