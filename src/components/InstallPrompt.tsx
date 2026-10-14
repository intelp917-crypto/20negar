import React, { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { promptInstall, canInstall } from '../pwa.ts';

export const InstallPrompt: React.FC = () => {
  const [available, setAvailable] = useState(canInstall);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem('20negar-install-dismissed') === '1');

  useEffect(() => {
    const onAvailable = () => setAvailable(canInstall());
    window.addEventListener('20negar:install-available', onAvailable);
    return () => window.removeEventListener('20negar:install-available', onAvailable);
  }, []);

  if (!available || dismissed || window.matchMedia('(display-mode: standalone)').matches) return null;
  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:w-96 z-[60] rounded-2xl border border-purple-500/40 bg-zinc-900 p-4 shadow-2xl" dir="rtl">
      <button aria-label="بستن" onClick={() => { sessionStorage.setItem('20negar-install-dismissed', '1'); setDismissed(true); }} className="absolute left-3 top-3 text-zinc-400 hover:text-white"><X className="w-4 h-4" /></button>
      <p className="font-bold text-zinc-100">نصب اپلیکیشن ۲۰نگار</p>
      <p className="mt-1 text-xs text-zinc-400">برای دسترسی سریع‌تر و تجربه تمام‌صفحه، برنامه را روی گوشی نصب کنید.</p>
      <button onClick={() => void promptInstall()} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2 text-xs font-bold text-white hover:bg-purple-500"><Download className="w-4 h-4" /> نصب برنامه</button>
    </div>
  );
};
