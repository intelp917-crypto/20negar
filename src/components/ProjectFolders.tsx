import React from 'react';
import { ProjectFolder } from '../types/index.ts';
import {
  Folder,
  FolderOpen,
  Lock,
  Archive,
  Clock,
  CheckCircle2,
  XCircle,
  Film,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Shield,
} from 'lucide-react';

interface ProjectFolderGridProps {
  folders: ProjectFolder[];
  isLoading: boolean;
  error?: string | null;
  onOpen: (folder: ProjectFolder) => void;
  onRetry?: () => void;
  title?: string;
  subtitle?: string;
}

const ACCENTS = [
  { box: 'border-purple-500/25 hover:border-purple-500/70', icon: 'bg-purple-500/15 text-purple-300 border-purple-500/25', bar: 'bg-purple-500' },
  { box: 'border-sky-500/25 hover:border-sky-500/70', icon: 'bg-sky-500/15 text-sky-300 border-sky-500/25', bar: 'bg-sky-500' },
  { box: 'border-emerald-500/25 hover:border-emerald-500/70', icon: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25', bar: 'bg-emerald-500' },
  { box: 'border-amber-500/25 hover:border-amber-500/70', icon: 'bg-amber-500/15 text-amber-300 border-amber-500/25', bar: 'bg-amber-500' },
  { box: 'border-indigo-500/25 hover:border-indigo-500/70', icon: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/25', bar: 'bg-indigo-500' },
  { box: 'border-rose-500/25 hover:border-rose-500/70', icon: 'bg-rose-500/15 text-rose-300 border-rose-500/25', bar: 'bg-rose-500' },
];

function accentFor(projectId: number | null) {
  const index = projectId === null ? 0 : Math.abs(projectId) % ACCENTS.length;
  return ACCENTS[index];
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('fa-IR');
}

const StatChip: React.FC<{ label: string; value: number; tone: string }> = ({ label, value, tone }) => (
  <div className="rounded-xl bg-zinc-950/70 border border-zinc-800 px-2 py-1.5 text-center">
    <div className={`font-mono text-sm font-bold ${tone}`}>{value}</div>
    <div className="text-[10px] text-zinc-500 mt-0.5 whitespace-nowrap">{label}</div>
  </div>
);

export const ProjectFolderGrid: React.FC<ProjectFolderGridProps> = ({
  folders,
  isLoading,
  error,
  onOpen,
  onRetry,
  title = 'پوشه‌های پروژه',
  subtitle = 'برای مشاهده ویدیوها، ابتدا وارد پوشه پروژه شوید.',
}) => {
  return (
    <section className="space-y-4" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-purple-400" />
            {title}
            {!isLoading && (
              <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700">
                {folders.length}
              </span>
            )}
          </h2>
          <p className="text-xs text-zinc-500 mt-1">{subtitle}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-48 rounded-3xl bg-zinc-900/60 border border-zinc-800 animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="py-14 text-center bg-rose-950/20 border border-rose-500/25 rounded-3xl">
          <XCircle className="w-10 h-10 text-rose-400/70 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-rose-200">دریافت پوشه‌های پروژه ممکن نشد</h3>
          <p className="text-xs text-rose-300/70 mt-1 mb-4">{error}</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 border border-rose-500/30 text-rose-200 text-xs font-bold hover:bg-rose-500/10 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              تلاش دوباره
            </button>
          )}
        </div>
      ) : folders.length === 0 ? (
        <div className="py-16 text-center bg-zinc-900/50 border border-zinc-800 rounded-3xl">
          <Folder className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-zinc-300">هنوز پوشه‌ای برای شما وجود ندارد</h3>
          <p className="text-xs text-zinc-500 mt-1 max-w-md mx-auto">
            با بارگذاری اولین ویدیو در یک پروژه، پوشه آن پروژه به‌طور خودکار در این بخش ساخته می‌شود.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {folders.map((folder) => {
            const accent = accentFor(folder.projectId);
            return (
              <button
                key={folder.projectId === null ? 'none' : folder.projectId}
                type="button"
                onClick={() => onOpen(folder)}
                className={`group text-right rounded-3xl border bg-zinc-900/85 p-5 shadow-lg hover:shadow-2xl hover:bg-zinc-900 transition-all duration-200 ${accent.box}`}
                aria-label={`ورود به پوشه ${folder.name}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className={`w-12 h-12 rounded-2xl border flex items-center justify-center shrink-0 ${accent.icon}`}>
                    {folder.projectId === null ? <FolderOpen className="w-6 h-6" /> : <Folder className="w-6 h-6" />}
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {folder.isConfidential && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-300 border border-rose-500/30 text-[10px] font-semibold">
                        <Lock className="w-3 h-3" />
                        محرمانه
                      </span>
                    )}
                    {folder.status === 'archived' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700 text-[10px] font-semibold">
                        <Archive className="w-3 h-3" />
                        آرشیو
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-800/80 text-zinc-300 border border-zinc-700/80 text-[10px] font-mono">
                      <Film className="w-3 h-3" />
                      {folder.videoCount} ویدیو
                    </span>
                  </div>
                </div>

                <h3 className="mt-4 text-sm font-bold text-zinc-100 group-hover:text-purple-200 transition-colors line-clamp-1" title={folder.name}>
                  {folder.name}
                </h3>
                <p className="mt-1 text-[11px] text-zinc-500 line-clamp-2 min-h-[2rem]">
                  {[folder.description, folder.clientName ? `کارفرما: ${folder.clientName}` : null, folder.projectCode]
                    .filter(Boolean)
                    .join(' • ') || 'بدون توضیحات'}
                </p>

                <div className="mt-3 grid grid-cols-4 gap-1.5">
                  <StatChip label="کل" value={folder.videoCount} tone="text-zinc-100" />
                  <StatChip label="تایید" value={folder.approvedCount} tone="text-emerald-400" />
                  <StatChip label="در انتظار" value={folder.pendingCount} tone="text-amber-400" />
                  <StatChip label="رد شده" value={folder.rejectedCount} tone="text-rose-400" />
                </div>

                <div className="mt-3 pt-3 border-t border-zinc-800/80 flex items-center justify-between text-[11px] text-zinc-500">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    آخرین فعالیت: {formatDate(folder.lastVideoAt)}
                  </span>
                  <span className="inline-flex items-center gap-1 font-semibold text-purple-300 group-hover:text-purple-200">
                    ورود به پوشه
                    <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};

interface ProjectFolderBarProps {
  folder: ProjectFolder;
  onBack: () => void;
  loadedCount?: number;
}

export const ProjectFolderBar: React.FC<ProjectFolderBarProps> = ({ folder, onBack, loadedCount }) => {
  const accent = accentFor(folder.projectId);
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl bg-zinc-900/90 border border-zinc-800 p-4" dir="rtl">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-800 text-xs font-semibold transition-colors shrink-0"
        >
          <ArrowRight className="w-3.5 h-3.5" />
          همه پروژه‌ها
        </button>
        <span className="hidden sm:block w-px h-8 bg-zinc-800" />
        <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${accent.icon}`}>
          {folder.projectId === null ? <FolderOpen className="w-5 h-5" /> : <Folder className="w-5 h-5" />}
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-white truncate flex items-center gap-2" title={folder.name}>
            {folder.name}
            {folder.isConfidential && <Lock className="w-3.5 h-3.5 text-rose-400 shrink-0" />}
          </h2>
          <p className="text-[11px] text-zinc-500 truncate">
            {[folder.clientName ? `کارفرما: ${folder.clientName}` : null, folder.projectCode, folder.description]
              .filter(Boolean)
              .join(' • ') || 'ویدیوهای این پروژه'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-800 text-[11px] text-zinc-300 font-mono">
          <Film className="w-3.5 h-3.5 text-purple-400" />
          {loadedCount === undefined ? `${folder.videoCount} ویدیو` : `${loadedCount} از ${folder.videoCount} ویدیو`}
        </span>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/25 text-[11px] text-amber-300 font-mono">
          <Clock className="w-3.5 h-3.5" />
          {folder.pendingCount} در انتظار
        </span>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-[11px] text-emerald-300 font-mono">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {folder.approvedCount} تایید
        </span>
        {folder.isConfidential && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/25 text-[11px] text-rose-300 font-mono">
            <Shield className="w-3.5 h-3.5" />
            محرمانه
          </span>
        )}
      </div>
    </div>
  );
};
