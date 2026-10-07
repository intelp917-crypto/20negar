import React, { useState, useEffect } from 'react';
import { User, Video, SystemStats, UserRole } from '../types/index.ts';
import { api } from '../api/client.ts';
import { VideoCard } from '../components/VideoCard.tsx';
import { StatusBadge, ProcessingBadge } from '../components/StatusBadge.tsx';
import { DownloadMenu } from '../components/DownloadMenu.tsx';
import { ReviewModal } from '../components/ReviewModal.tsx';
import {
  Crown,
  Users,
  Film,
  HardDrive,
  ShieldAlert,
  KeyRound,
  UserPlus,
  Trash2,
  Edit,
  Power,
  RefreshCw,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  Play,
  ArrowRight,
  Eye,
  Activity,
  Layers,
} from 'lucide-react';

interface SuperAdminDashboardProps {
  onWatchVideo: (video: Video) => void;
  onViewDetails: (video: Video) => void;
}

export const SuperAdminDashboard: React.FC<SuperAdminDashboardProps> = ({
  onWatchVideo,
  onViewDetails,
}) => {
  const [activeTab, setActiveTab] = useState<'users' | 'videos' | 'telemetry'>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // User management modals
  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('Editor');

  const [passwordResetUser, setPasswordResetUser] = useState<User | null>(null);
  const [resetPasswordVal, setResetPasswordVal] = useState('');

  const [editUser, setEditUser] = useState<User | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('Editor');
  const [editIsActive, setEditIsActive] = useState(true);

  // Video review modal
  const [reviewState, setReviewState] = useState<{ video: Video | null; mode: 'approve' | 'reject' }>({
    video: null,
    mode: 'approve',
  });

  const [userSearch, setUserSearch] = useState('');
  const [videoSearch, setVideoSearch] = useState('');
  const [videoStatusFilter, setVideoStatusFilter] = useState('all');

  // Self-update from GitHub repo (فیچر ۲)
  const [updateStatus, setUpdateStatus] = useState<{
    repo: string;
    gitAvailable: boolean;
    isRepo: boolean;
    localSha: string | null;
    remoteSha: string | null;
    upToDate: boolean | null;
    tokenConfigured: boolean;
    message: string;
  } | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [uData, vData, sData] = await Promise.all([
        api.getAllUsers(),
        api.getVideos(),
        api.getSystemStats(),
      ]);
      setUsers(uData);
      setVideos(vData);
      setStats(sData);
    } catch (err) {
      console.error('Failed to load superadmin data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    api.getUpdateStatus().then(setUpdateStatus).catch((err) => console.error('Update status failed:', err));
  }, []);

  const handleForceUpdate = async () => {
    if (isUpdating) return;
    if (!window.confirm('بروزرسانی اجباری از ریپوزیتوری گیت‌هاب انجام شود؟ در صورت وجود نسخه جدید، سرور ری‌استارت می‌شود و چند لحظه از دسترس خارج است.')) return;
    setIsUpdating(true);
    setUpdateMessage(null);
    try {
      const result = await api.forceUpdate();
      setUpdateMessage(result.message);
      if (result.restarting) {
        // سرور دارد ری‌استارت می‌شود؛ بعد از چند ثانیه وضعیت را دوباره بگیر
        setTimeout(() => window.location.reload(), 6000);
      } else {
        api.getUpdateStatus().then(setUpdateStatus).catch(() => {});
      }
    } catch (err: any) {
      setUpdateMessage(err.message || 'خطا در بروزرسانی وب‌اپ.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await api.createUser({
        username: newUsername,
        password: newPassword,
        displayName: newDisplayName,
        role: newRole,
      });
      setUsers((prev) => [...prev, created]);
      setIsCreateUserOpen(false);
      setNewUsername('');
      setNewPassword('');
      setNewDisplayName('');
      setNewRole('Editor');
      alert(`کاربر جدید "${created.displayName}" با موفقیت ایجاد گردید.`);
    } catch (err: any) {
      alert(err.message || 'خطا در ایجاد کاربر');
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordResetUser) return;
    try {
      await api.resetUserPassword(passwordResetUser.id, resetPasswordVal);
      setPasswordResetUser(null);
      setResetPasswordVal('');
      alert(`رمز عبور کاربر "${passwordResetUser.username}" با موفقیت تغییر یافت.`);
    } catch (err: any) {
      alert(err.message || 'خطا در تغییر رمز عبور');
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    try {
      const updated = await api.updateUser(editUser.id, {
        displayName: editDisplayName,
        role: editRole,
        isActive: editIsActive,
      });
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setEditUser(null);
      alert('مشخصات کاربر با موفقیت ذخیره شد.');
    } catch (err: any) {
      alert(err.message || 'خطا در به‌روزرسانی کاربر');
    }
  };

  const handleDeleteUser = async (userToDelete: User) => {
    if (userToDelete.role === 'SuperAdmin') {
      alert('حساب سوپریوزر اصلی سیستم قابل حذف نیست.');
      return;
    }
    if (!confirm(`آیا از حذف یا غیرفعال‌سازی کاربر "${userToDelete.displayName}" اطمینان دارید؟`)) {
      return;
    }
    try {
      await api.deleteUser(userToDelete.id);
      setUsers((prev) => prev.filter((u) => u.id !== userToDelete.id));
      alert('کاربر با موفقیت حذف یا غیرفعال گردید.');
    } catch (err: any) {
      alert(err.message || 'خطا در حذف کاربر');
    }
  };

  const handleDeleteVideo = async (videoToDelete: Video) => {
    if (!confirm(`آیا از حذف کامل ویدیوی "${videoToDelete.title}" و تمام فایل‌های رندر شده اطمینان دارید؟`)) {
      return;
    }
    try {
      await api.deleteVideo(videoToDelete.id);
      setVideos((prev) => prev.filter((v) => v.id !== videoToDelete.id));
      alert('ویدیو و تمام فایل‌های ترنسکد با موفقیت حذف شدند.');
    } catch (err: any) {
      alert(err.message || 'خطا در حذف ویدیو');
    }
  };

  const adminUsers = users.filter((u) => u.role === 'Admin' && u.isActive);

  const handleAssignAdmin = async (video: Video, adminId: number) => {
    try {
      const updated = await api.assignAdmin(video.id, adminId > 0 ? adminId : null);
      setVideos((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
    } catch (err: any) {
      alert(err.message || 'خطا در انتساب ادمین.');
    }
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '0 MB';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(2)} GB`;
    }
    return `${mb.toFixed(1)} MB`;
  };

  const filteredUsers = users.filter((u) => {
    if (!userSearch.trim()) return true;
    const s = userSearch.toLowerCase();
    return (
      u.username.toLowerCase().includes(s) ||
      u.displayName.toLowerCase().includes(s) ||
      u.role.toLowerCase().includes(s)
    );
  });

  const filteredVideos = videos.filter((v) => {
    if (videoStatusFilter !== 'all' && v.status !== videoStatusFilter) return false;
    if (!videoSearch.trim()) return true;
    const s = videoSearch.toLowerCase();
    return (
      v.title.toLowerCase().includes(s) ||
      v.originalFilename.toLowerCase().includes(s) ||
      v.editorName.toLowerCase().includes(s) ||
      v.supervisorName.toLowerCase().includes(s)
    );
  });

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'SuperAdmin':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1">
            <Crown className="w-3 h-3 text-amber-400" />
            مدیرکل
          </span>
        );
      case 'Editor':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/30">
            تدوین‌گر
          </span>
        );
      case 'Supervisor':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            ناظر کیفی
          </span>
        );
      case 'Admin':
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/30">
            ادمین
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Header */}
      <div className="p-6 rounded-3xl bg-gradient-to-r from-purple-950/60 via-zinc-900 to-zinc-900 border border-purple-500/30 shadow-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-500 via-purple-600 to-indigo-600 flex items-center justify-center text-white shadow-xl shadow-purple-950/50">
            <Crown className="w-7 h-7 text-amber-200" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2">
              <span>پنل مدیرکل</span>
            </h1>
            <p className="text-xs sm:text-sm text-zinc-300 mt-1">
              کنترل جامع حساب‌های کاربری، رمزهای عبور، نقش‌ها، تمامی ویدیوها، بازبینی و منابع دیسک سرور.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            className="p-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs flex items-center gap-1.5 transition-colors border border-zinc-700"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>بروزرسانی داده‌ها</span>
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-zinc-800 pb-3 text-xs font-semibold">
        <button
          onClick={() => setActiveTab('users')}
          className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 ${
            activeTab === 'users'
              ? 'bg-purple-600 text-white shadow-lg shadow-purple-950/50'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>مدیریت کاربران و دسترسی‌ها ({users.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('videos')}
          className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 ${
            activeTab === 'videos'
              ? 'bg-purple-600 text-white shadow-lg shadow-purple-950/50'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
          }`}
        >
          <Film className="w-4 h-4" />
          <span>مرکز کنترل کل ویدیوها ({videos.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('telemetry')}
          className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 ${
            activeTab === 'telemetry'
              ? 'bg-purple-600 text-white shadow-lg shadow-purple-950/50'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
          }`}
        >
          <Activity className="w-4 h-4" />
          <span>آمار فنی، دیتابیس و حافظه سرور</span>
        </button>
      </div>

      {/* TAB 1: USER MANAGEMENT */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-zinc-900 border border-zinc-800 p-4 rounded-2xl">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="جستجو در نام کاربری، نام نمایشی یا نقش..."
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500 rounded-xl pr-10 pl-4 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
            </div>

            <button
              onClick={() => setIsCreateUserOpen(true)}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-md shadow-purple-950/50 flex items-center justify-center gap-2 transition-all shrink-0"
            >
              <UserPlus className="w-4 h-4" />
              <span>ایجاد کاربر جدید</span>
            </button>
          </div>

          {/* Users Table */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-lg">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-zinc-950/80 text-zinc-400 font-semibold uppercase text-[10px] border-b border-zinc-800">
                  <tr>
                    <th className="px-4 py-3">شناسه</th>
                    <th className="px-4 py-3">نام کاربری</th>
                    <th className="px-4 py-3">نام و مشخصات</th>
                    <th className="px-4 py-3">نقش کاربری</th>
                    <th className="px-4 py-3">وضعیت حساب</th>
                    <th className="px-4 py-3">تاریخ عضویت</th>
                    <th className="px-4 py-3 text-left">عملیات سوپریوزر</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                  {filteredUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-zinc-800/40 transition-colors">
                      <td className="px-4 py-3 font-mono text-zinc-500">#{u.id}</td>
                      <td className="px-4 py-3 font-mono font-bold text-zinc-100">@{u.username}</td>
                      <td className="px-4 py-3 font-semibold text-zinc-200">{u.displayName}</td>
                      <td className="px-4 py-3">{getRoleBadge(u.role)}</td>
                      <td className="px-4 py-3">
                        {u.isActive ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400 text-[11px] font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            فعال
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-zinc-500 text-[11px] font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                            غیرفعال
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-zinc-400 text-[11px]">
                        {new Date(u.createdAt).toLocaleDateString('fa-IR')}
                      </td>
                      <td className="px-4 py-3 text-left">
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={() => {
                              setPasswordResetUser(u);
                              setResetPasswordVal('');
                            }}
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-amber-400 hover:text-amber-300 transition-colors border border-zinc-700"
                            title="تغییر رمز عبور کاربر"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => {
                              setEditUser(u);
                              setEditDisplayName(u.displayName);
                              setEditRole(u.role);
                              setEditIsActive(u.isActive);
                            }}
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sky-400 hover:text-sky-300 transition-colors border border-zinc-700"
                            title="ویرایش نقش و مشخصات"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>

                          {u.role !== 'SuperAdmin' && (
                            <button
                              onClick={() => handleDeleteUser(u)}
                              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-500/20 text-rose-400 transition-colors border border-zinc-700 hover:border-rose-500/40"
                              title="حذف کاربر"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: GLOBAL VIDEOS CONTROL */}
      {activeTab === 'videos' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-zinc-900 border border-zinc-800 p-4 rounded-2xl">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                value={videoSearch}
                onChange={(e) => setVideoSearch(e.target.value)}
                placeholder="جستجو بر اساس عنوان ویدیو، نام فایل یا افراد مسئول..."
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500 rounded-xl pr-10 pl-4 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <select
                value={videoStatusFilter}
                onChange={(e) => setVideoStatusFilter(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-purple-500 w-full sm:w-auto"
              >
                <option value="all">همه وضعیت‌ها</option>
                <option value="Approved">تایید شده</option>
                <option value="PendingReview">در انتظار بازبینی</option>
                <option value="Rejected">رد شده</option>
              </select>
            </div>
          </div>

          {/* Videos Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {filteredVideos.map((v) => (
              <div key={v.id} className="relative flex flex-col">
                <VideoCard
                  video={v}
                  onWatch={onWatchVideo}
                  onViewDetails={onViewDetails}
                  showSupervisorActions={true}
                  onQuickReview={(vid) => setReviewState({ video: vid, mode: 'approve' })}
                />

                {/* Admin Destination Assignment - فقط مدیرکل */}
                <div className="mt-2 p-2.5 rounded-xl bg-zinc-950 border border-purple-500/30 flex items-center justify-between gap-2 text-xs">
                  <span className="text-zinc-400 shrink-0 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-purple-400" />
                    ادمین مقصد:
                  </span>
                  <select
                    value={v.adminId ?? 0}
                    onChange={(e) => handleAssignAdmin(v, Number(e.target.value))}
                    className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-zinc-200 text-xs focus:outline-none focus:border-purple-500 min-w-0 flex-1"
                    title="ویدیو فقط در پنل ادمین انتخابی نمایش داده می‌شود"
                  >
                    <option value={0}>بدون ادمین (فقط مدیرکل)</option>
                    {adminUsers.map((ad) => (
                      <option key={ad.id} value={ad.id}>
                        {ad.displayName}
                      </option>
                    ))}
                  </select>
                </div>

                {/* SuperAdmin Direct Control Buttons */}
                <div className="mt-2 p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    {v.status !== 'Approved' && (
                      <button
                        onClick={() => setReviewState({ video: v, mode: 'approve' })}
                        className="px-2.5 py-1 rounded-lg bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-500/30 font-semibold"
                      >
                        تایید آنی
                      </button>
                    )}
                    {v.status !== 'Rejected' && (
                      <button
                        onClick={() => setReviewState({ video: v, mode: 'reject' })}
                        className="px-2.5 py-1 rounded-lg bg-rose-600/20 text-rose-400 hover:bg-rose-600/30 border border-rose-500/30 font-semibold"
                      >
                        رد با نظر
                      </button>
                    )}
                  </div>

                  <button
                    onClick={() => handleDeleteVideo(v)}
                    className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition-colors"
                    title="حذف کامل ویدیو و فایل‌های سرور"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: SYSTEM TELEMETRY */}
      {activeTab === 'telemetry' && stats && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-md">
              <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
                <span>فضای اشغال‌شده ذخیره‌سازی</span>
                <HardDrive className="w-5 h-5 text-purple-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-purple-400">
                {formatFileSize(stats.totalStorageBytes)}
              </div>
              <div className="text-[11px] text-zinc-500 mt-1">ویدیوهای اصلی + رندرهای ترنسکد</div>
            </div>

            <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-md">
              <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
                <span>تعداد کل کاربران فعال</span>
                <Users className="w-5 h-5 text-sky-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-sky-400">{stats.userCount}</div>
              <div className="text-[11px] text-zinc-500 mt-1">حساب‌های کاربری ثبت شده</div>
            </div>

            <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-md">
              <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
                <span>تعداد کل ویدیوها</span>
                <Film className="w-5 h-5 text-amber-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-amber-400">{stats.videoCount}</div>
              <div className="text-[11px] text-zinc-500 mt-1">پروژه‌های موجود در پایگاه داده</div>
            </div>

            <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-md">
              <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
                <span>تعداد لاگ‌های مانیتورینگ</span>
                <Activity className="w-5 h-5 text-emerald-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-emerald-400">{stats.logCount}</div>
              <div className="text-[11px] text-zinc-500 mt-1">ردپای امنیتی ثبت شده</div>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 space-y-2">
            <h4 className="font-semibold text-zinc-100 text-sm">اطلاعات سرور و وضعیت پلتفرم:</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                <span className="text-zinc-500">موتور پردازش ویدیو:</span>{' '}
                <strong className="text-purple-400 font-bold">سیستم بهینه‌سازی و تبدیل چندکیفیته (فعال)</strong>
              </div>
              <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                <span className="text-zinc-500">پایگاه داده استودیو:</span>{' '}
                <strong className="text-sky-400 font-bold">پایگاه داده پرسرعت با نمایه‌های چندگانه (طراحی برای حجم بالای ویدیو)</strong>
              </div>
            </div>
          </div>

          {/* بروزرسانی وب‌اپ از ریپوزیتوری (فیچر ۲) */}
          <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-emerald-400" />
                <h4 className="font-semibold text-zinc-100 text-sm">بروزرسانی وب‌اپ از ریپوزیتوری گیت‌هاب</h4>
              </div>
              <button
                onClick={handleForceUpdate}
                disabled={isUpdating || !updateStatus?.gitAvailable}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold shadow-md shadow-emerald-950/50 flex items-center gap-2 transition-all"
              >
                <RefreshCw className={`w-4 h-4 ${isUpdating ? 'animate-spin' : ''}`} />
                <span>{isUpdating ? 'در حال بروزرسانی...' : 'بروزرسانی اجباری'}</span>
              </button>
            </div>

            {updateStatus && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                  <span className="text-zinc-500">ریپوزیتوری:</span>{' '}
                  <a href={updateStatus.repo} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline font-mono text-[11px]">
                    {updateStatus.repo}
                  </a>
                </div>
                <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                  <span className="text-zinc-500">وضعیت:</span>{' '}
                  <strong className={updateStatus.upToDate ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                    {updateStatus.message}
                  </strong>
                </div>
                {updateStatus.localSha && updateStatus.remoteSha && (
                  <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 sm:col-span-2 font-mono text-[11px] text-zinc-500 break-all">
                    نسخه محلی: <span className="text-zinc-300">{updateStatus.localSha.slice(0, 12)}</span>
                    {'  •  '}نسخه ریموت: <span className="text-zinc-300">{updateStatus.remoteSha.slice(0, 12)}</span>
                    {'  •  '}حالت: آپدیت خودکار هنگام راه‌اندازی سرور {updateStatus.gitAvailable ? 'فعال' : 'غیرفعال (git یافت نشد)'}
                  </div>
                )}
              </div>
            )}

            {updateMessage && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
                {updateMessage}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: CREATE USER */}
      {isCreateUserOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm">
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-3xl p-6 shadow-2xl">
            <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-purple-400" />
              <span>ایجاد حساب کاربری جدید</span>
            </h3>
            <form onSubmit={handleCreateUser} className="space-y-4 text-xs">
              <div>
                <label className="block text-zinc-300 font-semibold mb-1">نام کاربری (Username)</label>
                <input
                  type="text"
                  required
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="مثلا: editor2 یا supervisor2"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-100 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-zinc-300 font-semibold mb-1">رمز عبور (Password)</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="حداقل ۴ کاراکتر"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-100 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-zinc-300 font-semibold mb-1">نام و مشخصات نمایشی</label>
                <input
                  type="text"
                  required
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder="مثلا: علی رضایی (تدوین‌گر استودیو)"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-100 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-zinc-300 font-semibold mb-1">نقش دسترسی در سیستم</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-100 focus:outline-none focus:border-purple-500"
                >
                  <option value="SuperAdmin">مدیرکل</option>
                  <option value="Editor">تدوین‌گر</option>
                  <option value="Supervisor">ناظر کیفی</option>
                  <option value="Admin">ادمین</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsCreateUserOpen(false)}
                  className="px-4 py-2 rounded-xl text-zinc-400 hover:text-white"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold shadow-lg shadow-purple-950/50"
                >
                  ذخیره و ثبت کاربر
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: RESET PASSWORD */}
      {passwordResetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-3xl p-6 shadow-2xl">
            <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-amber-400" />
              <span>تغییر رمز عبور کاربر</span>
            </h3>
            <p className="text-xs text-zinc-400 mb-4">
              تنظیم رمز عبور جدید برای کاربر: <strong>@{passwordResetUser.username}</strong> ({passwordResetUser.displayName})
            </p>
            <form onSubmit={handleResetPassword} className="space-y-4 text-xs">
              <div>
                <label className="block text-zinc-300 font-semibold mb-1">رمز عبور جدید</label>
                <input
                  type="password"
                  required
                  value={resetPasswordVal}
                  onChange={(e) => setResetPasswordVal(e.target.value)}
                  placeholder="رمز عبور جدید را وارد کنید"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-100 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setPasswordResetUser(null)}
                  className="px-4 py-2 rounded-xl text-zinc-400 hover:text-white"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold shadow-lg"
                >
                  تغییر رمز عبور
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EDIT USER */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm">
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-3xl p-6 shadow-2xl">
            <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
              <Edit className="w-5 h-5 text-sky-400" />
              <span>ویرایش مشخصات کاربر: @{editUser.username}</span>
            </h3>
            <form onSubmit={handleUpdateUser} className="space-y-4 text-xs">
              <div>
                <label className="block text-zinc-300 font-semibold mb-1">نام و مشخصات نمایشی</label>
                <input
                  type="text"
                  required
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-100 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-zinc-300 font-semibold mb-1">نقش دسترسی در سیستم</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-100 focus:outline-none focus:border-purple-500"
                >
                  <option value="SuperAdmin">مدیرکل</option>
                  <option value="Editor">تدوین‌گر</option>
                  <option value="Supervisor">ناظر کیفی</option>
                  <option value="Admin">ادمین</option>
                </select>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="activeCheck"
                  checked={editIsActive}
                  onChange={(e) => setEditIsActive(e.target.checked)}
                  className="w-4 h-4 rounded accent-purple-600 cursor-pointer"
                />
                <label htmlFor="activeCheck" className="text-zinc-200 cursor-pointer">
                  حساب کاربری فعال باشد
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setEditUser(null)}
                  className="px-4 py-2 rounded-xl text-zinc-400 hover:text-white"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold shadow-lg"
                >
                  ذخیره تغییرات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Review Modal */}
      {reviewState.video && (
        <ReviewModal
          video={reviewState.video}
          mode={reviewState.mode}
          isOpen={Boolean(reviewState.video)}
          onClose={() => setReviewState({ video: null, mode: 'approve' })}
          onSuccess={(updated) => {
            setVideos((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
            setReviewState({ video: null, mode: 'approve' });
          }}
        />
      )}
    </div>
  );
};
