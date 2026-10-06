import React, { useState, useEffect } from 'react';
import { AuditLog } from '../types/index.ts';
import { api } from '../api/client.ts';
import { FileText, Search, RefreshCw, Filter } from 'lucide-react';

export const AuditLogsPage: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const data = await api.getAuditLogs({
        action: actionFilter !== 'all' ? actionFilter : undefined,
      });
      setLogs(data);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [actionFilter]);

  const filteredLogs = logs.filter((log) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      log.action.toLowerCase().includes(s) ||
      log.description.toLowerCase().includes(s) ||
      (log.username && log.username.toLowerCase().includes(s)) ||
      log.entityType.toLowerCase().includes(s)
    );
  });

  const getActionBadgeColor = (action: string) => {
    if (action.includes('تایید') || action.includes('Approved')) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    if (action.includes('رد') || action.includes('Rejected')) return 'bg-rose-500/10 text-rose-400 border-rose-500/30';
    if (action.includes('بارگذاری') || action.includes('Uploaded')) return 'bg-purple-500/10 text-purple-400 border-purple-500/30';
    if (action.includes('دانلود') || action.includes('Downloaded')) return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30';
    if (action.includes('تغییر') || action.includes('Assigned')) return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
    return 'bg-zinc-800 text-zinc-300 border-zinc-700';
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2.5">
            <FileText className="w-6 h-6 text-purple-400" />
            <span>لاگ‌های امنیتی و ردپای مانیتورینگ سیستم</span>
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            ردپای دیجیتال غیرقابل دستکاری شامل تمامی تاییدها، رد پروژه‌ها، بارگذاری‌ها، دانلود فایل‌ها و تغییر پرسنل.
          </p>
        </div>

        <button
          onClick={fetchLogs}
          className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 text-xs flex items-center gap-1.5 transition-colors self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>بروزرسانی لاگ‌ها</span>
        </button>
      </div>

      {/* Filter and Search */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجو در نام کاربر، نوع رویداد یا توضیحات عملیات..."
            className="w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500 rounded-xl pr-10 pl-4 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-3.5 h-3.5 text-zinc-400" />
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-purple-500 w-full sm:w-auto"
          >
            <option value="all">همه رویدادها</option>
            <option value="تایید">تایید ویدیو</option>
            <option value="رد">رد ویدیو</option>
            <option value="بارگذاری">بارگذاری ویدیو</option>
            <option value="دانلود">دانلود ویدیو</option>
            <option value="کاربر">مدیریت کاربران</option>
            <option value="ورود">ورود به سیستم</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-zinc-950/80 text-zinc-400 font-semibold uppercase text-[10px] border-b border-zinc-800">
              <tr>
                <th className="px-4 py-3">زمان رویداد</th>
                <th className="px-4 py-3">کاربر و نقش</th>
                <th className="px-4 py-3">نوع عملیات</th>
                <th className="px-4 py-3">موجودیت</th>
                <th className="px-4 py-3">شرح کامل واقعه</th>
                <th className="px-4 py-3 text-left">آدرس IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-zinc-500">
                    در حال دریافت تاریخچه لاگ‌ها...
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-zinc-500">
                    هیچ رکوردی منطبق با این فیلتر ثبت نشده است.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-[11px] text-zinc-400 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString('fa-IR')}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-semibold text-zinc-200">{log.username || 'سیستم خودکار'}</div>
                      {log.userRole && (
                        <div className="text-[10px] text-zinc-500">{log.userRole}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${getActionBadgeColor(log.action)}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-zinc-400 whitespace-nowrap">
                      {log.entityType} #{log.entityId || '--'}
                    </td>
                    <td className="px-4 py-3 text-zinc-300 max-w-md break-words">
                      {log.description}
                    </td>
                    <td className="px-4 py-3 font-mono text-zinc-500 text-[11px] whitespace-nowrap text-left" dir="ltr">
                      {log.ipAddress || '127.0.0.1'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
