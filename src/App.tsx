import React, { useState, useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { ToastProvider, useToast } from './context/ToastContext.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { Navbar } from './components/Navbar.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { SuperAdminDashboard } from './pages/SuperAdminDashboard.tsx';
import { AdminDashboard } from './pages/AdminDashboard.tsx';
import { EditorDashboard } from './pages/EditorDashboard.tsx';
import { SupervisorDashboard } from './pages/SupervisorDashboard.tsx';
import { VideoDetailsPage } from './pages/VideoDetailsPage.tsx';
import { AuditLogsPage } from './pages/AuditLogsPage.tsx';
import { UsersPage } from './pages/UsersPage.tsx';
import { UploadModal } from './components/UploadModal.tsx';
import { Video } from './types/index.ts';
import { InstallPrompt } from './components/InstallPrompt.tsx';
import { invalidateProjectCache } from './api/projectCache.ts';
import { MessageCircle, X, Send } from 'lucide-react';
import { ChatMessage } from './types/index.ts';
import { api } from './api/client.ts';

const MainLayout: React.FC = () => {
  const { user, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [isUploadOpen, setIsUploadOpen] = useState<boolean>(false);
  const [selectedVideoId, setSelectedVideoId] = useState<number | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessage, setChatMessage] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    if (!isChatOpen) return;
    let active = true;
    const load = async () => {
      try { const data = await api.getChatMessages(); if (active) setChatMessages(data); } catch {}
    };
    load();
    const interval = window.setInterval(load, 5000);
    return () => { active = false; window.clearInterval(interval); };
  }, [isChatOpen]);

  /**
   * دکمه بازگشت موبایل:
   *  - بک اول: از سایت خارج نمی‌شویم؛ فقط پیام «دو بار بک بزن» نشان داده می‌شود
   *    و یک ورودی محافظ به تاریخچه اضافه می‌شود.
   *  - بک دوم (کمتر از ۲ ثانیه بعد): واقعاً از سایت خارج می‌شویم.
   */
  useEffect(() => {
    const GUARD_INTERVAL = 2000;
    let lastBackAt = 0;
    let exiting = false;

    try {
      history.pushState({ twentynegarGuard: true }, '');
    } catch {
      // بعضی مرورگرها pushState را محدود می‌کنند — در آن صورت رفتار پیش‌فرض مرورگر می‌ماند
    }

    const onPopState = (): void => {
      if (exiting) return;
      const now = Date.now();

      if (now - lastBackAt <= GUARD_INTERVAL) {
        // بک دوم و سریع → خروج واقعی از سایت (رفتن به صفحه قبل از سایت)
        exiting = true;
        try {
          history.go(-1);
        } catch {
          // ignore
        }
        window.setTimeout(() => {
          exiting = false;
        }, 800);
        return;
      }

      lastBackAt = now;
      toastRef.current.warning('برای خروج از سایت، دکمه بازگشت را دو بار پشت‌سرهم بزنید.');
      try {
        // ورودی محافظ: تا وقتی دو بک سریع نزده‌اید از سایت خارج نشوید
        history.pushState({ twentynegarGuard: true }, '');
      } catch {
        // ignore
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Default tab based on role
  useEffect(() => {
    if (user?.role === 'SuperAdmin') {
      setActiveTab('superadmin');
    } else {
      setActiveTab('dashboard');
    }
  }, [user?.role]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-zinc-400 font-sans" dir="rtl">
        <div className="w-10 h-10 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mb-4" />
        <div className="text-sm font-semibold text-zinc-300">در حال بارگذاری استودیو ۲۰نگار...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const handleWatchVideo = (video: Video) => {
    setSelectedVideoId(video.id);
  };

  const handleViewDetails = (video: Video) => {
    setSelectedVideoId(video.id);
  };

  const handleBackFromDetails = () => {
    setSelectedVideoId(null);
  };

  const renderContent = () => {
    if (selectedVideoId !== null) {
      return (
        <VideoDetailsPage
          videoId={selectedVideoId}
          onBack={handleBackFromDetails}
        />
      );
    }

    if (activeTab === 'audit-logs' && (user.role === 'Admin' || user.role === 'SuperAdmin')) {
      return <AuditLogsPage />;
    }

    if (activeTab === 'editors') {
      return <UsersPage roleFilter="Editor" />;
    }

    if (activeTab === 'supervisors') {
      return <UsersPage roleFilter="Supervisor" />;
    }

    if (activeTab === 'cameramen') {
      return <UsersPage roleFilter="Cameraman" />;
    }

    // SuperAdmin View
    if (user.role === 'SuperAdmin') {
      if (activeTab === 'superadmin') {
        return (
          <SuperAdminDashboard
            onWatchVideo={handleWatchVideo}
            onViewDetails={handleViewDetails}
          />
        );
      }
      if (activeTab === 'all-videos') {
        return (
          <AdminDashboard
            onWatchVideo={handleWatchVideo}
            onViewDetails={handleViewDetails}
            defaultView="all"
          />
        );
      }
      return (
        <AdminDashboard
          onWatchVideo={handleWatchVideo}
          onViewDetails={handleViewDetails}
          defaultView="approved-only"
        />
      );
    }

    // Admin View
    if (user.role === 'Admin') {
      if (activeTab === 'all-videos') {
        return (
          <AdminDashboard
            onWatchVideo={handleWatchVideo}
            onViewDetails={handleViewDetails}
            defaultView="all"
          />
        );
      }
      return (
        <AdminDashboard
          onWatchVideo={handleWatchVideo}
          onViewDetails={handleViewDetails}
          defaultView="approved-only"
        />
      );
    }

    // Cameraman View — raw footage uploader; editors can see these files.
    if (user.role === 'Cameraman') {
      return (
        <EditorDashboard
          onWatchVideo={handleWatchVideo}
          onViewDetails={handleViewDetails}
          activeFilter={'all'}
        />
      );
    }

    // Editor View
    if (user.role === 'Editor') {
      let filter = 'all';
      if (activeTab === 'pending-review') filter = 'pending';
      if (activeTab === 'approved') filter = 'approved';
      if (activeTab === 'rejected') filter = 'rejected';

      return (
        <EditorDashboard
          onWatchVideo={handleWatchVideo}
          onViewDetails={handleViewDetails}
          activeFilter={filter}
        />
      );
    }

    // Supervisor View
    if (user.role === 'Supervisor') {
      let filter = 'pending';
      if (activeTab === 'approved') filter = 'approved';
      if (activeTab === 'rejected') filter = 'rejected';
      if (activeTab === 'all-assigned') filter = 'all';

      return (
        <SupervisorDashboard
          onWatchVideo={handleWatchVideo}
          onViewDetails={handleViewDetails}
          activeFilter={filter}
        />
      );
    }

    return <div>پیشخوان</div>;
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-purple-600 selection:text-white" dir="rtl">
      <Navbar
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        activeTab={activeTab}
        setActiveTab={(tab) => {
          setSelectedVideoId(null);
          setActiveTab(tab);
        }}
      />

       <div className="flex-1 flex min-w-0">
        <Sidebar
          activeTab={selectedVideoId ? '' : activeTab}
          setActiveTab={(tab) => {
            setSelectedVideoId(null);
            setActiveTab(tab);
          }}
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          onOpenUpload={() => setIsUploadOpen(true)}
        />

         <main className="flex-1 lg:mr-64 p-3 sm:p-6 lg:p-8 min-w-0 overflow-x-hidden pb-[max(1rem,env(safe-area-inset-bottom))]">
          {renderContent()}
        </main>
      </div>

      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onSuccess={(newVideo) => {
          invalidateProjectCache();
          setSelectedVideoId(newVideo.id);
        }}
      />
      <button type="button" onClick={() => setIsChatOpen((open) => !open)} className="chat-fab fixed z-40 w-14 h-14 rounded-full bg-purple-600 hover:bg-purple-500 text-white shadow-2xl shadow-purple-950/60 flex items-center justify-center" aria-label="باز کردن چت">
        {isChatOpen ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
      </button>
      {isChatOpen && <div className="fixed z-40 chat-fab bottom-20 w-[min(22rem,calc(100vw-2rem))] bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-4" dir="rtl">
        <h3 className="font-bold text-white mb-3">چت سریع</h3>
        <div className="min-h-24 max-h-56 overflow-y-auto space-y-2 mb-3">{chatMessages.length === 0 ? <p className="text-xs text-zinc-500">اولین پیام را بنویسید.</p> : chatMessages.map((message) => <div key={message.id} className="text-xs text-zinc-200 bg-zinc-950 rounded-xl p-2"><div className="text-[10px] text-purple-300 mb-1">{message.senderName}</div>{message.message}</div>)}</div>
        <form onSubmit={async (event) => { event.preventDefault(); const text = chatMessage.trim(); if (!text) return; try { const created = await api.sendChatMessage(text); setChatMessages((prev) => [...prev, created]); setChatMessage(''); } catch (err: any) { toast.error(err?.message || 'ارسال پیام ناموفق بود.'); } }} className="flex gap-2"><input value={chatMessage} onChange={(event) => setChatMessage(event.target.value)} placeholder="پیام..." className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3 text-xs text-white" /><button type="submit" className="p-2 rounded-xl bg-purple-600 text-white" aria-label="ارسال پیام"><Send className="w-4 h-4" /></button></form>
      </div>}
    </div>
  );
};

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <MainLayout />
        <InstallPrompt />
      </AuthProvider>
    </ToastProvider>
  );
}
