import React, { useState, useEffect, useRef } from 'react';
import { UploadCloud, X, Film, CheckCircle2, AlertCircle, FileVideo } from 'lucide-react';
import { NewProjectInput, Project, User, Video } from '../types/index.ts';
import { api } from '../api/client.ts';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (video: Video) => void;
}

export const UploadModal: React.FC<UploadModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [supervisorId, setSupervisorId] = useState<number | ''>('');
  const [supervisors, setSupervisors] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [projectSelection, setProjectSelection] = useState<number | 'new' | ''>('');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setIsLoadingProjects(true);
      Promise.allSettled([api.getSupervisors(), api.getProjects()]).then(([supervisorResult, projectResult]) => {
        if (supervisorResult.status === 'fulfilled') {
          setSupervisors(supervisorResult.value);
          if (supervisorResult.value.length > 0 && !supervisorId) setSupervisorId(supervisorResult.value[0].id);
        } else {
          console.error('Failed to load supervisors:', supervisorResult.reason);
        }
        if (projectResult.status === 'fulfilled') {
          setProjects(projectResult.value);
          if (projectResult.value.length > 0) setProjectSelection(projectResult.value[0].id);
          else setProjectSelection('new');
        } else {
          console.error('Failed to load projects:', projectResult.reason);
          setError(projectResult.reason?.message || 'بارگذاری فهرست پروژه‌ها با خطا مواجه شد.');
        }
        setIsLoadingProjects(false);
      });
    } else {
      setFile(null);
      setTitle('');
      setProjects([]);
      setIsLoadingProjects(false);
      setProjectSelection('');
      setNewProjectName('');
      setNewProjectDescription('');
      setUploadProgress(null);
      setIsProcessing(false);
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      selectFile(e.dataTransfer.files[0]);
    }
  };

  const selectFile = (selected: File) => {
    setError(null);
    // پذیرش همه فرمت‌های ویدیویی — تبدیل به فرمت استریم سمت سرور انجام می‌شود
    if (!selected.name || selected.size === 0) {
      setError('فایل انتخاب‌شده خالی است. لطفاً یک فایل ویدیویی معتبر انتخاب کنید.');
      return;
    }

    setFile(selected);
    if (!title) {
      const nameWithoutExt = selected.name.substring(0, selected.name.lastIndexOf('.')) || selected.name;
      setTitle(nameWithoutExt.replace(/[_-]/g, ' '));
    }
  };

  const formatFileSize = (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(2)} گیگابایت`;
    }
    return `${mb.toFixed(1)} مگابایت`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('لطفا فایل ویدیویی را انتخاب کنید.');
      return;
    }
    if (!title.trim()) {
      setError('عنوان پروژه ویدیویی الزامی است.');
      return;
    }
    if (!supervisorId) {
      setError('لطفا ناظر کیفی پروژه را انتخاب نمایید.');
      return;
    }
    if (!projectSelection) {
      setError('لطفا پروژه را انتخاب نمایید یا ایجاد پروژه جدید را انتخاب کنید.');
      return;
    }

    let newProject: NewProjectInput | undefined;
    if (projectSelection === 'new') {
      if (!newProjectName.trim()) {
        setError('نام پروژه جدید الزامی است.');
        return;
      }
      newProject = {
        name: newProjectName.trim(),
        ...(newProjectDescription.trim() ? { description: newProjectDescription.trim() } : {}),
      };
    }

    setError(null);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('video', file);
    formData.append('title', title.trim());
    formData.append('supervisorId', String(supervisorId));
    if (projectSelection === 'new') {
      formData.append('projectName', newProject!.name);
      if (newProject!.description) formData.append('projectDescription', newProject!.description);
    } else {
      formData.append('projectId', String(projectSelection));
    }

    try {
      const created = await api.uploadVideo(formData, (percent) => {
        setUploadProgress(percent);
      });
      setIsProcessing(true);
      setTimeout(() => {
        onSuccess(created);
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err.message || 'بارگذاری با خطا متوقف شد.');
      setUploadProgress(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-zinc-900 border border-zinc-700/80 rounded-3xl shadow-2xl overflow-hidden" dir="rtl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-600/20 border border-purple-500/30 text-purple-400 flex items-center justify-center">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-100">بارگذاری پروژه ویدیویی جدید</h3>
              <p className="text-xs text-zinc-400">ارسال کات تدوین برای بررسی ناظر کیفی استودیو ۲۰نگار</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={uploadProgress !== null}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 text-xs">
          {/* Drag & Drop Area */}
          {!file ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-3xl p-8 text-center cursor-pointer transition-all duration-200 ${
                isDragging
                  ? 'border-purple-500 bg-purple-500/10 scale-[0.99]'
                  : 'border-zinc-700 hover:border-purple-500/60 bg-zinc-950/50 hover:bg-zinc-950/80'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,.mkv,.mpg,.mpeg,.mts,.m2ts,.mxf,.ogv,.flv,.3gp,.vob,.ts,.divx,.f4v,.wmv,.mov,.mp4,.webm,.avi,.m4v"
                onChange={(e) => e.target.files?.[0] && selectFile(e.target.files[0])}
                className="hidden"
              />
              <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-zinc-800/80 border border-zinc-700 flex items-center justify-center text-purple-400">
                <UploadCloud className="w-7 h-7" />
              </div>
              <h4 className="text-sm font-bold text-zinc-200 mb-1">
                فایل ویدیو را اینجا رها کنید (Drag & Drop)
              </h4>
              <p className="text-xs text-zinc-400 mb-3">یا برای انتخاب فایل از کامپیوتر کلیک کنید</p>
              <span className="inline-flex items-center px-4 py-2 rounded-xl bg-zinc-800 text-zinc-200 text-xs font-semibold border border-zinc-700 shadow-sm">
                انتخاب فایل ویدیو
              </span>
              <p className="text-[11px] text-zinc-500 mt-3">
                همه فرمت‌های ویدیویی پشتیبانی می‌شوند (MP4, MOV, MKV, WebM, AVI, MPG, MTS, MXF, OGV, 3GP, TS و...) — تا ۴ گیگابایت
              </p>
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="w-10 h-10 rounded-xl bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center shrink-0">
                  <FileVideo className="w-5 h-5" />
                </div>
                <div className="overflow-hidden">
                  <div className="text-sm font-semibold text-zinc-200 truncate">{file.name}</div>
                  <div className="text-xs text-zinc-400 flex items-center gap-2 mt-0.5 font-mono">
                    <span>{formatFileSize(file.size)}</span>
                    <span>•</span>
                    <span className="uppercase">{file.name.split('.').pop()}</span>
                  </div>
                </div>
              </div>
              {uploadProgress === null && (
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  className="text-xs text-zinc-400 hover:text-rose-400 px-3 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
                >
                  تعویض فایل
                </button>
              )}
            </div>
          )}

          {/* Form Fields */}
          <div className="space-y-4">
            <div>
              <label className="block font-semibold text-zinc-300 mb-1.5">
                پروژه <span className="text-purple-400">*</span>
              </label>
               <select
                 required
                 disabled={uploadProgress !== null || isLoadingProjects}
                 value={projectSelection}
                 onChange={(e) => {
                   const value = e.target.value;
                   setProjectSelection(value === 'new' ? 'new' : value ? Number(value) : '');
                   setError(null);
                 }}
                 className="w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500 rounded-xl px-3.5 py-2.5 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all disabled:opacity-50"
               >
                 {isLoadingProjects && <option value="">در حال بارگذاری پروژه‌ها...</option>}
                 {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                 <option value="new">+ ایجاد پروژه جدید</option>
               </select>
             </div>

             {projectSelection === 'new' && (
               <div className="space-y-3 p-3.5 rounded-xl bg-zinc-950/60 border border-zinc-800">
                 <div>
                   <label className="block font-semibold text-zinc-300 mb-1.5">نام پروژه جدید <span className="text-purple-400">*</span></label>
                   <input type="text" required disabled={uploadProgress !== null} value={newProjectName} onChange={(e) => { setNewProjectName(e.target.value); setError(null); }} placeholder="مثال: کمپین تابستانی" className="w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500 rounded-xl px-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all disabled:opacity-50" />
                 </div>
                 <div>
                   <label className="block font-semibold text-zinc-300 mb-1.5">جزئیات پروژه</label>
                   <textarea rows={2} disabled={uploadProgress !== null} value={newProjectDescription} onChange={(e) => { setNewProjectDescription(e.target.value); setError(null); }} placeholder="توضیحات اختیاری پروژه" className="w-full resize-none bg-zinc-950 border border-zinc-800 focus:border-purple-500 rounded-xl px-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all disabled:opacity-50" />
                 </div>
               </div>
             )}

             <div>
              <label className="block font-semibold text-zinc-300 mb-1.5">
                عنوان پروژه ویدیویی <span className="text-purple-400">*</span>
              </label>
              <input
                type="text"
                required
                disabled={uploadProgress !== null}
                value={title}
                 onChange={(e) => { setTitle(e.target.value); setError(null); }}
                placeholder="مثال: تیزر تبلیغاتی شرکت - کات نهایی"
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500 rounded-xl px-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block font-semibold text-zinc-300 mb-1.5">
                انتخاب سرپرست / ناظر کیفی <span className="text-purple-400">*</span>
              </label>
              <select
                required
                disabled={uploadProgress !== null}
                value={supervisorId}
                 onChange={(e) => { setSupervisorId(Number(e.target.value)); setError(null); }}
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
                ویدیو مستقیماً برای این ناظر کیفی ارسال شده و پس از تایید او به لیست ادمین افزوده می‌شود.
              </p>
            </div>
          </div>

          {/* Upload Progress Bar */}
          {uploadProgress !== null && (
            <div className="p-4 rounded-2xl bg-purple-950/20 border border-purple-500/30 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-200 font-medium">
                  {isProcessing
                    ? 'بارگذاری با موفقیت انجام شد! ویدیو در حال آماده‌سازی برای ناظر کیفی است...'
                    : `در حال انتقال ویدیو به حافظه امن سرور...`}
                </span>
                <span className="font-mono text-purple-400 font-bold">{uploadProgress}%</span>
              </div>
              <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-purple-600 h-full rounded-full transition-all duration-200"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              {isProcessing && (
                <p className="text-[11px] text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  کیفیت‌های مختلف به صورت خودکار آماده شده و در پلیر فعال خواهند شد.
                </p>
              )}
            </div>
          )}

          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              disabled={uploadProgress !== null}
              className="px-4 py-2 text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={!file || uploadProgress !== null}
              className="px-5 py-2.5 font-bold rounded-xl bg-purple-600 hover:bg-purple-500 text-white transition-all shadow-lg shadow-purple-950/50 disabled:opacity-50 flex items-center gap-2"
            >
              <UploadCloud className="w-4 h-4" />
              {uploadProgress !== null ? 'در حال بارگذاری...' : 'ارسال برای بررسی ناظر'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
