import React from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import {
  LayoutDashboard,
  Film,
  UploadCloud,
  Clock,
  CheckCircle2,
  XCircle,
  Users,
  Shield,
  FileText,
  LogOut,
  FolderGit2,
  BookOpen,
  Crown,
  Settings,
  Activity,
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isOpen: boolean;
  onClose: () => void;
  onOpenUpload?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  isOpen,
  onClose,
  onOpenUpload,
}) => {
  const { user, logout } = useAuth();
  const role = user?.role;

  interface NavItem {
    id: string;
    label: string;
    icon: React.ReactNode;
    action?: () => void;
    badge?: string;
  }

  let navItems: NavItem[] = [];

  if (role === 'SuperAdmin') {
    navItems = [
      { id: 'superadmin', label: 'پنل مدیریت کل (SuperAdmin)', icon: <Crown className="w-4 h-4 text-amber-400" /> },
      { id: 'dashboard', label: 'پیشخوان تایید شده‌ها (Admin)', icon: <LayoutDashboard className="w-4 h-4" /> },
      { id: 'all-videos', label: 'تمام پروژه‌ها و ویدیوها', icon: <Film className="w-4 h-4" /> },
      { id: 'editors', label: 'لیست تدوین‌گران', icon: <Users className="w-4 h-4" /> },
      { id: 'supervisors', label: 'لیست ناظران کیفی', icon: <Shield className="w-4 h-4" /> },
      { id: 'audit-logs', label: 'لاگ‌های امنیتی سیستم', icon: <FileText className="w-4 h-4" /> },
      { id: 'docs', label: 'راهنمای استودیو ۲۰نگار', icon: <BookOpen className="w-4 h-4" /> },
    ];
  } else if (role === 'Admin') {
    navItems = [
      { id: 'dashboard', label: 'پیشخوان اصلی', icon: <LayoutDashboard className="w-4 h-4" /> },
      { id: 'approved-videos', label: 'ویدیوهای تایید شده', icon: <CheckCircle2 className="w-4 h-4" /> },
      { id: 'all-videos', label: 'تمام ویدیوها', icon: <Film className="w-4 h-4" /> },
      { id: 'editors', label: 'تدوین‌گران', icon: <Users className="w-4 h-4" /> },
      { id: 'supervisors', label: 'ناظران کیفی', icon: <Shield className="w-4 h-4" /> },
      { id: 'audit-logs', label: 'لاگ‌های امنیتی', icon: <FileText className="w-4 h-4" /> },
      { id: 'docs', label: 'مستندات و استقرار', icon: <BookOpen className="w-4 h-4" /> },
    ];
  } else if (role === 'Editor') {
    navItems = [
      { id: 'dashboard', label: 'پیشخوان من', icon: <LayoutDashboard className="w-4 h-4" /> },
      { id: 'my-videos', label: 'ویدیوهای من', icon: <Film className="w-4 h-4" /> },
      {
        id: 'upload-video',
        label: 'بارگذاری ویدیو جدید',
        icon: <UploadCloud className="w-4 h-4" />,
        action: onOpenUpload,
      },
      { id: 'pending-review', label: 'در انتظار بازبینی', icon: <Clock className="w-4 h-4" /> },
      { id: 'approved', label: 'تایید شده‌ها', icon: <CheckCircle2 className="w-4 h-4" /> },
      { id: 'rejected', label: 'رد شده / نیازمند اصلاح', icon: <XCircle className="w-4 h-4" /> },
      { id: 'docs', label: 'راهنمای استودیو', icon: <BookOpen className="w-4 h-4" /> },
    ];
  } else if (role === 'Supervisor') {
    navItems = [
      { id: 'dashboard', label: 'پیشخوان نظارت', icon: <LayoutDashboard className="w-4 h-4" /> },
      { id: 'pending-review', label: 'صف در انتظار بررسی', icon: <Clock className="w-4 h-4" /> },
      { id: 'approved', label: 'پروژه‌های تایید شده', icon: <CheckCircle2 className="w-4 h-4" /> },
      { id: 'rejected', label: 'پروژه‌های رد شده', icon: <XCircle className="w-4 h-4" /> },
      { id: 'all-assigned', label: 'تمام پروژه‌های محوله', icon: <FolderGit2 className="w-4 h-4" /> },
      { id: 'docs', label: 'راهنمای استودیو', icon: <BookOpen className="w-4 h-4" /> },
    ];
  }

  const handleSelect = (item: NavItem) => {
    if (item.action) {
      item.action();
    } else {
      setActiveTab(item.id);
    }
    onClose();
  };

  const getRoleLabel = (r?: string) => {
    switch (r) {
      case 'SuperAdmin': return 'سوپریوزر ارشد کل';
      case 'Admin': return 'مدیریت ارشد';
      case 'Supervisor': return 'سرپرست و ناظر کیفی';
      case 'Editor': return 'تدوین‌گر ویدیو';
      default: return r;
    }
  };

  return (
    <>
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 bg-black/70 backdrop-blur-xs z-40 lg:hidden"
        />
      )}

      <aside
        className={`fixed top-16 bottom-0 right-0 w-64 bg-zinc-950 border-l border-zinc-800/80 z-40 flex flex-col justify-between transition-transform duration-300 ease-in-out lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        dir="rtl"
      >
        <div className="p-4 space-y-6 overflow-y-auto">
          {/* Role Header Badge */}
          <div className="p-3.5 rounded-2xl bg-zinc-900/60 border border-zinc-800">
            <div className="text-[11px] text-zinc-500 font-semibold">
              میز کار فعال شما
            </div>
            <div className="text-sm font-bold text-zinc-100 mt-0.5 flex items-center justify-between">
              <span>{getRoleLabel(role)}</span>
              <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1">
            <div className="px-3 pb-2 text-[10px] uppercase text-zinc-500 font-bold">
              منوی دسترسی
            </div>
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleSelect(item)}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-purple-600 text-white shadow-lg shadow-purple-950/50'
                      : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={isActive ? 'text-white' : 'text-zinc-400'}>{item.icon}</span>
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-purple-500/20 text-purple-300">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Footer / Action */}
        <div className="p-4 border-t border-zinc-800/80 space-y-2">
          {role === 'Editor' && (
            <button
              onClick={() => {
                onOpenUpload?.();
                onClose();
              }}
              className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold shadow-md shadow-purple-950/40 flex items-center justify-center gap-2 mb-2 transition-all"
            >
              <UploadCloud className="w-4 h-4" />
              بارگذاری ویدیو جدید
            </button>
          )}

          <button
            onClick={() => {
              onClose();
              logout();
            }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>خروج از حساب</span>
          </button>
        </div>
      </aside>
    </>
  );
};
