import React, { useState, useEffect } from 'react';
import { Video, ProjectFolder } from '../types/index.ts';
import { api } from '../api/client.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { VideoCard } from '../components/VideoCard.tsx';
import { ProjectFolderGrid, ProjectFolderBar } from '../components/ProjectFolders.tsx';
import { UploadModal } from '../components/UploadModal.tsx';
import { NewVersionModal } from '../components/NewVersionModal.tsx';
import { cachedLoad, folderCacheKey, videosCacheKey, invalidateProjectCache } from '../api/projectCache.ts';
import {
  UploadCloud,
  Film,
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  AlertTriangle,
  ArrowLeft,
  Trash2,
} from 'lucide-react';

interface EditorDashboardProps {
  onWatchVideo: (video: Video) => void;
  onViewDetails: (video: Video) => void;
  activeFilter?: string;
}

export const EditorDashboard: React.FC<EditorDashboardProps> = ({
  onWatchVideo,
  onViewDetails,
  activeFilter = 'all',
}) => {
  const { user } = useAuth();
  const [folders, setFolders] = useState<ProjectFolder[]>([]);
  const [isFoldersLoading, setIsFoldersLoading] = useState(true);
  const [foldersError, setFoldersError] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<ProjectFolder | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTab, setCurrentTab] = useState<string>(activeFilter);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [revisionVideo, setRevisionVideo] = useState<Video | null>(null);
  const [videoToDelete, setVideoToDelete] = useState<Video | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setCurrentTab(activeFilter);
  }, [activeFilter]);

  /** فقط فهرست سبک پوشه‌ها در ورود به پنل گرفته می‌شود؛ هیچ ویدیویی قبل از ورود به پوشه واکشی نمی‌شود. */
  const fetchFolders = async (force = false) => {
    if (!user) return;
    setIsFoldersLoading(true);
    setFoldersError(null);
    try {
      const data = await cachedLoad(folderCacheKey(user.id, user.role), () => api.getProjectFolders(), force);
      setFolders(data);
      // شمارش‌های پوشه باز را هم تازه نگه می‌داریم تا بعد از آپلود/حذف ناهماهنگ نشود.
      setActiveFolder((current) => current ? data.find((folder) => folder.projectId === current.projectId) ?? null : null);
    } catch (err: any) {
      console.error('Failed to load editor project folders:', err);
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
      console.error('Failed to load editor videos:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
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
    fetchFolders(true);
    if (activeFolder) fetchVideos(activeFolder, true);
  };

  const refreshAfterMutation = () => {
    invalidateProjectCache();
    fetchFolders(true);
    if (activeFolder) fetchVideos(activeFolder, true);
  };

  const filteredVideos = videos.filter((v) => {
    if (currentTab === 'pending' || currentTab === 'pending-review') return v.status === 'PendingReview';
    if (currentTab === 'approved') return v.status === 'Approved';
    if (currentTab === 'rejected') return v.status === 'Rejected';
    return true;
  });

  // شمارش‌ها از تجمیع پوشه‌ها می‌آید تا بدون واکشی همه ویدیوها هم دقیق باشد.
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
  const totalCount = scopeCounts.videoCount;
  const pendingCount = scopeCounts.pendingCount;
  const approvedCount = scopeCounts.approvedCount;
  const rejectedCount = scopeCounts.rejectedCount;

  return (
    <div className="space-y-6" dir="rtl">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2.5">
            <span>میز کار تدوین‌گر ویدیو</span>
            <span className="text-xs font-mono font-semibold px-2.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30">
              پروژه‌ها و نسخه‌ها
            </span>
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            بارگذاری کات‌های جدید، پیگیری وضعیت بازبینی توسط ناظر کیفی و ارسال نسخه‌های اصلاح‌شده.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={refreshAll}
            className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 text-xs flex items-center gap-1.5 transition-colors"
            title="بروزرسانی لیست"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading || isFoldersLoading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => setIsUploadOpen(true)}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs sm:text-sm font-bold shadow-lg shadow-purple-950/50 flex items-center gap-2 transition-all"
          >
            <UploadCloud className="w-4 h-4" />
            بارگذاری ویدیو جدید
          </button>
        </div>
      </div>

      {/* Editor Statistics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button
          onClick={() => setCurrentTab('all')}
          className={`p-4 rounded-2xl border text-right transition-all ${
            currentTab === 'all'
              ? 'bg-zinc-900 border-purple-500 shadow-md shadow-purple-950/30'
              : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700'
          }`}
        >
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-1">
            <span>کل ویدیوهای من</span>
            <Film className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-zinc-100">{totalCount}</div>
        </button>

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
            <span>تایید شده توسط ناظر</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-400">{approvedCount}</div>
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
            <span>نیازمند اصلاحات</span>
            <XCircle className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-rose-400">{rejectedCount}</div>
        </button>
      </div>

      {!activeFolder ? (
        <ProjectFolderGrid
          folders={folders}
          isLoading={isFoldersLoading}
          error={foldersError}
          onOpen={openFolder}
          onRetry={() => fetchFolders(true)}
          title="پوشه پروژه‌های من"
        />
      ) : (
        <>
      <ProjectFolderBar folder={activeFolder} onBack={closeFolder} loadedCount={isLoading ? undefined : videos.length} />

      {/* Tabs Navigation */}
      <div className="flex items-center gap-1.5 border-b border-zinc-800 pb-2 text-xs font-semibold">
        <button
          onClick={() => setCurrentTab('all')}
          className={`px-3 py-1.5 rounded-lg transition-colors ${
            currentTab === 'all'
              ? 'bg-zinc-800 text-white'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
          }`}
        >
          همه ویدیوهای من ({totalCount})
        </button>
        <button
          onClick={() => setCurrentTab('pending')}
          className={`px-3 py-1.5 rounded-lg transition-colors ${
            currentTab === 'pending'
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
          }`}
        >
          در انتظار بازبینی ({pendingCount})
        </button>
        <button
          onClick={() => setCurrentTab('approved')}
          className={`px-3 py-1.5 rounded-lg transition-colors ${
            currentTab === 'approved'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
          }`}
        >
          تایید شده ({approvedCount})
        </button>
        <button
          onClick={() => setCurrentTab('rejected')}
          className={`px-3 py-1.5 rounded-lg transition-colors ${
            currentTab === 'rejected'
              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
          }`}
        >
          رد شده و نیازمند اصلاح ({rejectedCount})
        </button>
      </div>

      {/* Rejection Alert Banner */}
      {rejectedCount > 0 && currentTab !== 'approved' && (
        <div className="p-4 rounded-2xl bg-rose-950/25 border border-rose-500/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-rose-300">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-rose-200">
                شما {rejectedCount} پروژه دارید که توسط ناظر کیفی رد شده و نیازمند بازبینی است.
              </span>
              <p className="text-rose-400/80 mt-0.5">
                توضیحات و بازخورد ناظر را مطالعه نموده و پس از اعمال تغییرات، دکمه "بارگذاری نسخه جدید" را انتخاب نمایید.
              </p>
            </div>
          </div>
          <button
            onClick={() => setCurrentTab('rejected')}
            className="px-3.5 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 font-bold flex items-center gap-1 shrink-0 transition-colors"
          >
            <span>مشاهده کات‌های رد شده</span>
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Videos Grid */}
      {isLoading ? (
        <div className="py-20 text-center text-zinc-500 text-sm">در حال بارگذاری پروژه‌های ویدیویی شما...</div>
      ) : filteredVideos.length === 0 ? (
        <div className="py-16 text-center bg-zinc-900/50 border border-zinc-800 rounded-2xl">
          <Film className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-zinc-300">هیچ ویدیویی در این دسته‌بندی یافت نشد</h3>
          <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto mb-4">
            کات‌های تدوین خود را بارگذاری کنید تا بررسی ناظر کیفی آغاز شود.
          </p>
          <button
            onClick={() => setIsUploadOpen(true)}
            className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold inline-flex items-center gap-2 shadow-lg"
          >
            <UploadCloud className="w-4 h-4" />
            بارگذاری ویدیو
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredVideos.map((v) => (
            <VideoCard
              key={v.id}
              video={v}
              onWatch={onWatchVideo}
              onViewDetails={onViewDetails}
              onUploadNewVersion={(vid) => setRevisionVideo(vid)}
              onDelete={(vid) => setVideoToDelete(vid)}
            />
          ))}
        </div>
      )}
        </>
      )}

      {/* Upload Modal */}
      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onSuccess={(newVid) => {
          if (activeFolder && newVid.projectId === activeFolder.projectId) {
            setVideos((prev) => [newVid, ...prev]);
          }
          refreshAfterMutation();
        }}
      />

      {/* Revision Modal */}
      {revisionVideo && (
        <NewVersionModal
          video={revisionVideo}
          isOpen={Boolean(revisionVideo)}
          onClose={() => setRevisionVideo(null)}
          onSuccess={(revisedVid) => {
            setVideos((prev) => [revisedVid, ...prev.filter((v) => v.id !== revisedVid.id)]);
            setRevisionVideo(null);
            refreshAfterMutation();
          }}
        />
      )}

      {/* Delete Confirmation Modal for Editor */}
      {videoToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-zinc-900 border border-rose-500/30 rounded-3xl p-6 shadow-2xl space-y-4 text-right">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-white">حذف ویدیو</h3>
                <p className="text-xs text-zinc-400 font-mono break-all" dir="ltr">{videoToDelete.originalFilename}</p>
              </div>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              آیا از حذف ویدیوی <strong>«{videoToDelete.title}»</strong> اطمینان دارید؟ تمام نسخه‌ها و فایل‌های این ویدیو حذف خواهند شد.
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
                  } catch (err: any) {
                    alert(err.message || 'خطا در حذف ویدیو.');
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
