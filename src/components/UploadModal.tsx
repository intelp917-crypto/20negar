import React, { useEffect, useRef, useState } from 'react';
import {
  UploadCloud,
  X,
  Film,
  CheckCircle2,
  AlertCircle,
  FileVideo,
  Image as ImageIcon,
  Pause,
  Play,
  RotateCcw,
  Loader2,
  ListChecks,
  WifiOff,
  ShieldCheck,
} from 'lucide-react';
import { NewProjectInput, Project, User, Video } from '../types/index.ts';
import { api, getStoredToken } from '../api/client.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { UploadQueue } from '../upload/upload-queue.ts';
import type { QueueItem, QueueStatus } from '../upload/upload-queue.ts';
import { chooseConcurrency } from '../upload/policy.ts';

/**
 * آپلود گروهی — موتور جدید (tus.io)
 * -------------------------------------------------------------------
 * - تکه‌های ۴ مگابایتی روی موبایل/آیفون و ۱۶ مگابایتی روی دسکتاپ
 * - روی موبایل فقط یک فایل هم‌زمان (اینترنت ضعیف با ۴ اتصال موازی اشباع می‌شد)
 * - قطعی اینترنت ⇒ تلاش مجدد خودکار و بی‌پایان از همان بایت
 * - XHR معلق (قفل‌شدن صفحهٔ آیفون) ⇒ نگهبانِ سکوت، درخواست را قطع و ادامه می‌دهد
 * - پس از پایان ارسال، اگر «ثبت ویدیو» شکست بخورد، همان آپلود ذخیره می‌شود و
 *   تلاش دوباره فقط مرحلهٔ ثبت را تکرار می‌کند (بدون ارسال دوبارهٔ فایل)
 * - صفحه در حین آپلود روشن نگه داشته می‌شود تا قفل خودکار گوشی آپلود را نکشد
 */

const MAX_FILE_SIZE = 8 * 1024 * 1024 * 1024; // 8 GB — همان سقف سرور
const MAX_BATCH_FILES = 100;

interface SelectedFile {
  key: string;
  file: File;
  title: string;
}

type Stage = 'idle' | 'starting' | 'uploading' | 'done' | 'partial';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (video: Video) => void;
}

const STATUS_LABEL: Record<QueueStatus, string> = {
  queued: 'در صف',
  uploading: 'در حال ارسال',
  paused: 'متوقف',
  retrying: 'تلاش دوباره…',
  finalizing: 'ثبت در سرور',
  done: 'تکمیل شد',
  error: 'خطا',
  canceled: 'لغو شد',
};

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false
  );
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  return online;
}

