import React, { useState, useEffect } from 'react';
import { Video, User, ProjectFolder } from '../types/index.ts';
import { api } from '../api/client.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import { VideoCard } from '../components/VideoCard.tsx';
import { ProjectFolderGrid, ProjectFolderBar } from '../components/ProjectFolders.tsx';
import { cachedLoad, folderCacheKey, videosCacheKey, invalidateProjectCache } from '../api/projectCache.ts';
import { ReviewModal } from '../components/ReviewModal.tsx';
import {
  Shield,
  Clock,
  CheckCircle2,
  XCircle,
  FolderGit2,
  RefreshCw,
  User as UserIcon,
  UserCheck,
  Trash2,
} from 'lucide-react';

interface SupervisorDashboardProps {
  onWatchVideo: (video: Video) => void;
  onViewDetails: (video: Video) => void;
  activeFilter?: string;
}

export const SupervisorDashboard: React.FC<SupervisorDashboardProps> = ({
  onWatchVideo,
  onViewDetails,
  activeFilter = 'pending',
}) => {
  const toast = useToast();
  const { user } = useAuth();
  const [folders, setFolders] = useState<ProjectFolder[]>([]);
  const [isFoldersLoading, setIsFoldersLoading] = useState(true);
  const [foldersError, setFoldersError] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<ProjectFolder | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [admins, setAdmins] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTab, setCurrentTab] = useState<string>(activeFilter);
  const [videoToDelete, setVideoToDelete] = useState<Video | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [reviewModalState, setReviewModalState] = useState<{
    video: Video | null;
    mode: 'approve' | 'reject';
  }>({ video: null, mode: 'approve' });

  useEffect(() => {
    setCurrentTab(activeFilter);
  }, [activeFilter]);

  const fetchAdmins = async () => {
    try {
      setAdmins(await api.getAdmins());
    } catch (err) {
      console.error('Failed to load admins:', err);
    }
  };

  const fetchFolders = async (force = false) => {
    if (!user) return;
    setIsFoldersLoading(true);
    setFoldersError(null);
    try {
      const data = await cachedLoad(folderCacheKey(user.id, user.role), () => api.getProjectFolders(), force);
      setFolders(data);
      setActiveFolder((current) => current ? data.find((folder) => folder.projectId === current.projectId) ?? null : null);
    } catch (err: any) {
      console.error('Failed to load supervisor project folders:', err);
      setFoldersError(err?.message || 'خطا در دریافت پوشه‌های پروژه.');
    } finally {
      setIsFoldersLoading(false);
    }
  };

  const fetchVideos = async (folder: ProjectFolder, force = false) => {
    if (!user) return;
    setIsLoading(true);
    try {
      const key = videosCacheKey(user.id, user.role, folder.projectId);
      const data = await cachedLoad(
        key,
        () => api.getVideos({ projectId: folder.projectId === null ? 'none' : folder.projectId }),
        force
      );
      setVideos(data);
    } catch (err) {
      console.error('Failed to load supervisor videos:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAdmins();
    fetchFolders();
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (activeFolder) fetchVideos(activeFolder);
    else setVideos([]);
  }, [activeFolder?.projectId]);

  const openFolder = (folder: ProjectFolder) => {
    setActiveFolder(folder);
    setVideos([]);
  };

  const closeFolder = () => {
    setActiveFolder(null);
    setVideos([]);
    setCurrentTab(activeFilter);
  };

  const refreshAll = () => {
    invalidateProjectCache();
    fetchAdmins();
    fetchFolders(true);
    if (activeFolder) fetchVideos(activeFolder, true);
  };

  const refreshAfterMutation = () => {
    invalidateProjectCache();
    fetchFolders(true);
    if (activeFolder) fetchVideos(activeFolder, true);
  };

  const handleAdminChange = async (videoId: number, newAdminId: number) => {
    try {
      const updated = await api.assignAdmin(videoId, newAdminId > 0 ? newAdminId : null);
      setVideos((prev) => prev.map((v) => (v.id === videoId ? updated : v)));
      toast.success(newAdminId > 0 ? 'ادمین مقصد پروژه با موفقیت تعیین شد.' : 'انتساب ادمین لغو شد.');
    } catch (err: any) {
      toast.error(err.message || 'خطا در انتساب ادمین مقصد.');
    }
  };

  const filteredVideos = videos.filter((v) => {
    if (currentTab === 'pending' || currentTab === 'pending-review') return v.status === 'PendingReview';
    if (currentTab === 'approved') return v.status === 'Approved';
    if (currentTab === 'rejected') return v.status === 'Rejected';
    return true;
  });

  const scopeCounts = activeFolder
    ? activeFolder
    : folders.reduce(
        (acc, folder) => ({
          videoCount: acc.videoCount + folder.videoCount,
          pendingCount: acc.pendingCount + folder.pendingCount,
          approvedCount: acc.approvedCount + folder.approvedCount,
          rejectedCount: acc.rejectedCount + folder.rejectedCount,
        }),
        { videoCount: 0, pendingCount: 0, approvedCount: 0, rejectedCount: 0 }
      );
  const pendingCount = scopeCounts.pendingCount;
  const approvedCount = scopeCounts.approvedCount;
  const rejectedCount = scopeCounts.rejectedCount;
  const totalCount = scopeCounts.videoCount;

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2.5">
            <span>ایستگاه بازبینی ناظر کیفی و سرپرست</span>
            <span className="text-xs font-mono font-semibold px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
              کنترل کیفیت (QA)
            </span>
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            بررسی کات‌های ارسالی، مدیریت انتساب تدوین‌گر، تایید نهایی برای پنل ادمین یا رد ویدیو با ثبت دلایل دقیق.
          </p>
        </div>

        <button
          onClick={refreshAll}
          className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 text-xs flex items-center gap-1.5 transition-colors self-start sm:self-auto"
          title="بروزرسانی صف"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading || isFoldersLoading ? 'animate-spin' : ''}`} />
          <span>بروزرسانی صف</span>
        </button>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button
          onClick={() => setCurrentTab('pending')}
          className={`p-4 rounded-2xl border text-right transition-all ${
            currentTab === 'pending'
              ? 'bg-zinc-900 border-amber-500 shadow-md shadow-amber-950/30'
              : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700'
          }`}
        >
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-1">
            <span>در انتظار بازبینی</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-amber-400">{pendingCount}</div>
          <div className="text-[10px] text-zinc-500 mt-0.5">نیازمند تصمیم‌گیری شما</div>
        </button>

        <button
          onClick={() => setCurrentTab('approved')}
          className={`p-4 rounded-2xl border text-right transition-all ${
            currentTab === 'approved'
              ? 'bg-zinc-900 border-emerald-500 shadow-md shadow-emerald-950/30'
              : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700'
          }`}
        >
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-1">
            <span>تایید شده توسط من</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-400">{approvedCount}</div>
          <div className="text-[10px] text-zinc-500 mt-0.5">منتقل‌شده به آرشیو ادمین</div>
        </button>

        <button
          onClick={() => setCurrentTab('rejected')}
          className={`p-4 rounded-2xl border text-right transition-all ${
            currentTab === 'rejected'
              ? 'bg-zinc-900 border-rose-500 shadow-md shadow-rose-950/30'
              : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700'
          }`}
        >
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-1">
            <span>رد شده جهت اصلاح</span>
            <XCircle className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-rose-400">{rejectedCount}</div>
          <div className="text-[10px] text-zinc-500 mt-0.5">بازخورد به تدوین‌گر ارجاع شد</div>
        </button>

        <button
          onClick={() => setCurrentTab('all')}
          className={`p-4 rounded-2xl border text-right transition-all ${
            currentTab === 'all'
              ? 'bg-zinc-900 border-purple-500 shadow-md shadow-purple-950/30'
              : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700'
          }`}
        >
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-1">
            <span>کل پروژه‌های محوله</span>
            <FolderGit2 className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-zinc-100">{totalCount}</div>
          <div className="text-[10px] text-zinc-500 mt-0.5">همه مراحل کاری</div>
        </button>
      </div>

      {!activeFolder ? (
        <ProjectFolderGrid
          folders={folders}
          isLoading={isFoldersLoading}
          error={foldersError}
          onOpen={openFolder}
          onRetry={() => fetchFolders(true)}
          title="پوشه پروژه‌های محوله به من"
          subtitle="ویدیوهای هر پروژه داخل پوشه همان پروژه قرار دارد؛ برای بررسی وارد پوشه شوید."
        />
      ) : (
        <>
      <ProjectFolderBar folder={activeFolder} onBack={closeFolder} loadedCount={isLoading ? undefined : videos.length} />

      {/* Tabs Navigation */}
      <div className="flex items-center gap-1.5 border-b border-zinc-800 pb-2 text-xs font-semibold">
        <button
          onClick={() => setCurrentTab('pending')}
          className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            currentTab === 'pending'
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>در انتظار بازبینی ({pendingCount})</span>
        </button>

        <button
          onClick={() => setCurrentTab('approved')}
          className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            currentTab === 'approved'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>تایید شده‌ها ({approvedCount})</span>
        </button>

        <button
          onClick={() => setCurrentTab('rejected')}
          className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            currentTab === 'rejected'
              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
          }`}
        >
          <XCircle className="w-3.5 h-3.5" />
          <span>رد شده‌ها ({rejectedCount})</span>
        </button>

        <button
          onClick={() => setCurrentTab('all')}
          className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            currentTab === 'all'
              ? 'bg-zinc-800 text-white'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
          }`}
        >
          <FolderGit2 className="w-3.5 h-3.5" />
          <span>تمام پروژه‌ها ({totalCount})</span>
        </button>
      </div>

      {/* Videos List / Cards with Editor Re-Assignment capability */}
      {isLoading ? (
        <div className="py-20 text-center text-zinc-500 text-sm">در حال دریافت لیست پروژه‌های محوله...</div>
      ) : filteredVideos.length === 0 ? (
        <div className="py-16 text-center bg-zinc-900/50 border border-zinc-800 rounded-2xl">
          <Shield className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-zinc-300">هیچ ویدیویی در این بخش وجود ندارد</h3>
          <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
            {currentTab === 'pending'
              ? 'عالی است! صف بازبینی ویدیویی شما در حال حاضر خالی است.'
              : 'هیچ پروژه‌ای با این فیلتر ثبت نشده است.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredVideos.map((v) => (
            <div key={v.id} className="relative flex flex-col">
              <VideoCard
                video={v}
                onWatch={onWatchVideo}
                onViewDetails={onViewDetails}
                showSupervisorActions={true}
                onQuickReview={(vid) => setReviewModalState({ video: vid, mode: 'approve' })}
                onDelete={(vid) => setVideoToDelete(vid)}
              />

              {/* انتخاب ادمین مقصد در پنل ناظر کیفی */}
              <div className="mt-2 p-2.5 rounded-2xl bg-zinc-900/90 border border-purple-500/30 text-xs flex items-center justify-between">
                <span className="text-zinc-300 flex items-center gap-1.5 font-medium">
                  <UserCheck className="w-3.5 h-3.5 text-purple-400" />
                  <span>ادمین مقصد:</span>
                </span>
                <select
                  value={v.adminId ?? 0}
                  onChange={(e) => handleAdminChange(v.id, Number(e.target.value))}
                  className="bg-zinc-950 border border-zinc-800 focus:border-purple-500 rounded-lg px-2 py-1 text-zinc-200 text-xs focus:outline-none"
                >
                  <option value={0}>بدون ادمین (فقط مدیرکل)</option>
                  {admins.map((ad) => (
                    <option key={ad.id} value={ad.id}>
                      {ad.displayName} (@{ad.username})
                    </option>
                  ))}
                </select>
              </div>

              {/* Quick Decision Action Bar for Pending Review */}
              {v.status === 'PendingReview' && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setReviewModalState({ video: v, mode: 'approve' })}
                    className="py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-emerald-950/40 transition-colors"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    تایید ویدیو
                  </button>
                  <button
                    onClick={() => setReviewModalState({ video: v, mode: 'reject' })}
                    className="py-2 px-3 rounded-xl bg-rose-600/90 hover:bg-rose-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-rose-950/40 transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    رد با توضیحات
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
        </>
      )}

      {/* Review Modal */}
      {reviewModalState.video && (
        <ReviewModal
          video={reviewModalState.video}
          mode={reviewModalState.mode}
          isOpen={Boolean(reviewModalState.video)}
          onClose={() => setReviewModalState({ video: null, mode: 'approve' })}
          onSuccess={(updated) => {
            setVideos((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
            setReviewModalState({ video: null, mode: 'approve' });
            refreshAfterMutation();
          }}
        />
      )}

      {/* Delete Confirmation Modal for Supervisor */}
      {videoToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-zinc-900 border border-rose-500/30 rounded-3xl p-6 shadow-2xl space-y-4 text-right">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">حذف ویدیو</h3>
                <p className="text-xs text-zinc-400 font-mono" dir="ltr">{videoToDelete.originalFilename}</p>
              </div>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              آیا از حذف ویدیوی <strong>«{videoToDelete.title}»</strong> اطمینان دارید؟ تمام فایل‌ها و سوابق این پروژه به صورت کامل پاک خواهند شد.
            </p>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setVideoToDelete(null)}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-800 transition-colors"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!videoToDelete) return;
                  setIsDeleting(true);
                  try {
                    await api.deleteVideo(videoToDelete.id);
                    setVideos((prev) => prev.filter((v) => v.id !== videoToDelete.id));
                    setVideoToDelete(null);
                    refreshAfterMutation();
                    toast.success('ویدیو با موفقیت حذف گردید.');
                  } catch (err: any) {
                    toast.error(err.message || 'خطا در حذف ویدیو.');
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                disabled={isDeleting}
                className="px-5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 rounded-xl shadow-lg shadow-rose-950/50 transition-colors disabled:opacity-50"
              >
                {isDeleting ? 'در حال حذف...' : 'تایید و حذف'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
