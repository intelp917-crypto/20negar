import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { AppNotification, UserRole } from '../types/index.ts';
import { api } from '../api/client.ts';
import {
  Bell,
  CheckCircle2,
  AlertTriangle,
  Info,
  XCircle,
  LogOut,
  UserCheck,
  ChevronDown,
  Menu,
  Film,
  Sparkles,
  Crown,
} from 'lucide-react';

interface NavbarProps {
  onToggleSidebar?: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onToggleSidebar, setActiveTab }) => {
  const { user, logout, switchUserFast } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const notificationRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = async () => {
    try {
      const data = await api.getNotifications();
      setNotifications(data);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 10000);
    return () => clearInterval(interval);
  }, [user]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (notificationRef.current && !notificationRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const handleMarkAllRead = async () => {
    await api.markAllNotificationsRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  };

  const handleNotificationClick = async (notif: AppNotification) => {
    if (!notif.isRead) {
      await api.markNotificationRead(notif.id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, isRead: true } : n))
      );
    }
    if (notif.link) {
      const match = notif.link.match(/\/videos\/(\d+)/);
      if (match) {
        setActiveTab(`video-${match[1]}`);
      }
    }
    setShowNotifications(false);
  };

  const getRoleLabel = (role?: UserRole) => {
    switch (role) {
      case 'SuperAdmin':
        return 'مدیرکل (دسترسی همه چی)';
      case 'Editor':
        return 'تدوین‌گر';
      case 'Supervisor':
        return 'ناظر کیفی';
      case 'Admin':
      default:
        return 'ادمین';
    }
  };

  const getRoleBadgeColor = (role?: UserRole) => {
    switch (role) {
      case 'SuperAdmin':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      case 'Admin':
        return 'bg-purple-500/10 text-purple-400 border-purple-500/30';
      case 'Supervisor':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
      case 'Editor':
      default:
        return 'bg-sky-500/10 text-sky-400 border-sky-500/30';
    }
  };

  return (
    <header className="h-16 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800 sticky top-0 z-40 px-4 lg:px-6 flex items-center justify-between" dir="rtl">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-900 lg:hidden"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => setActiveTab('dashboard')}>
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-purple-700 via-purple-600 to-indigo-500 flex items-center justify-center text-white shadow-lg shadow-purple-950/50">
            <Film className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-extrabold tracking-tight text-white flex items-center gap-1.5">
              <span>۲۰نگار</span>
              <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/30">
                استودیو
              </span>
            </div>
            <div className="text-[10px] text-zinc-500 hidden sm:block">
              سامانه مدیریت پروژه‌ها و پخش ویدیو
            </div>
          </div>
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-3">
        {/* Fast Role Switcher */}
        <div className="hidden lg:flex items-center bg-zinc-900 border border-zinc-800 rounded-xl p-1 text-xs">
          <span className="text-zinc-500 px-2 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-purple-400" /> تعویض نقش:
          </span>
          {(['SuperAdmin', 'Admin', 'Editor', 'Supervisor'] as UserRole[]).map((r) => (
            <button
              key={r}
              onClick={() => switchUserFast(r)}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                user?.role === r
                  ? 'bg-purple-600 text-white shadow-sm font-bold'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
              }`}
            >
              {getRoleLabel(r)}
            </button>
          ))}
        </div>

        {/* Notifications Dropdown */}
        <div className="relative" ref={notificationRef}>
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-900 relative transition-colors"
            title="اعلانات و رویدادها"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 left-1.5 w-4 h-4 rounded-full bg-purple-600 text-[10px] font-bold text-white flex items-center justify-center shadow">
                {unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute left-0 mt-2 w-80 sm:w-96 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-2 z-50 text-xs animate-in fade-in zoom-in-95 duration-100" dir="rtl">
              <div className="flex items-center justify-between p-2.5 border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-zinc-200">اعلانات سیستم</span>
                  {unreadCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 text-[10px] font-mono">
                      {unreadCount} جدید
                    </span>
                  )}
                </div>
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    className="text-[11px] text-purple-400 hover:text-purple-300 font-semibold"
                  >
                    علامت خوانده‌شده
                  </button>
                )}
              </div>

              <div className="max-h-80 overflow-y-auto divide-y divide-zinc-800/60 my-1">
                {notifications.length === 0 ? (
                  <div className="py-8 text-center text-zinc-500 text-xs">
                    هیچ اعلان جدیدی وجود ندارد
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => handleNotificationClick(n)}
                      className={`p-3 cursor-pointer hover:bg-zinc-800/70 transition-colors flex items-start gap-2.5 ${
                        !n.isRead ? 'bg-purple-950/15' : ''
                      }`}
                    >
                      <div className="mt-0.5 shrink-0">
                        {n.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                        {n.type === 'warning' && <AlertTriangle className="w-4 h-4 text-amber-400" />}
                        {n.type === 'error' && <XCircle className="w-4 h-4 text-rose-400" />}
                        {n.type === 'info' && <Info className="w-4 h-4 text-sky-400" />}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-zinc-200 text-xs">{n.title}</span>
                          <span className="text-[10px] font-mono text-zinc-500">
                            {new Date(n.createdAt).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">{n.message}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Pill & Menu */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2.5 p-1.5 pl-2.5 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors"
          >
            <div className="w-7 h-7 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-300 font-bold text-xs border border-zinc-700">
              {user?.role === 'SuperAdmin' ? <Crown className="w-4 h-4 text-amber-400" /> : user?.displayName.charAt(0) || 'U'}
            </div>
            <div className="text-right hidden sm:block">
              <div className="text-xs font-bold text-zinc-200 truncate max-w-[130px]">
                {user?.displayName.split(' ')[0]}
              </div>
              <div className={`text-[10px] font-medium px-1 rounded border inline-block ${getRoleBadgeColor(user?.role)}`}>
                {getRoleLabel(user?.role)}
              </div>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
          </button>

          {showUserMenu && (
            <div className="absolute left-0 mt-2 w-60 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-2 z-50 text-xs" dir="rtl">
              <div className="p-2 border-b border-zinc-800">
                <div className="font-bold text-zinc-100">{user?.displayName}</div>
                <div className="text-zinc-500 text-[11px] mt-0.5">@{user?.username} • {getRoleLabel(user?.role)}</div>
              </div>
              <div className="py-1">
                <div className="px-2 py-1 text-[10px] uppercase text-zinc-500">
                  تغییر سریع حساب کاربری (دمو)
                </div>
                {(['SuperAdmin', 'Admin', 'Editor', 'Supervisor'] as UserRole[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => {
                      switchUserFast(r);
                      setShowUserMenu(false);
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-right transition-colors ${
                      user?.role === r ? 'text-purple-400 bg-purple-500/10 font-bold' : 'text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    <span>حساب {getRoleLabel(r)}</span>
                    {user?.role === r && <UserCheck className="w-3.5 h-3.5" />}
                  </button>
                ))}
              </div>
              <div className="border-t border-zinc-800 pt-1 mt-1">
                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    logout();
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 text-rose-400 hover:bg-rose-500/10 rounded-lg text-right transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  <span>خروج از سیستم</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