export const UploadModal: React.FC<UploadModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { user } = useAuth();
  const isCameraman = user?.role === 'Cameraman';
  const isOnline = useOnlineStatus();

  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [supervisorId, setSupervisorId] = useState<number | ''>('');
  const [supervisors, setSupervisors] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [projectSelection, setProjectSelection] = useState<number | 'new' | ''>('');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const queueRef = useRef<UploadQueue | null>(null);
  const itemsRef = useRef<QueueItem[]>([]);
  const createdVideosRef = useRef<Video[]>([]);
  const autoClosedRef = useRef(false);
  const closingRef = useRef(false);
  const completedRef = useRef(false);

  const isBusy = stage === 'starting' || stage === 'uploading';

  const applyItems = (next: QueueItem[]) => {
    itemsRef.current = next;
    setItems(next);
  };

  useEffect(() => {
    if (isOpen) {
      closingRef.current = false;
      setIsLoadingProjects(true);
      Promise.allSettled([
        isCameraman ? Promise.resolve([] as User[]) : api.getSupervisors(),
        api.getProjects(),
      ]).then(([supervisorResult, projectResult]) => {
        if (supervisorResult.status === 'fulfilled') {
          setSupervisors(supervisorResult.value);
          if (!isCameraman && supervisorResult.value.length > 0) {
            setSupervisorId((current) => (current === '' ? supervisorResult.value[0].id : current));
          }
        } else {
          console.error('Failed to load supervisors:', supervisorResult.reason);
        }
        if (projectResult.status === 'fulfilled') {
          setProjects(projectResult.value);
          setProjectSelection((current) =>
            current !== '' ? current : projectResult.value.length > 0 ? projectResult.value[0].id : 'new'
          );
        } else {
          console.error('Failed to load projects:', projectResult.reason);
          setError(projectResult.reason?.message || 'بارگذاری فهرست پروژه‌ها با خطا مواجه شد.');
        }
        setIsLoadingProjects(false);
      });
    } else {
      queueRef.current?.dispose();
      queueRef.current = null;
      setSelectedFiles([]);
      setSupervisors([]);
      setSupervisorId('');
      setProjects([]);
      setIsLoadingProjects(false);
      setProjectSelection('');
      setNewProjectName('');
      setNewProjectDescription('');
      setItems([]);
      itemsRef.current = [];
      createdVideosRef.current = [];
      autoClosedRef.current = false;
      completedRef.current = false;
      setStage('idle');
      setError(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isCameraman]);

  useEffect(() => () => queueRef.current?.dispose(), []);

  /** پایان دسته: وقتی همهٔ فایل‌ها ثبت شدند، حتی پس از «ادامه» یا «تلاش دوباره». */
  const finalizeBatchIfDone = React.useCallback(
    (list: QueueItem[]) => {
      if (completedRef.current || list.length === 0) return;
      if (!list.every((item) => item.status === 'done')) return;
      completedRef.current = true;
      setStage('done');
      createdVideosRef.current.forEach((video) => onSuccess(video));
      if (!autoClosedRef.current) {
        autoClosedRef.current = true;
        setTimeout(() => onClose(), 1200);
      }
    },
    [onClose, onSuccess]
  );

  useEffect(() => {
    if (stage === 'uploading' || stage === 'partial') finalizeBatchIfDone(items);
  }, [items, stage, finalizeBatchIfDone]);

  if (!isOpen) return null;

  const formatFileSize = (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) return `${(mb / 1024).toFixed(2)} گیگابایت`;
    return `${mb.toFixed(1)} مگابایت`;
  };

  const totalBytes = selectedFiles.reduce((sum, entry) => sum + entry.file.size, 0);

  const overallProgress = (() => {
    if (items.length === 0) return 0;
    const total = items.reduce((sum, item) => sum + item.size, 0);
    if (total === 0) return 0;
    const transferred = items.reduce((sum, item) => {
      if (item.status === 'done') return sum + item.size;
      return sum + Math.min(item.size, item.transferred || 0);
    }, 0);
    return Math.min(100, Math.round((transferred / total) * 100));
  })();

  const addFiles = (incoming: FileList | File[]) => {
    setError(null);
    const list = Array.from(incoming);
    if (list.length === 0) return;

    const rejected: string[] = [];
    const accepted: SelectedFile[] = [];

    for (const file of list) {
      if (!file.name || file.size === 0) {
        rejected.push(`«${file.name || 'فایل بدون نام'}» خالی است`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        rejected.push(`«${file.name}» بزرگ‌تر از ۸ گیگابایت است`);
        continue;
      }
      const isDuplicate = [...selectedFiles, ...accepted].some(
        (entry) =>
          entry.file.name === file.name &&
          entry.file.size === file.size &&
          entry.file.lastModified === file.lastModified
      );
      if (isDuplicate) continue;

      const key = `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`;
      accepted.push({
        key,
        file,
        title: (file.name.substring(0, file.name.lastIndexOf('.')) || file.name).replace(/[_-]/g, ' '),
      });
    }

    if (selectedFiles.length + accepted.length > MAX_BATCH_FILES) {
      setError(`هر بار حداکثر ${MAX_BATCH_FILES} فایل می‌توانید انتخاب کنید.`);
      accepted.splice(Math.max(0, MAX_BATCH_FILES - selectedFiles.length));
    }

    if (accepted.length > 0) {
      setSelectedFiles((prev) => [...prev, ...accepted]);
    }
    if (rejected.length > 0) setError(rejected.join(' • '));
  };

  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (isBusy) return;
    const entries = Array.from(e.dataTransfer.items || [])
      .map((item) => (item as any).webkitGetAsEntry?.())
      .filter(Boolean);
    if (entries.length === 0) {
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
      return;
    }
    const files: File[] = [];
    const readEntry = async (entry: any): Promise<void> => {
      if (entry.isFile) {
        await new Promise<void>((resolve) =>
          entry.file((file: File) => { files.push(file); resolve(); }, () => resolve())
        );
        return;
      }
      if (entry.isDirectory) {
        const reader = entry.createReader();
        for (;;) {
          const batch = await new Promise<any[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
          if (batch.length === 0) break;
          for (const child of batch) await readEntry(child);
        }
      }
    };
    for (const entry of entries) await readEntry(entry);
    addFiles(files);
  };

  /** Open the operating system directory dialog, not a regular file dialog. */
  const selectFolder = async () => {
    if (isBusy) return;
    const picker = (window as Window & { showDirectoryPicker?: () => Promise<any> }).showDirectoryPicker;

    if (!picker || !window.isSecureContext) {
      setError('برای باز شدن پنجره «Select folder»، سامانه را با Chrome یا Edge روی HTTPS یا localhost باز کنید. پنجره انتخاب فایل عمداً باز نمی‌شود.');
      return;
    }

    try {
      const directory = await picker();
      const files: File[] = [];
      const visit = async (handle: any): Promise<void> => {
        for await (const entry of handle.values()) {
          if (entry.kind === 'file') files.push(await entry.getFile());
          else if (entry.kind === 'directory') await visit(entry);
          if (files.length >= MAX_BATCH_FILES) return;
        }
      };
      await visit(directory);
      addFiles(files);
    } catch (err: any) {
      if (err?.name !== 'AbortError') setError('انتخاب فولدر انجام نشد؛ دوباره تلاش کنید.');
    }
  };

  const removeSelectedFile = (key: string) => {
    if (isBusy) return;
    setSelectedFiles((prev) => prev.filter((entry) => entry.key !== key));
  };

  const updateSelectedTitle = (key: string, value: string) => {
    setSelectedFiles((prev) => prev.map((entry) => (entry.key === key ? { ...entry, title: value } : entry)));
  };

  const validate = (): string | null => {
    if (selectedFiles.length === 0) return 'حداقل یک فایل ویدیویی انتخاب کنید.';
    if (selectedFiles.some((entry) => !entry.title.trim())) return 'عنوان همه فایل‌ها الزامی است.';
    if (!isCameraman && !supervisorId) return 'لطفا ناظر کیفی پروژه را انتخاب نمایید.';
    if (!projectSelection) return 'لطفا پروژه را انتخاب نمایید یا ایجاد پروژه جدید را انتخاب کنید.';
    if (projectSelection === 'new' && !newProjectName.trim()) return 'نام پروژه جدید الزامی است.';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setStage('starting');

    let projectId: number;
    try {
      if (projectSelection === 'new') {
        const newProject: NewProjectInput = {
          name: newProjectName.trim(),
          ...(newProjectDescription.trim() ? { description: newProjectDescription.trim() } : {}),
        };
        const createdProject = await api.createProject(newProject);
        projectId = createdProject.id;
      } else {
        projectId = Number(projectSelection);
      }
    } catch (err: any) {
      setError(err?.message || 'ساخت/انتخاب پروژه با خطا مواجه شد.');
      setStage('idle');
      return;
    }

    const queueFiles = selectedFiles.map((entry) => ({ ...entry, title: entry.title.trim() }));
    createdVideosRef.current = [];
    autoClosedRef.current = false;
    completedRef.current = false;

    const sharedFields: Record<string, string> = { projectId: String(projectId) };
    if (!isCameraman) sharedFields.supervisorId = String(supervisorId);

    const token = getStoredToken();
    const queue = new UploadQueue({
      files: queueFiles.map((entry) => ({ key: entry.key, file: entry.file, title: entry.title })),
      fields: sharedFields,
      concurrency: chooseConcurrency(),
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      onUpdate: (next) => applyItems(next),
      finalize: (item, uploadId) =>
        api.createVideoFromUpload(uploadId, {
          ...sharedFields,
          title: item.title,
          fileType: item.file.type || 'application/octet-stream',
        }),
      onVideo: (video) => {
        createdVideosRef.current.push(video);
      },
    });

    queueRef.current = queue;
    applyItems(queue.getItems());
    setStage('uploading');

    try {
      await queue.start();
    } catch (err: any) {
      console.error('[Upload] Queue failed:', err);
    }

    const latest = queue.getItems();
    const allDone = latest.length > 0 && latest.every((item) => item.status === 'done');

    if (allDone) {
      finalizeBatchIfDone(latest);
      return;
    }

    setStage('partial');
    if (latest.some((item) => item.status === 'error')) {
      setError('بعضی فایل‌ها ارسال نشدند؛ از دکمه «تلاش دوباره» همان ردیف استفاده کنید.');
    } else if (latest.some((item) => item.status === 'paused')) {
      setError('آپلود متوقف شده است؛ با دکمه «ادامه» همان ردیف از سر بگیرید.');
    }
  };

  const pauseResumeItem = (item: QueueItem) => {
    if (item.status === 'paused') {
      setError(null);
      setStage('uploading');
      queueRef.current?.resume(item.key);
      return;
    }
    queueRef.current?.pause(item.key);
  };

  const retryItem = (item: QueueItem) => {
    setError(null);
    setStage('uploading');
    queueRef.current?.retry(item.key);
  };

  const cancelUpload = () => {
    queueRef.current?.cancelAll();
    setStage('partial');
    setError('آپلود لغو شد؛ فایل‌های تکمیل‌شده در سامانه ثبت شده‌اند.');
  };

  const handleClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    queueRef.current?.dispose();
    queueRef.current = null;
    onClose();
  };

  const activeCount = items.filter((item) => item.status === 'done').length;
  const retryingCount = items.filter((item) => item.status === 'retrying').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-zinc-900 border border-zinc-700/80 rounded-3xl shadow-2xl overflow-hidden" dir="rtl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-600/20 border border-purple-500/30 text-purple-400 flex items-center justify-center">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-100">
                {isCameraman ? 'بارگذاری گروهی فایل خام تصویربرداری' : 'بارگذاری پروژه‌های ویدیویی جدید'}
              </h3>
              <p className="text-xs text-zinc-400">
                {isCameraman
                  ? 'فایل‌های خام در استخر مشترک تدوین‌گران قرار می‌گیرند و ناظر کیفی ندارند'
                  : 'ارسال گروهی کات‌های تدوین برای بررسی ناظر کیفی استودیو ۲۰نگار'}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={isBusy}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
            aria-label="بستن"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 text-xs max-h-[75vh] overflow-y-auto">
          {!isOnline && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 flex items-center gap-2">
              <WifiOff className="w-4 h-4 shrink-0" />
              <span>اینترنت قطع است. آپلودها متوقف نمی‌شوند و به‌محض وصل‌شدن، خودکار از همان بایت ادامه می‌یابند.</span>
            </div>
          )}

          {/* Drop zone */}
          {stage === 'idle' ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-3xl p-6 text-center cursor-pointer transition-all duration-200 ${
                isDragging
                  ? 'border-purple-500 bg-purple-500/10 scale-[0.99]'
                  : 'border-zinc-700 hover:border-purple-500/60 bg-zinc-950/50 hover:bg-zinc-950/80'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="*/*"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = '';
                }}
                className="hidden"
              />
              <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-zinc-800/80 border border-zinc-700 flex items-center justify-center text-purple-400">
                <UploadCloud className="w-7 h-7" />
              </div>
              <h4 className="text-sm font-bold text-zinc-200 mb-1">
                فایل‌های ویدیو و عکس را اینجا رها کنید (Drag &amp; Drop)
              </h4>
              <p className="text-xs text-zinc-400 mb-3">
                یا برای انتخاب چند فایل هم‌زمان کلیک کنید — تا {MAX_BATCH_FILES} فایل در هر دسته
              </p>
              <span className="inline-flex items-center px-4 py-2 rounded-xl bg-zinc-800 text-zinc-200 text-xs font-semibold border border-zinc-700 shadow-sm">
                انتخاب فایل‌ها
              </span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void selectFolder(); }}
                className="inline-flex items-center px-4 py-2 mr-2 rounded-xl bg-purple-600/20 text-purple-200 text-xs font-semibold border border-purple-500/30 hover:bg-purple-600/30"
              >
                فولدر
              </button>
              <p className="text-[11px] text-zinc-500 mt-3">
                همه فرمت‌های ویدیو و تصویر پذیرفته می‌شوند — هر فایل تا ۸ گیگابایت و هر دسته تا {MAX_BATCH_FILES} فایل
              </p>
            </div>
          ) : null}

          {/* Selected files / live queue */}
          {(stage === 'idle' ? selectedFiles.length > 0 : items.length > 0) && (
            <div className="rounded-2xl bg-zinc-950/60 border border-zinc-800 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800/80 bg-zinc-900/50">
                <div className="flex items-center gap-2 text-zinc-300 font-bold">
                  <ListChecks className="w-4 h-4 text-purple-400" />
                  {stage === 'idle' ? 'فایل‌های انتخاب‌شده' : 'صف آپلود'}
                  <span className="text-[10px] font-mono text-zinc-500">
                    {stage === 'idle' ? selectedFiles.length : items.length} فایل
                  </span>
                </div>
                {stage === 'idle' ? (
                  <span className="text-[10px] font-mono text-zinc-500">{formatFileSize(totalBytes)}</span>
                ) : (
                  <span className="text-[10px] font-mono text-purple-400 font-bold">{overallProgress}%</span>
                )}
              </div>

              {stage !== 'idle' && (
                <div className="h-1.5 bg-zinc-800">
                  <div
                    className="h-full bg-purple-500 transition-all duration-300"
                    style={{ width: `${overallProgress}%` }}
                  />
                </div>
              )}

              <div className="max-h-64 overflow-y-auto divide-y divide-zinc-800/60">
                {stage === 'idle'
                  ? selectedFiles.map((entry) => (
                      <div key={entry.key} className="p-3 flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center shrink-0">
                          {entry.file.type.startsWith('image/') ? <ImageIcon className="w-4 h-4" /> : <FileVideo className="w-4 h-4" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-semibold text-zinc-200 truncate">{entry.file.name}</div>
                          <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                            {formatFileSize(entry.file.size)} • {entry.file.name.split('.').pop()?.toUpperCase()}
                          </div>
                          <input
                            type="text"
                            value={entry.title}
                            onChange={(e) => updateSelectedTitle(entry.key, e.target.value)}
                            placeholder={entry.file.type.startsWith('image/') ? 'عنوان تصویر' : 'عنوان ویدیو'}
                            className="mt-1.5 w-full bg-zinc-900 border border-zinc-800 focus:border-purple-500 rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-200 focus:outline-none focus:ring-1 focus:ring-purple-500"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeSelectedFile(entry.key)}
                          className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          aria-label="حذف از صف"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  : items.map((item) => (
                      <div key={item.key} className="p-3 space-y-1.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-zinc-900 text-zinc-300 border border-zinc-800 flex items-center justify-center shrink-0">
                            {item.status === 'done' ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            ) : item.status === 'error' ? (
                              <AlertCircle className="w-4 h-4 text-rose-400" />
                            ) : item.status === 'finalizing' ? (
                              <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
                            ) : item.status === 'paused' ? (
                              <Pause className="w-4 h-4 text-amber-400" />
                            ) : item.status === 'retrying' ? (
                              <RotateCcw className="w-4 h-4 text-amber-300 animate-spin" />
                            ) : item.file.type.startsWith('image/') ? (
                              <ImageIcon className="w-4 h-4 text-sky-400" />
                            ) : (
                              <FileVideo className="w-4 h-4 text-purple-400" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-semibold text-zinc-200 truncate">{item.title}</span>
                              <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                                {item.status === 'done' ? '۱۰۰٪' : `${item.progress}%`}
                              </span>
                            </div>
                            <div className="text-[10px] text-zinc-500 truncate">{item.name}</div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {(item.status === 'uploading' || item.status === 'paused' || item.status === 'retrying') && (
                              <button
                                type="button"
                                onClick={() => pauseResumeItem(item)}
                                className="p-1.5 rounded-lg text-zinc-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors"
                                title={item.status === 'paused' ? 'ادامه' : 'توقف موقت'}
                              >
                                {item.status === 'paused' ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                              </button>
                            )}
                            {item.status === 'error' && (
                              <button
                                type="button"
                                onClick={() => retryItem(item)}
                                className="p-1.5 rounded-lg text-zinc-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
                                title="تلاش دوباره"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-200 ${
                              item.status === 'error'
                                ? 'bg-rose-500'
                                : item.status === 'done'
                                  ? 'bg-emerald-500'
                                  : item.status === 'retrying' || item.status === 'paused'
                                    ? 'bg-amber-500'
                                    : 'bg-purple-500'
                            }`}
                            style={{ width: `${item.status === 'done' ? 100 : item.progress}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[10px]">
                          <span
                            className={
                              item.status === 'error'
                                ? 'text-rose-400'
                                : item.status === 'done'
                                  ? 'text-emerald-400'
                                  : item.status === 'paused' || item.status === 'retrying'
                                    ? 'text-amber-400'
                                    : 'text-zinc-500'
                            }
                          >
                            {item.error || item.message || STATUS_LABEL[item.status]}
                          </span>
                          {item.status === 'done' && (
                            <span className="text-zinc-600 font-mono">ثبت شد</span>
                          )}
                        </div>
                      </div>
                    ))}
              </div>
            </div>
          )}

          {/* Form fields */}
          <div className="space-y-4">
            <div>
              <label className="block font-semibold text-zinc-300 mb-1.5">
                پروژه <span className="text-purple-400">*</span>
              </label>
              <select
                required
                disabled={isBusy || isLoadingProjects || stage === 'done' || stage === 'partial'}
                value={projectSelection}
                onChange={(e) => {
                  const value = e.target.value;
                  setProjectSelection(value === 'new' ? 'new' : value ? Number(value) : '');
                  setError(null);
                }}
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500 rounded-xl px-3.5 py-2.5 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all disabled:opacity-50"
              >
                {isLoadingProjects && <option value="">در حال بارگذاری پروژه‌ها...</option>}
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
                <option value="new">+ ایجاد پروژه جدید</option>
              </select>
              {stage === 'idle' && selectedFiles.length > 1 && projectSelection !== 'new' && (
                <p className="text-[10px] text-zinc-500 mt-1">همه فایل‌های این دسته در همین پروژه ثبت می‌شوند.</p>
              )}
            </div>

            {projectSelection === 'new' && (
              <div className="space-y-3 p-3.5 rounded-xl bg-zinc-950/60 border border-zinc-800">
                <div>
                  <label className="block font-semibold text-zinc-300 mb-1.5">
                    نام پروژه جدید <span className="text-purple-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    disabled={isBusy}
                    value={newProjectName}
                    onChange={(e) => {
                      setNewProjectName(e.target.value);
                      setError(null);
                    }}
                    className="w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500 rounded-xl px-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-zinc-300 mb-1.5">جزئیات پروژه</label>
                  <textarea
                    rows={2}
                    disabled={isBusy}
                    value={newProjectDescription}
                    onChange={(e) => {
                      setNewProjectDescription(e.target.value);
                      setError(null);
                    }}
                    className="w-full resize-none bg-zinc-950 border border-zinc-800 focus:border-purple-500 rounded-xl px-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all disabled:opacity-50"
                  />
                </div>
              </div>
            )}

            {isCameraman ? (
              <div className="p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/25 text-[11px] text-sky-200 leading-relaxed">
                این فایل‌ها به‌صورت خام ثبت می‌شوند و فقط در پنل تدوین‌گران (و مدیرکل) دیده می‌شوند.
                انتخاب ناظر کیفی هنگام «انتشار نسخه ادیت‌شده» توسط تدوین‌گر انجام می‌شود.
              </div>
            ) : (
              <div>
                <label className="block font-semibold text-zinc-300 mb-1.5">
                  انتخاب سرپرست / ناظر کیفی <span className="text-purple-400">*</span>
                </label>
                <select
                  required
                  disabled={isBusy}
                  value={supervisorId}
                  onChange={(e) => {
                    setSupervisorId(Number(e.target.value));
                    setError(null);
                  }}
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500 rounded-xl px-3.5 py-2.5 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all disabled:opacity-50"
                >
                  {supervisors.length === 0 && <option value="">در حال بارگذاری لیست ناظران...</option>}
                  {supervisors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.displayName} (@{s.username})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-zinc-500 mt-1">
                  ویدیوها مستقیماً برای این ناظر کیفی ارسال می‌شوند و پس از تایید او به لیست ادمین افزوده می‌شوند.
                </p>
              </div>
            )}
          </div>

          {/* Status banners */}
          {stage === 'done' && (
            <div className="p-4 rounded-2xl bg-emerald-950/25 border border-emerald-500/30 space-y-1.5">
              <p className="text-emerald-300 font-bold flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                {createdVideosRef.current.length} ویدیو با موفقیت ثبت شد.
              </p>
              <p className="text-[11px] text-zinc-400">
                فایل‌ها دست‌نخورده ذخیره شده‌اند و پخش از همان نسخه اصلی انجام می‌شود.
              </p>
            </div>
          )}

          {stage === 'uploading' && (
            <div className="p-4 rounded-2xl bg-purple-950/20 border border-purple-500/30 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-200 font-medium">
                  {`در حال ارسال ${activeCount} از ${items.length} فایل${retryingCount > 0 ? ` • ${retryingCount} در انتظار اتصال` : ''}`}
                </span>
                <span className="font-mono text-purple-400 font-bold">{overallProgress}%</span>
              </div>
              <p className="text-[10px] text-zinc-500 leading-relaxed">
                اگر اینترنت قطع یا کند شود، ارسال از همان بایت متوقف‌شده ادامه می‌یابد؛ نیازی به انتخاب دوباره فایل نیست.
              </p>
              <p className="text-[10px] text-emerald-300/80 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                برای جلوگیری از قطع آپلود، صفحه را روشن نگه دارید و از قفل کردن گوشی خودداری کنید.
              </p>
            </div>
          )}

          {stage === 'partial' && (
            <div className="p-3.5 rounded-xl bg-zinc-950/60 border border-zinc-800 text-[11px] text-zinc-400 leading-relaxed">
              فایل‌هایی که کامل رسیده‌اند در سامانه ثبت شده‌اند. برای فایل‌های ناتمام، «تلاش دوباره» را بزنید؛
              ارسال از همان بایت ادامه می‌یابد و فایل دوباره ارسال نمی‌شود.
            </div>
          )}

          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
            <button
              type="button"
              onClick={handleClose}
              disabled={isBusy}
              className="px-4 py-2 text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              {stage === 'done' ? 'بستن' : 'انصراف'}
            </button>
            {stage === 'uploading' ? (
              <button
                type="button"
                onClick={cancelUpload}
                className="px-5 py-2.5 font-bold rounded-xl bg-zinc-800 hover:bg-rose-600/80 text-white border border-zinc-700 transition-all flex items-center gap-2"
              >
                <X className="w-4 h-4" />
                لغو آپلود
              </button>
            ) : stage === 'starting' ? (
              <button
                type="button"
                disabled
                className="px-5 py-2.5 font-bold rounded-xl bg-purple-600/70 text-white transition-all flex items-center gap-2"
              >
                <Loader2 className="w-4 h-4 animate-spin" />
                در حال آماده‌سازی پروژه...
              </button>
            ) : stage === 'partial' ? (
              <button
                type="button"
                onClick={handleClose}
                className="px-5 py-2.5 font-bold rounded-xl bg-purple-600 hover:bg-purple-500 text-white transition-all shadow-lg shadow-purple-950/50 flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                پایان
              </button>
            ) : stage === 'done' ? null : (
              <button
                type="submit"
                disabled={selectedFiles.length === 0}
                className="px-5 py-2.5 font-bold rounded-xl bg-purple-600 hover:bg-purple-500 text-white transition-all shadow-lg shadow-purple-950/50 disabled:opacity-50 flex items-center gap-2"
              >
                <UploadCloud className="w-4 h-4" />
                {isCameraman
                  ? `ثبت ${selectedFiles.length > 1 ? `${selectedFiles.length} فایل خام` : 'فایل خام'} برای تدوین‌گران`
                  : `ارسال ${selectedFiles.length > 1 ? `${selectedFiles.length} ویدیو` : 'برای بررسی ناظر'}`}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
