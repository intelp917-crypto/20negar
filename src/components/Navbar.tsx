import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { AppNotification, UserRole } from '../types/index.ts';
import { api } from '../api/client.ts';
import {
  disablePush,
  enablePush,
  getPushState,
  playNotificationChime,
  sendTestPush,
  syncPushSubscription,
  type PushState,
} from '../push.ts';
import {
  Bell,
  BellRing,
  CheckCircle2,
  AlertTriangle,
  Info,
  XCircle,
  LogOut,
  ChevronDown,
  Menu,
  Film,
  Crown,
  Network,
  Smartphone,
  Loader2,
} from 'lucide-react';

interface NavbarProps {
  onToggleSidebar?: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onToggleSidebar, setActiveTab }) => {
  const { user, logout } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [internalUrl, setInternalUrl] = useState<string | null>(null);
  const [internalState, setInternalState] = useState<'unknown' | 'available' | 'unavailable'>('unknown');
  const [pushState, setPushState] = useState<PushState | 'loading'>('loading');
  const [pushDevices, setPushDevices] = useState(0);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const notificationRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  // برای تشخیص اعلان تازه و پخش زنگ فقط یک بار برای هر اعلان.
  const seenNotificationIds = useRef<Set<number> | null>(null);

  const fetchNotifications = async () => {
    try {
      const data = await api.getNotifications();
      setNotifications(data);

      const seen = seenNotificationIds.current;
      if (seen && data.some((n) => !n.isRead && !seen.has(n.id))) {
        playNotificationChime();
      }
      seenNotificationIds.current = new Set(data.map((n) => n.id));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 10000);
    return () => clearInterval(interval);
  }, [user]);

  const refreshPushState = async () => {
    try {
      const status = await getPushState();
      setPushState(status.state);
      setPushDevices(status.devices);
    } catch {
      setPushState('available');
    }
  };

  useEffect(() => {
    if (!user) return;
    let active = true;
    // اگر همین مرورگر قبلاً مشترک شده، اشتراکش را به حساب کاربر جاری وصل کن.
    syncPushSubscription()
      .then(() => { if (active) return refreshPushState(); })
      .catch(() => { if (active) setPushState('available'); });
    return () => { active = false; };
  }, [user?.id]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.type !== '20negar:push-received') return;
      playNotificationChime();
      fetchNotifications();
      refreshPushState();
    };
    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
  }, [user?.id]);

  const handleEnablePush = async () => {
    setPushBusy(true);
    setPushMessage(null);
    try {
      const result = await enablePush();
      setPushState(result.state);
      setPushDevices(result.devices);
      if (result.state === 'subscribed') {
        setPushMessage({ text: 'اعلان روی این دستگاه فعال شد. یک اعلان آزمایشی بفرستیم؟', tone: 'ok' });
      } else if (result.state === 'denied') {
        setPushMessage({ text: 'اجازه اعلان مسدود شده است؛ از تنظیمات مرورگر اجازه دهید.', tone: 'error' });
      } else {
        setPushMessage({ text: 'فعال‌سازی اعلان کامل نشد؛ دوباره تلاش کنید.', tone: 'error' });
      }
    } catch (err: any) {
      setPushMessage({ text: err?.message || 'فعال‌سازی اعلان با خطا مواجه شد.', tone: 'error' });
    } finally {
      setPushBusy(false);
    }
  };

  const handleDisablePush = async () => {
    setPushBusy(true);
    setPushMessage(null);
    try {
      const result = await disablePush();
      setPushState(result.state);
      setPushDevices(result.devices);
      setPushMessage({ text: 'اعلان روی این دستگاه غیرفعال شد.', tone: 'ok' });
    } catch (err: any) {
      setPushMessage({ text: err?.message || 'غیرفعال کردن اعلان با خطا مواجه شد.', tone: 'error' });
    } finally {
      setPushBusy(false);
    }
  };

  const handleTestPush = async () => {
    setPushBusy(true);
    setPushMessage(null);
    try {
      const sent = await sendTestPush();
      setPushMessage({
        text: sent > 0 ? 'اعلان آزمایشی ارسال شد؛ چند لحظه صبر کنید.' : 'دستگاه فعالی برای ارسال پیدا نشد.',
        tone: sent > 0 ? 'ok' : 'error',
      });
    } catch (err: any) {
      setPushMessage({ text: err?.message || 'ارسال اعلان آزمایشی با خطا مواجه شد.', tone: 'error' });
    } finally {
      setPushBusy(false);
    }
  };

  useEffect(() => {
    let active = true;
    api.getInternalAccess().then((config) => {
      if (active && config.enabled && config.url) {
        setInternalUrl(config.url);
        setInternalState(config.lastHealthStatus === 'healthy' ? 'available' : 'unknown');
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [user]);

  const openInternalApp = async () => {
    if (!internalUrl) return;
    setInternalState('unknown');
    try {
      const response = await fetch(`${internalUrl}/api/health`, { credentials: 'omit', signal: AbortSignal.timeout(3000) });
      const body = await response.json();
      if (!response.ok || body?.service !== '20Negar Studio API') throw new Error('unavailable');
      setInternalState('available');
      window.location.assign(internalUrl);
    } catch {
      setInternalState('unavailable');
      window.alert('دسترسی داخلی در حال حاضر قابل تأیید نیست. اتصال عمومی حفظ شد.');
    }
  };

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
        return 'مدیرکل';
      case 'Editor':
        return 'تدوین‌گر';
      case 'Supervisor':
        return 'ناظر کیفی';
      case 'Cameraman':
        return 'تصویربردار';
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
      case 'Cameraman':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      case 'Editor':
      default:
        return 'bg-sky-500/10 text-sky-400 border-sky-500/30';
    }
  };

  return (
    <header className="h-16 min-h-16 bg-zinc-950/95 backdrop-blur-md border-b border-zinc-800 sticky top-0 z-50 px-3 sm:px-4 lg:px-6 flex items-center justify-between" dir="rtl">
      <div className="flex items-center gap-3">
        {internalUrl && (
          <button onClick={openInternalApp} className={`hidden sm:flex items-center gap-1.5 px-2.5 py-2 rounded-xl border text-xs font-semibold transition-colors ${internalState === 'available' ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10' : internalState === 'unavailable' ? 'border-rose-500/40 text-rose-300 bg-rose-500/10' : 'border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-900'}`} title="بررسی و ورود به برنامه داخلی">
            <Network className="w-4 h-4" />
            <span>برنامه داخلی</span>
          </button>
        )}
        <button
          onClick={onToggleSidebar}
           className="p-2.5 min-w-11 min-h-11 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-900 lg:hidden touch-manipulation"
           aria-label="باز کردن منوی دسترسی"
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

              {/* اعلان روی گوشی (Web Push) */}
              <div className="border-t border-zinc-800 mt-1 pt-2.5 px-2.5 pb-1.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-bold text-zinc-300">
                    <Smartphone className="w-3.5 h-3.5 text-purple-400" />
                    اعلان روی گوشی
                  </span>
                  {pushState === 'subscribed' ? (
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                      <BellRing className="w-3 h-3" />
                      فعال{pushDevices > 1 ? ` (${pushDevices} دستگاه)` : ''}
                    </span>
                  ) : pushState === 'loading' ? (
                    <Loader2 className="w-3.5 h-3.5 text-zinc-500 animate-spin" />
                  ) : null}
                </div>

                {pushState === 'insecure' && (
                  <p className="text-[10px] leading-relaxed text-amber-300/90">
                    برای دریافت اعلان روی گوشی، برنامه باید از طریق HTTPS معتبر باز شود.
                  </p>
                )}
                {pushState === 'unsupported' && (
                  <p className="text-[10px] leading-relaxed text-zinc-400">
                    این مرورگر از اعلان پوش پشتیبانی نمی‌کند. در iPhone برنامه را به «صفحه اصلی» اضافه کنید (iOS 16.4+).
                  </p>
                )}
                {pushState === 'unavailable' && (
                  <p className="text-[10px] leading-relaxed text-rose-300/90">
                    سرویس اعلان سرور در دسترس نیست؛ کلیدهای VAPID را بررسی کنید.
                  </p>
                )}
                {pushState === 'denied' && (
                  <p className="text-[10px] leading-relaxed text-rose-300/90">
                    اجازه اعلان در تنظیمات مرورگر مسدود شده است؛ از تنظیمات سایت اجازه دهید و دوباره تلاش کنید.
                  </p>
                )}

                {(pushState === 'available' || pushState === 'subscribed') && (
                  <div className="flex items-center gap-2">
                    {pushState === 'available' ? (
                      <button
                        onClick={handleEnablePush}
                        disabled={pushBusy}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold transition-colors disabled:opacity-50"
                      >
                        {pushBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BellRing className="w-3.5 h-3.5" />}
                        فعال‌سازی اعلان با صدا
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={handleTestPush}
                          disabled={pushBusy}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold border border-zinc-700 transition-colors disabled:opacity-50"
                        >
                          {pushBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bell className="w-3.5 h-3.5" />}
                          ارسال آزمایشی
                        </button>
                        <button
                          onClick={handleDisablePush}
                          disabled={pushBusy}
                          className="px-2.5 py-2 rounded-lg text-zinc-400 hover:text-rose-300 hover:bg-rose-500/10 border border-zinc-800 transition-colors disabled:opacity-50"
                        >
                          غیرفعال
                        </button>
                      </>
                    )}
                  </div>
                )}
                {pushMessage && (
                  <p className={`text-[10px] leading-relaxed ${pushMessage.tone === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {pushMessage.text}
                  </p>
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
