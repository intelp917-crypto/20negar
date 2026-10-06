import React, { useState, useEffect } from 'react';
import { Video, User } from '../types/index.ts';
import { api } from '../api/client.ts';
import { useToast } from '../context/ToastContext.tsx';
import { VideoCard } from '../components/VideoCard.tsx';
import { ReviewModal } from '../components/ReviewModal.tsx';
import {
  Shield,
  Clock,
  CheckCircle2,
  XCircle,
  FolderGit2,
  RefreshCw,
  User as UserIcon,
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
  const [videos, setVideos] = useState<Video[]>([]);
  const [editors, setEditors] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTab, setCurrentTab] = useState<string>(activeFilter);
  const [reviewModalState, setReviewModalState] = useState<{
    video: Video | null;
    mode: 'approve' | 'reject';
  }>({ video: null, mode: 'approve' });

  useEffect(() => {
    setCurrentTab(activeFilter);
  }, [activeFilter]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [vData, edData] = await Promise.all([api.getVideos(), api.getEditors()]);
      setVideos(vData);
      setEditors(edData);
    } catch (err) {
      console.error('Failed to load supervisor data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleEditorChange = async (videoId: number, newEditorId: number) => {
    try {
      const updated = await api.assignEditor(videoId, newEditorId);
      setVideos((prev) => prev.map((v) => (v.id === videoId ? updated : v)));
      toast.success('تدوین‌گر پروژه با موفقیت تغییر یافت.');
    } catch (err: any) {
      toast.error(err.message || 'خطا در تخصیص تدوین‌گر.');
    }
  };

  const filteredVideos = videos.filter((v) => {
    if (currentTab === 'pending' || currentTab === 'pending-review') return v.status === 'PendingReview';
    if (currentTab === 'approved') return v.status === 'Approved';
    if (currentTab === 'rejected') return v.status === 'Rejected';
    return true;
  });

  const pendingCount = videos.filter((v) => v.status === 'PendingReview').length;
  const approvedCount = videos.filter((v) => v.status === 'Approved').length;
  const rejectedCount = videos.filter((v) => v.status === 'Rejected').length;
  const totalCount = videos.length;

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
          onClick={fetchData}
          className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 text-xs flex items-center gap-1.5 transition-colors self-start sm:self-auto"
          title="بروزرسانی صف"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
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
              />

              {/* Requirement 4 & 13: Supervisor Select/Change Editor dropdown */}
              <div className="mt-2 p-2.5 rounded-2xl bg-zinc-900/90 border border-zinc-800 text-xs flex items-center justify-between">
                <span className="text-zinc-500 flex items-center gap-1.5">
                  <UserIcon className="w-3.5 h-3.5 text-zinc-400" />
                  <span>تغییر تدوین‌گر:</span>
                </span>
                <select
                  value={v.editorId}
                  onChange={(e) => handleEditorChange(v.id, Number(e.target.value))}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-zinc-200 text-xs focus:outline-none focus:border-purple-500"
                >
                  {editors.map((ed) => (
                    <option key={ed.id} value={ed.id}>
                      {ed.displayName}
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
          }}
        />
      )}
    </div>
  );
};
