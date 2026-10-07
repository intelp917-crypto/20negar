import React, { useState, useEffect } from 'react';
import { Video, User } from '../types/index.ts';
import { api } from '../api/client.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { VideoPlayer } from '../components/VideoPlayer.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { DownloadMenu } from '../components/DownloadMenu.tsx';
import { ReviewModal } from '../components/ReviewModal.tsx';
import { NewVersionModal } from '../components/NewVersionModal.tsx';
import {
  ArrowRight,
  Calendar,
  Clock,
  User as UserIcon,
  Shield,
  Layers,
  HardDrive,
  CheckCircle2,
  XCircle,
  MessageSquare,
  AlertTriangle,
  UploadCloud,
  Trash2,
} from 'lucide-react';

interface VideoDetailsPageProps {
  videoId: number;
  onBack: () => void;
  onSelectVideo?: (id: number) => void;
}

export const VideoDetailsPage: React.FC<VideoDetailsPageProps> = ({
  videoId,
  onBack,
}) => {
  const { user, isSupervisor, isEditor, isAdmin, isSuperAdmin } = useAuth();
  const [video, setVideo] = useState<Video | null>(null);
  const [editors, setEditors] = useState<User[]>([]);
  const [supervisors, setSupervisors] = useState<User[]>([]);
  const [admins, setAdmins] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reviewModalState, setReviewModalState] = useState<{
    isOpen: boolean;
    mode: 'approve' | 'reject';
  }>({ isOpen: false, mode: 'approve' });

  const [isNewVersionOpen, setIsNewVersionOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchVideo = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getVideoById(videoId);
      setVideo(data);

      const [edList, spList, adList] = await Promise.all([
        api.getEditors(),
        api.getSupervisors(),
        (user?.role === 'SuperAdmin' || user?.role === 'Supervisor') ? api.getAdmins() : Promise.resolve([]),
      ]);
      setEditors(edList);
      setSupervisors(spList);
      setAdmins(adList);
    } catch (err: any) {
      setError(err.message || 'خطا در بارگذاری مشخصات ویدیو.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchVideo();
  }, [videoId]);

  const handleSupervisorChange = async (newSupervisorId: number) => {
    if (!video) return;
    try {
      const updated = await api.assignSupervisor(video.id, newSupervisorId);
      setVideo(updated);
      alert('ناظر کیفی پروژه با موفقیت تغییر کرد.');
    } catch (err: any) {
      alert(err.message || 'خطا در تخصیص سرپرست.');
    }
  };

  const handleAdminChange = async (newAdminId: number) => {
    if (!video) return;
    try {
      const updated = await api.assignAdmin(video.id, newAdminId > 0 ? newAdminId : null);
      setVideo(updated);
      alert('ادمین مقصد ویدیو با موفقیت تعیین شد.');
    } catch (err: any) {
      alert(err.message || 'خطا در انتساب ادمین.');
    }
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '0 مگابایت';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(2)} گیگابایت`;
    }
    return `${mb.toFixed(1)} مگابایت`;
  };

  const formatDuration = (seconds: number) => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (isLoading) {
    return (
      <div className="py-24 text-center text-zinc-500 text-sm">
        در حال استخراج متادیتا، استریم مدیا و مشخصات پروژه...
      </div>
    );
  }

  if (error || !video) {
    return (
      <div className="py-16 text-center bg-zinc-900/50 border border-zinc-800 rounded-3xl max-w-lg mx-auto" dir="rtl">
        <AlertTriangle className="w-12 h-12 text-rose-400 mx-auto mb-3" />
        <h3 className="text-base font-bold text-zinc-200">عدم دسترسی به ویدیو</h3>
        <p className="text-xs text-zinc-400 mt-1 mb-4">{error || 'ویدیو یافت نشد یا دسترسی مجاز نیست.'}</p>
        <button
          onClick={onBack}
          className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold"
        >
          بازگشت به پیشخوان
        </button>
      </div>
    );
  }

  const isAssignedSupervisor = isSupervisor && video.supervisorId === user?.id;
  const isOwnerEditor = isEditor && video.editorId === user?.id;
  const canDelete = isSuperAdmin || isOwnerEditor || isSupervisor;

  const handleDeleteVideo = async () => {
    if (!video) return;
    setIsDeleting(true);
    try {
      await api.deleteVideo(video.id);
      setIsDeleteConfirmOpen(false);
      onBack();
    } catch (err: any) {
      alert(err.message || 'خطا در حذف ویدیو.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto" dir="rtl">
      {/* Top Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs font-bold text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowRight className="w-4 h-4" />
          <span>بازگشت به پیشخوان</span>
        </button>

        <div className="flex items-center gap-2">
          {canDelete && (
            <button
              onClick={() => setIsDeleteConfirmOpen(true)}
              className="py-2 px-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-bold transition-all flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>حذف ویدیو</span>
            </button>
          )}
          <DownloadMenu video={video} variant="primary" />
        </div>
      </div>

      {/* Main Grid: Player on left/top, Info & Actions on right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Player & Transcoding Pipeline (2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-2 sm:p-3 shadow-xl">
            <VideoPlayer
              videoId={video.id}
              title={video.title}
              qualities={video.qualities}
              posterUrl={video.thumbnailPath ? api.getThumbnailUrl(video.id) : undefined}
              autoPlay={true}
            />
          </div>

          {/* Supervisor & SuperAdmin Decision Station */}
          {(isAssignedSupervisor || isAdmin || isSuperAdmin) && video.status === 'PendingReview' && (
            <div className="p-6 rounded-3xl bg-zinc-900 border border-amber-500/30 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-amber-400 text-sm font-bold">
                  <Shield className="w-4 h-4" />
                  <span>ایستگاه تصمیم‌گیری و ثبت نظر ناظر کیفی</span>
                </div>
                <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  نیازمند تایید یا رد
                </span>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed">
                کیفیت تصویر، سینک صدا و ریتم تدوین را در پلیر بالا بررسی کنید. با تایید پروژه، ویدیو به آرشیو خروجی ادمین ارسال خواهد شد. در صورت رد، ثبت توضیحات نقایص الزامی است.
              </p>
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => setReviewModalState({ isOpen: true, mode: 'approve' })}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50 transition-all"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  تایید و ترخیص ویدیو
                </button>
                <button
                  onClick={() => setReviewModalState({ isOpen: true, mode: 'reject' })}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-rose-950/50 transition-all"
                >
                  <XCircle className="w-4 h-4" />
                  رد با توضیحات اصلاحی
                </button>
              </div>
            </div>
          )}

          {/* Editor Action if Rejected */}
          {isOwnerEditor && video.status === 'Rejected' && (
            <div className="p-6 rounded-3xl bg-rose-950/20 border border-rose-500/30 space-y-3">
              <div className="flex items-center gap-2 text-rose-400 text-sm font-bold">
                <AlertTriangle className="w-4 h-4" />
                <span>اصلاحات مورد نیاز ناظر کیفی</span>
              </div>
              <div className="p-3.5 rounded-2xl bg-zinc-950 border border-rose-900/40 text-xs text-rose-200">
                <strong>توضیحات رد پروژه:</strong> "{video.rejectionReason}"
              </div>
              <button
                onClick={() => setIsNewVersionOpen(true)}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-all"
              >
                <UploadCloud className="w-4 h-4" />
                بارگذاری نسخه جدید (نسخه {video.versionNumber + 1})
              </button>
            </div>
          )}

          {/* Review History */}
          {video.reviews && video.reviews.length > 0 && (
            <div className="p-6 rounded-3xl bg-zinc-900 border border-zinc-800 shadow-sm space-y-3">
              <h4 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-purple-400" />
                <span>تاریخچه بازبینی‌ها و نظرات ناظران</span>
              </h4>
              <div className="space-y-3 divide-y divide-zinc-800/80">
                {video.reviews.map((rev) => (
                  <div key={rev.id} className="pt-3 first:pt-0 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        {rev.action === 'Approved' ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400 font-bold">
                            <CheckCircle2 className="w-3.5 h-3.5" /> تایید شده
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-rose-400 font-bold">
                            <XCircle className="w-3.5 h-3.5" /> رد شده
                          </span>
                        )}
                        <span className="text-zinc-400">توسط {rev.supervisorName}</span>
                      </div>
                      <span className="text-[10px] font-mono text-zinc-500">
                        {new Date(rev.createdAt).toLocaleString('fa-IR')}
                      </span>
                    </div>
                    <p className="text-zinc-300 italic bg-zinc-950/60 p-3 rounded-xl border border-zinc-800/60 mt-1 leading-relaxed">
                      "{rev.comment}"
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Metadata & Staff Assignment */}
        <div className="space-y-6">
          <div className="p-6 rounded-3xl bg-zinc-900 border border-zinc-800 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-2 pb-3 border-b border-zinc-800">
              <div>
                <h3 className="text-base font-bold text-white tracking-tight">{video.title}</h3>
                <div className="text-xs text-zinc-500 font-mono mt-0.5" dir="ltr">{video.originalFilename}</div>
              </div>
              <StatusBadge status={video.status} />
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">نسخه پروژه:</span>
              <span className="px-2.5 py-0.5 rounded-md bg-purple-500/20 text-purple-300 font-mono font-bold">
                نسخه {video.versionNumber}
              </span>
            </div>

            {/* Spec Details */}
            <div className="space-y-2.5 text-xs text-zinc-300 divide-y divide-zinc-800/60">
              <div className="flex items-center justify-between pt-2">
                <span className="text-zinc-500 flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5" /> زمان ویدیو:
                </span>
                <span className="font-mono font-medium">{formatDuration(video.duration)}</span>
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-zinc-500 flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5" /> رزولوشن منبع:
                </span>
                <span className="font-mono font-medium">{video.originalResolution || '1280x720 (720p)'}</span>
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-zinc-500 flex items-center gap-2">
                  <HardDrive className="w-3.5 h-3.5" /> حجم فایل منبع:
                </span>
                <span className="font-mono font-medium">{formatFileSize(video.fileSize)}</span>
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-zinc-500 flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5" /> تاریخ بارگذاری:
                </span>
                <span className="font-mono font-medium text-zinc-400">
                  {new Date(video.createdAt).toLocaleDateString('fa-IR')}
                </span>
              </div>

              {video.approvedAt && (
                <div className="flex items-center justify-between pt-2 text-emerald-400">
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5" /> تاریخ تایید:
                  </span>
                  <span className="font-mono font-medium">
                    {new Date(video.approvedAt).toLocaleDateString('fa-IR')}
                  </span>
                </div>
              )}

              {video.rejectedAt && (
                <div className="flex items-center justify-between pt-2 text-rose-400">
                  <span className="flex items-center gap-2">
                    <XCircle className="w-3.5 h-3.5" /> تاریخ رد:
                  </span>
                  <span className="font-mono font-medium">
                    {new Date(video.rejectedAt).toLocaleDateString('fa-IR')}
                  </span>
                </div>
              )}
            </div>

            {/* Assignments Section */}
            <div className="pt-3 border-t border-zinc-800 space-y-3">
              <h4 className="text-xs font-bold uppercase text-zinc-400 tracking-wider">
                انتساب و مسئولیت‌های پروژه
              </h4>

              {/* Editor Assignment (ثابت و غیرقابل تغییر) */}
              <div className="p-3 rounded-2xl bg-zinc-950 border border-zinc-800 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span className="flex items-center gap-1.5">
                    <UserIcon className="w-3.5 h-3.5 text-sky-400" /> تدوین‌گر پروژه:
                  </span>
                </div>
                <div className="text-xs font-bold text-zinc-200">{video.editorName}</div>
              </div>

              {/* Supervisor Assignment */}
              <div className="p-3 rounded-2xl bg-zinc-950 border border-zinc-800 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span className="flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-amber-400" /> ناظر کیفی:
                  </span>
                  {(isOwnerEditor || isAdmin || isSuperAdmin) && (
                    <span className="text-[10px] text-purple-400">قابلیت تغییر</span>
                  )}
                </div>

                {isOwnerEditor || isAdmin || isSuperAdmin ? (
                  <select
                    value={video.supervisorId}
                    onChange={(e) => handleSupervisorChange(Number(e.target.value))}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-purple-500"
                  >
                    {supervisors.map((sp) => (
                      <option key={sp.id} value={sp.id}>
                        {sp.displayName} (@{sp.username})
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="text-xs font-bold text-zinc-200">{video.supervisorName}</div>
                )}
              </div>

              {/* Admin Destination Assignment (مدیرکل یا ناظر کیفی) */}
              {(isSuperAdmin || isSupervisor) && (
                <div className="p-3 rounded-2xl bg-zinc-950 border border-purple-500/30 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span className="flex items-center gap-1.5">
                      <UserIcon className="w-3.5 h-3.5 text-purple-400" /> ادمین مقصد (پنل نمایش):
                    </span>
                    <span className="text-[10px] text-purple-400">فقط در پنل همین ادمین دیده می‌شود</span>
                  </div>

                  <select
                    value={video.adminId ?? 0}
                    onChange={(e) => handleAdminChange(Number(e.target.value))}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-purple-500"
                  >
                    <option value={0}>بدون ادمین (فقط در آرشیو مدیرکل)</option>
                    {admins.map((ad) => (
                      <option key={ad.id} value={ad.id}>
                        {ad.displayName} (@{ad.username})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* نمایش ادمین مقصد برای سایر نقش‌ها */}
              {!(isSuperAdmin || isSupervisor) && (
                <div className="p-3 rounded-2xl bg-zinc-950 border border-zinc-800 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span className="flex items-center gap-1.5">
                      <UserIcon className="w-3.5 h-3.5 text-purple-400" /> ادمین مسئول:
                    </span>
                  </div>
                  <div className="text-xs font-bold text-zinc-200">
                    {video.adminName || 'تعیین نشده (فقط در آرشیو مدیرکل)'}
                  </div>
                </div>
              )}
            </div>

            {/* Available Downloads */}
            <div className="pt-3 border-t border-zinc-800">
              <h4 className="text-xs font-bold uppercase text-zinc-400 tracking-wider mb-2.5">
                دانلود کیفیت‌های تولید شده
              </h4>
              <div className="space-y-1.5">
                <a
                  href={api.getDownloadUrl(video.id, 'Original')}
                  download
                  className="w-full flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 text-xs text-zinc-300 transition-colors border border-zinc-800/80"
                >
                  <span className="font-semibold">نسخه اصلی Master Cut</span>
                  <span className="text-[10px] font-mono text-zinc-500">{formatFileSize(video.fileSize)}</span>
                </a>

                {video.qualities?.filter((q) => q.quality !== 'Original').map((q) => (
                  <a
                    key={q.id}
                    href={api.getDownloadUrl(video.id, q.quality)}
                    download
                    className="w-full flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 text-xs text-zinc-300 transition-colors border border-zinc-800/80"
                  >
                    <span className="font-semibold">کیفیت {q.quality} ({q.width}×{q.height})</span>
                    <span className="text-[10px] font-mono text-purple-400">{formatFileSize(q.fileSize)}</span>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Review Modal */}
      <ReviewModal
        video={video}
        mode={reviewModalState.mode}
        isOpen={reviewModalState.isOpen}
        onClose={() => setReviewModalState({ isOpen: false, mode: 'approve' })}
        onSuccess={(updated) => {
          setVideo(updated);
        }}
      />

      {/* New Version Revision Modal */}
      <NewVersionModal
        video={video}
        isOpen={isNewVersionOpen}
        onClose={() => setIsNewVersionOpen(false)}
        onSuccess={(newVer) => {
          setVideo(newVer);
          setIsNewVersionOpen(false);
        }}
      />

      {/* Delete Confirmation Modal */}
      {isDeleteConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-zinc-900 border border-rose-500/30 rounded-3xl p-6 shadow-2xl space-y-4 text-right">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">حذف کامل ویدیو از سامانه</h3>
                <p className="text-xs text-zinc-400 font-mono" dir="ltr">{video.originalFilename}</p>
              </div>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              آیا از حذف ویدیوی <strong>«{video.title}»</strong> اطمینان دارید؟ تمامی فایل‌های اصلی، نسخه‌های تبدیل‌شده و سوابق بازبینی این ویدیو برای همیشه پاک خواهند شد و این عملیات قابل بازگشت نیست.
            </p>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setIsDeleteConfirmOpen(false)}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-800 transition-colors"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={handleDeleteVideo}
                disabled={isDeleting}
                className="px-5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 rounded-xl shadow-lg shadow-rose-950/50 transition-colors disabled:opacity-50"
              >
                {isDeleting ? 'در حال حذف...' : 'تایید و حذف دائمی'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
