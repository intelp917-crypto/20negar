import React, { useState, useEffect } from 'react';
import { User, UserRole } from '../types/index.ts';
import { api } from '../api/client.ts';
import { Users, Shield, CheckCircle2, Crown } from 'lucide-react';

interface UsersPageProps {
  roleFilter?: UserRole;
}

export const UsersPage: React.FC<UsersPageProps> = ({ roleFilter }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchUsers = async () => {
      setIsLoading(true);
      try {
        if (roleFilter === 'Editor') {
          const list = await api.getEditors();
          setUsers(list);
        } else if (roleFilter === 'Supervisor') {
          const list = await api.getSupervisors();
          setUsers(list);
        } else {
          const list = await api.getAllUsers();
          setUsers(list);
        }
      } catch (err) {
        console.error('Failed to load users:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchUsers();
  }, [roleFilter]);

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'SuperAdmin':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1">
            <Crown className="w-3 h-3 text-amber-400" />
            سوپریوزر
          </span>
        );
      case 'Admin':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/30">
            مدیر ارشد
          </span>
        );
      case 'Supervisor':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            ناظر کیفی
          </span>
        );
      case 'Editor':
      default:
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/30">
            تدوین‌گر
          </span>
        );
    }
  };

  const getRoleTitle = () => {
    if (roleFilter === 'Editor') return 'تدوین‌گران استودیو';
    if (roleFilter === 'Supervisor') return 'ناظران کیفی و سرپرستان';
    return 'دایرکتوری پرسنل استودیو';
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2.5">
          {roleFilter === 'Supervisor' ? (
            <Shield className="w-6 h-6 text-amber-400" />
          ) : (
            <Users className="w-6 h-6 text-purple-400" />
          )}
          <span>{getRoleTitle()}</span>
        </h1>
        <p className="text-xs sm:text-sm text-zinc-400 mt-1">
          مشاهده مشخصات اعضای تیم، نقش‌های اختصاص‌یافته و وضعیت فعالیت در سیستم.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <div className="col-span-full py-16 text-center text-zinc-500 text-xs">
            در حال دریافت اطلاعات پرسنل...
          </div>
        ) : users.length === 0 ? (
          <div className="col-span-full py-16 text-center text-zinc-500 text-xs">
            هیچ کاربری در این دسته یافت نشد.
          </div>
        ) : (
          users.map((u) => (
            <div
              key={u.id}
              className="p-5 rounded-3xl bg-zinc-900 border border-zinc-800 shadow-md hover:border-zinc-700 transition-colors space-y-3"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-zinc-800 border border-zinc-700 flex items-center justify-center font-bold text-zinc-200">
                    {u.displayName.charAt(0)}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-zinc-100">{u.displayName}</h4>
                    <div className="text-xs text-zinc-500 font-mono mt-0.5" dir="ltr">@{u.username}</div>
                  </div>
                </div>
                {getRoleBadge(u.role)}
              </div>

              <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between text-xs text-zinc-400">
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" /> پرسنل فعال
                </span>
                <span className="text-[11px] font-mono text-zinc-500">
                  تاریخ عضویت: {new Date(u.createdAt).toLocaleDateString('fa-IR')}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
