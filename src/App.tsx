import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
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
import { DocumentationPage } from './pages/DocumentationPage.tsx';
import { UploadModal } from './components/UploadModal.tsx';
import { Video } from './types/index.ts';

const MainLayout: React.FC = () => {
  const { user, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [isUploadOpen, setIsUploadOpen] = useState<boolean>(false);
  const [selectedVideoId, setSelectedVideoId] = useState<number | null>(null);

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

    if (activeTab === 'docs') {
      return <DocumentationPage />;
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

      <div className="flex-1 flex">
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

        <main className="flex-1 lg:mr-64 p-4 sm:p-6 lg:p-8 min-w-0">
          {renderContent()}
        </main>
      </div>

      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onSuccess={(newVideo) => {
          setSelectedVideoId(newVideo.id);
        }}
      />
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <MainLayout />
    </AuthProvider>
  );
}
