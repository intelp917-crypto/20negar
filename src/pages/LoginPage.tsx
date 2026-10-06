import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { Film, Lock, User, ArrowLeft, Crown, Sparkles } from 'lucide-react';
import { UserRole } from '../types/index.ts';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('لطفاً نام کاربری و رمز عبور را وارد نمایید.');
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      await login(username.trim(), password.trim());
    } catch (err: any) {
      setError(err.message || 'نام کاربری یا رمز عبور اشتباه است.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickFill = (role: UserRole) => {
    const creds: Record<UserRole, { u: string; p: string }> = {
      SuperAdmin: { u: 'superadmin', p: 'superadmin' },
      Admin: { u: 'admin1', p: 'admin1' },
      Editor: { u: 'editor1', p: 'editor1' },
      Supervisor: { u: 'supervisor1', p: 'supervisor1' },
    };
    setUsername(creds[role].u);
    setPassword(creds[role].p);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col justify-center items-center p-4 relative overflow-hidden" dir="rtl">
      {/* Background Decorative Glows */}
      <div className="absolute top-1/4 right-1/2 translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 left-10 w-80 h-80 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Main Container */}
      <div className="w-full max-w-md relative z-10">
        {/* Branding Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-3xl bg-gradient-to-tr from-purple-700 via-purple-600 to-indigo-500 shadow-2xl shadow-purple-950/60 mb-3 border border-purple-500/30">
            <Film className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">استودیو ۲۰نگار</h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1.5">
            سامانه اختصاصی مدیریت گردش کار، بازبینی کیفی و پخش ویدیویی ۲۰نگار
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-zinc-900/90 backdrop-blur-xl border border-zinc-800 rounded-3xl p-6 sm:p-8 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-zinc-300 mb-1.5">
                نام کاربری
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-zinc-500">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="superadmin, admin1, editor1 یا supervisor1"
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500 rounded-xl pr-10 pl-4 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all font-mono"
                  dir="ltr"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-zinc-300 mb-1.5">
                رمز عبور
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-zinc-500">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500 rounded-xl pr-10 pl-4 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all font-mono"
                  dir="ltr"
                />
              </div>
            </div>

            {error && (
              <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs sm:text-sm shadow-lg shadow-purple-950/50 flex items-center justify-center gap-2 transition-all disabled:opacity-50 mt-2"
            >
              {isLoading ? (
                'در حال ورود...'
              ) : (
                <>
                  <span>ورود به سامانه ۲۰نگار</span>
                  <ArrowLeft className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Quick Demo Credential Selectors */}
          <div className="mt-7 pt-5 border-t border-zinc-800/80">
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-3">
              <span className="flex items-center gap-1.5 font-bold text-zinc-300 text-xs">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" /> حساب‌های پیش‌فرض سامانه
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleQuickFill('SuperAdmin')}
                className="p-2.5 rounded-2xl bg-zinc-950 hover:bg-zinc-800 border border-amber-500/40 text-right transition-colors group"
              >
                <div className="text-[11px] font-bold text-amber-300 flex items-center gap-1">
                  <Crown className="w-3 h-3 text-amber-400" /> مدیرکل (دسترسی همه چی)
                </div>
                <div className="text-[10px] font-mono text-zinc-400 mt-0.5">superadmin / superadmin</div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFill('Editor')}
                className="p-2.5 rounded-2xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-right transition-colors group"
              >
                <div className="text-[11px] font-bold text-sky-400">تدوین‌گر</div>
                <div className="text-[10px] font-mono text-zinc-500 mt-0.5">editor1 / editor1</div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFill('Supervisor')}
                className="p-2.5 rounded-2xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-right transition-colors group"
              >
                <div className="text-[11px] font-bold text-amber-400">ناظر کیفی</div>
                <div className="text-[10px] font-mono text-zinc-500 mt-0.5">supervisor1 / supervisor1</div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFill('Admin')}
                className="p-2.5 rounded-2xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-right transition-colors group"
              >
                <div className="text-[11px] font-bold text-purple-400">ادمین</div>
                <div className="text-[10px] font-mono text-zinc-500 mt-0.5">admin1 / admin1</div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
