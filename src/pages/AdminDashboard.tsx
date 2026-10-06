import React, { useState, useEffect } from 'react';
import { Video, AdminStats, User } from '../types/index.ts';
import { api } from '../api/client.ts';
import { VideoCard } from '../components/VideoCard.tsx';
import { DownloadMenu } from '../components/DownloadMenu.tsx';
import { StatusBadge, ProcessingBadge } from '../components/StatusBadge.tsx';
import {
  Film,
  CheckCircle2,
  Clock,
  XCircle,
  Users,
  Shield,
  Search,
  Filter,
  ArrowUpDown,
  Play,
  Eye,
  SlidersHorizontal,
  RefreshCw,
} from 'lucide-react';

interface AdminDashboardProps {
  onWatchVideo: (video: Video) => void;
  onViewDetails: (video: Video) => void;
  defaultView?: 'approved-only' | 'all';
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  onWatchVideo,
  onViewDetails,
  defaultView = 'approved-only',
}) => {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [editors, setEditors] = useState<User[]>([]);
  const [supervisors, setSupervisors] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(
    defaultView === 'approved-only' ? 'Approved' : 'all'
  );
  const [editorFilter, setEditorFilter] = useState<string>('all');
  const [supervisorFilter, setSupervisorFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('newest');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [statsData, videosData, editorsData, supervisorsData] = await Promise.all([
        api.getAdminStats(),
        api.getVideos({
          search: search || undefined,
          status: statusFilter !== 'all' ? statusFilter : undefined,
          editorId: editorFilter !== 'all' ? Number(editorFilter) : undefined,
          supervisorId: supervisorFilter !== 'all' ? Number(supervisorFilter) : undefined,
          sort: sortBy,
        }),
        api.getEditors(),
        api.getSupervisors(),
      ]);
      setStats(statsData);
      setVideos(videosData);
      setEditors(editorsData);
      setSupervisors(supervisorsData);
    } catch (err) {
      console.error('Failed to load admin data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [statusFilter, editorFilter, supervisorFilter, sortBy]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchData();
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

  return (
    <div className="space-y-6" dir="rtl">
      {/* Page Title & Refresh */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2.5">
            <span>پیشخوان مدیریت ارشد تولید</span>
            <span className="text-xs font-mono font-semibold px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
              آرشیو Master Cut
            </span>
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            آرشیو ویدیوهای تایید شده توسط ناظر کیفی، نظارت بر پرسنل، ترنسکدینگ و دانلود کیفیت‌های نهایی.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 text-xs flex items-center gap-1.5 transition-colors"
            title="بروزرسانی داده‌ها"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">بروزرسانی</span>
          </button>
        </div>
      </div>

      {/* 6 Statistics Cards (Requirement 7) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-sm">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
            <span>کل ویدیوها</span>
            <Film className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-zinc-100">{stats?.totalVideos ?? '--'}</div>
          <div className="text-[10px] text-zinc-500 mt-1">تمام کات‌های ثبت‌شده</div>
        </div>

        <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-sm">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
            <span>در انتظار بازبینی</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-amber-400">{stats?.pendingVideos ?? '--'}</div>
          <div className="text-[10px] text-zinc-500 mt-1">تحت بررسی ناظران</div>
        </div>

        <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-sm">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
            <span>تایید شده</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-400">{stats?.approvedVideos ?? '--'}</div>
          <div className="text-[10px] text-zinc-500 mt-1">آماده تحویل و اکران</div>
        </div>

        <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-sm">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
            <span>رد شده / اصلاح</span>
            <XCircle className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-rose-400">{stats?.rejectedVideos ?? '--'}</div>
          <div className="text-[10px] text-zinc-500 mt-1">درخواست بازبینی کات</div>
        </div>

        <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-sm">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
            <span>تدوین‌گران</span>
            <Users className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-sky-400">{stats?.totalEditors ?? '--'}</div>
          <div className="text-[10px] text-zinc-500 mt-1">تدوین‌گران فعال استودیو</div>
        </div>

        <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-sm">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
            <span>ناظران کیفی</span>
            <Shield className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-indigo-400">{stats?.totalSupervisors ?? '--'}</div>
          <div className="text-[10px] text-zinc-500 mt-1">سرپرستان تایید کیفیت</div>
        </div>
      </div>

      {/* Primary Rule Notice */}
      {statusFilter === 'Approved' && (
        <div className="p-4 rounded-2xl bg-emerald-950/20 border border-emerald-500/25 text-xs text-emerald-300 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              <strong>آرشیو ویدیوهای تایید شده:</strong> طبق قوانین استودیو، در این بخش تنها کات‌هایی نمایش داده می‌شوند که توسط ناظر کیفی مربوطه بررسی و تایید گردیده‌اند.
            </span>
          </div>
          <button
            onClick={() => setStatusFilter('all')}
            className="text-[11px] underline hover:text-emerald-200 shrink-0 mr-2"
          >
            مشاهده تمام مراحل گردش کار
          </button>
        </div>
      )}

      {/* Search and Filters */}
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 shadow-sm space-y-3">
        <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="جستجو در عنوان، نام فایل اصلی، نام تدوین‌گر یا ناظر کیفی..."
              className="w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500 rounded-xl pr-10 pl-4 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all"
            />
          </div>
          <button
            type="submit"
            className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-md shadow-purple-950/40 transition-colors"
          >
            جستجو
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-zinc-800/80 text-xs">
          <div className="flex items-center gap-1.5 text-zinc-400">
            <Filter className="w-3.5 h-3.5" />
            <span>فیلترها:</span>
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-purple-500"
          >
            <option value="Approved">فقط تایید شده‌ها (پیش‌فرض)</option>
            <option value="all">همه وضعیت‌ها</option>
            <option value="PendingReview">در انتظار بازبینی</option>
            <option value="Rejected">رد شده / نیازمند اصلاح</option>
          </select>

          <select
            value={editorFilter}
            onChange={(e) => setEditorFilter(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-purple-500"
          >
            <option value="all">همه تدوین‌گران</option>
            {editors.map((ed) => (
              <option key={ed.id} value={ed.id}>
                تدوین‌گر: {ed.displayName}
              </option>
            ))}
          </select>

          <select
            value={supervisorFilter}
            onChange={(e) => setSupervisorFilter(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-purple-500"
          >
            <option value="all">همه ناظران کیفی</option>
            {supervisors.map((sp) => (
              <option key={sp.id} value={sp.id}>
                ناظر: {sp.displayName}
              </option>
            ))}
          </select>

          <div className="mr-auto flex items-center gap-2">
            <span className="text-zinc-500 hidden sm:inline flex items-center gap-1">
              <ArrowUpDown className="w-3.5 h-3.5" /> مرتب‌سازی:
            </span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-purple-500"
            >
              <option value="newest">جدیدترین</option>
              <option value="oldest">قدیمی‌ترین</option>
              <option value="largest">بیشترین حجم فایل</option>
              <option value="smallest">کمترین حجم فایل</option>
            </select>

            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-0.5 flex items-center">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1 rounded ${viewMode === 'grid' ? 'bg-zinc-800 text-white' : 'text-zinc-500'}`}
                title="نمایش کارتی"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`p-1 rounded ${viewMode === 'table' ? 'bg-zinc-800 text-white' : 'text-zinc-500'}`}
                title="نمایش جدولی"
              >
                <Film className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Videos Section */}
      {isLoading ? (
        <div className="py-20 text-center text-zinc-500 text-sm">در حال بارگذاری آرشیو استودیو...</div>
      ) : videos.length === 0 ? (
        <div className="py-16 text-center bg-zinc-900/50 border border-zinc-800 rounded-2xl">
          <Film className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-zinc-300">هیچ ویدیویی با این مشخصات یافت نشد</h3>
          <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
            {statusFilter === 'Approved'
              ? 'هنوز هیچ ویدیویی توسط ناظران کیفی تایید نگردیده است.'
              : 'فیلترها یا عبارت جستجو را تغییر دهید.'}
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {videos.map((v) => (
            <VideoCard
              key={v.id}
              video={v}
              onWatch={onWatchVideo}
              onViewDetails={onViewDetails}
            />
          ))}
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-lg">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-zinc-950/80 text-zinc-400 font-semibold uppercase text-[10px] border-b border-zinc-800">
                <tr>
                  <th className="px-4 py-3">عنوان ویدیو و فایل اصلی</th>
                  <th className="px-4 py-3">تدوین‌گر</th>
                  <th className="px-4 py-3">ناظر کیفی</th>
                  <th className="px-4 py-3">رزولوشن و زمان</th>
                  <th className="px-4 py-3">وضعیت بازبینی</th>
                  <th className="px-4 py-3">تاریخ تایید</th>
                  <th className="px-4 py-3 text-left">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {videos.map((v) => (
                  <tr key={v.id} className="hover:bg-zinc-800/40 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-bold text-zinc-100 flex items-center gap-2">
                        <span>{v.title}</span>
                        {v.versionNumber > 1 && (
                          <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 font-mono text-[10px]">
                            نسخه {v.versionNumber}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-500 font-mono" dir="ltr">{v.originalFilename}</div>
                    </td>
                    <td className="px-4 py-3 font-medium text-zinc-200">{v.editorName}</td>
                    <td className="px-4 py-3 font-medium text-purple-300">{v.supervisorName}</td>
                    <td className="px-4 py-3 font-mono text-zinc-400">
                      <div>{v.originalResolution || '--'}</div>
                      <div className="text-[10px] text-zinc-500">
                        {formatDuration(v.duration)} • {formatFileSize(v.fileSize)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <StatusBadge status={v.status} size="sm" />
                        <ProcessingBadge status={v.processingStatus} size="sm" />
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-zinc-400">
                      {v.approvedAt ? new Date(v.approvedAt).toLocaleDateString('fa-IR') : '--'}
                    </td>
                    <td className="px-4 py-3 text-left">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => onWatchVideo(v)}
                          className="p-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition-colors"
                          title="تماشا آنلاین"
                        >
                          <Play className="w-3.5 h-3.5 fill-white" />
                        </button>
                        <button
                          onClick={() => onViewDetails(v)}
                          className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
                          title="مشاهده جزئیات"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <DownloadMenu video={v} size="sm" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
