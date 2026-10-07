import React, { useState } from 'react';
import {
  BookOpen,
  Terminal,
  Server,
  Database,
  Film,
  HardDrive,
  Shield,
  Layers,
  Copy,
  Check,
  Crown,
  Globe,
} from 'lucide-react';

export const DocumentationPage: React.FC = () => {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(id);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-12" dir="rtl">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-center gap-3">
          <BookOpen className="w-8 h-8 text-purple-400" />
          <span>مستندات معماری، استقرار و راهنمای سیستم</span>
        </h1>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
          راهنمای مهندسی استودیو ۲۰نگار: مدیریت جریان کار، تفکیک دسترسی پرسنل، پخش تطبیقی هوشمند با سرعت اینترنت و پنل مدیریت کل.
        </p>
      </div>

      {/* Quick Specs Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-3xl bg-zinc-900 border border-zinc-800">
          <div className="flex items-center gap-2 text-purple-400 text-xs font-bold uppercase mb-1">
            <Server className="w-4 h-4" /> محیط اجرا
          </div>
          <div className="text-base font-bold text-white">Node.js + Express</div>
          <div className="text-xs text-zinc-500 mt-0.5">کارگر پس‌زمینه ناهمگام (Async Worker)</div>
        </div>

        <div className="p-5 rounded-3xl bg-zinc-900 border border-zinc-800">
          <div className="flex items-center gap-2 text-sky-400 text-xs font-bold uppercase mb-1">
            <Database className="w-4 h-4" /> پایگاه داده رابطه‌ای
          </div>
          <div className="text-base font-bold text-white">SQLite (استاندارد ACID)</div>
          <div className="text-xs text-zinc-500 mt-0.5">همگام‌سازی دیسک و مایگریشن خودکار</div>
        </div>

        <div className="p-5 rounded-3xl bg-zinc-900 border border-zinc-800">
          <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase mb-1">
            <Film className="w-4 h-4" /> موتور پردازش ویدیو
          </div>
          <div className="text-base font-bold text-white">FFmpeg 6.x + ffprobe</div>
          <div className="text-xs text-zinc-500 mt-0.5">کیفیت‌های 1080p, 720p, 480p, 360p + HLS</div>
        </div>

        <div className="p-5 rounded-3xl bg-zinc-900 border border-zinc-800">
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase mb-1">
            <HardDrive className="w-4 h-4" /> ذخیره‌سازی فایل
          </div>
          <div className="text-base font-bold text-white">حافظه ایزوله خصوصی</div>
          <div className="text-xs text-zinc-500 mt-0.5">معماری ابسترکت (آماده برای S3 / R2)</div>
        </div>
      </div>

      {/* Section 1: Seed Users & Credentials */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-sm space-y-4">
        <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
          <Shield className="w-5 h-5 text-purple-400" />
          <span>۱. حساب‌های کاربری پیش‌فرض، سوپریوزر و رمزهای عبور</span>
        </h2>
        <p className="text-xs text-zinc-300 leading-relaxed">
          دیتابیس سیستم در اولین اجرا حساب‌های زیر را با هش امنیتی <strong>BCrypt (۱۰ دور نمک‌گذاری)</strong> ایجاد می‌کند. رمزها هرگز به صورت متن خام در سرور ذخیره نمی‌شوند:
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="p-4 rounded-2xl bg-zinc-950 border border-amber-500/40 space-y-1">
            <div className="text-amber-300 font-bold flex items-center gap-1.5">
              <Crown className="w-4 h-4 text-amber-400" />
              سوپریوزر کل (SuperAdmin)
            </div>
            <div className="font-mono text-zinc-300" dir="ltr">Username: superadmin</div>
            <div className="font-mono text-zinc-300" dir="ltr">Password: superadmin</div>
            <div className="text-[11px] text-zinc-400 mt-1">کنترل کل کاربران، رمزها و ویدیوها</div>
          </div>

          <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800 space-y-1">
            <div className="text-purple-400 font-bold">مدیر ارشد (Admin)</div>
            <div className="font-mono text-zinc-300" dir="ltr">Username: admin1</div>
            <div className="font-mono text-zinc-300" dir="ltr">Password: admin1</div>
            <div className="text-[11px] text-zinc-400 mt-1">مشاهده آرشیو تایید شده و دانلودها</div>
          </div>

          <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800 space-y-1">
            <div className="text-sky-400 font-bold">تدوین‌گر (Editor)</div>
            <div className="font-mono text-zinc-300" dir="ltr">Username: editor1</div>
            <div className="font-mono text-zinc-300" dir="ltr">Password: editor1</div>
            <div className="text-[11px] text-zinc-400 mt-1">بارگذاری کات و ارسال نسخه اصلاحی</div>
          </div>

          <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800 space-y-1">
            <div className="text-amber-400 font-bold">ناظر کیفی (Supervisor)</div>
            <div className="font-mono text-zinc-300" dir="ltr">Username: supervisor1</div>
            <div className="font-mono text-zinc-300" dir="ltr">Password: supervisor1</div>
            <div className="text-[11px] text-zinc-400 mt-1">بازبینی، تایید یا رد با ثبت دلیل الزامی</div>
          </div>
        </div>
      </section>

      {/* Section 2: Quick Start */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
            <Terminal className="w-5 h-5 text-purple-400" />
            <span>۲. دستورات نصب وابستگی‌ها و اجرای پروژه</span>
          </h2>
          <button
            onClick={() =>
              copyToClipboard(
                `# ۱. نصب پکیج‌ها\nnpm install\n\n# ۲. اجرای در حالت توسعه (Fullstack)\nnpm run dev\n\n# ۳. ساخت بیلد پروداکشن\nnpm run build\n\n# ۴. اجرای سرور پروداکشن\nNODE_ENV=production npm start`,
                'install'
              )
            }
            className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs flex items-center gap-1.5"
          >
            {copiedSection === 'install' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>کپی دستورات</span>
          </button>
        </div>

        <pre className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800 text-xs font-mono text-purple-300 overflow-x-auto leading-relaxed" dir="ltr">
{`# 1. Install dependencies
npm install

# 2. Run in development mode (Express server + Vite client on port 3000)
npm run dev

# 3. Build production bundle
npm run build

# 4. Start production server
NODE_ENV=production npm start`}
        </pre>
      </section>

      {/* Section 3: FFmpeg Architecture */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-sm space-y-4">
        <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
          <Film className="w-5 h-5 text-purple-400" />
          <span>۳. خط لوله ترنسکدینگ خودکار FFmpeg و استریم تطبیقی HLS</span>
        </h2>
        <p className="text-xs text-zinc-300 leading-relaxed">
          هنگام بارگذاری ویدیو توسط تدوین‌گر، درخواست HTTP سریعاً بدون مسدود شدن پایان می‌یابد و یک وظیفه پس‌زمینه به صف ترنسکد اضافه می‌شود:
        </p>

        <div className="space-y-3 text-xs">
          <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800">
            <strong className="text-zinc-200">۱. متادیتا و بررسی ابعاد (Probe):</strong>
            <p className="text-zinc-400 mt-1">
              اجرای <code className="text-purple-300 font-mono">ffprobe</code> برای محاسبه زمان دقیق، بیت‌ریت، ابعاد افقی و عمودی تصویر.
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800">
            <strong className="text-zinc-200">۲. ساخت تصویر بندانگشتی باکیفیت:</strong>
            <p className="text-zinc-400 mt-1">
              عکس‌برداری در ثانیه اول یا ۱۰٪ اول ویدیو با کیفیت مقیاس‌بندی شده در حافظه خصوصی ذخیره می‌شود.
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800">
            <strong className="text-zinc-200">۳. رندرهای چندگانه (Multi-Resolution MP4):</strong>
            <p className="text-zinc-400 mt-1">
              تولید خروجی‌های مجزا با فلگ <code className="text-purple-300 font-mono">+faststart</code> برای استریم لحظه‌ای:
              <br />• <strong>1080p:</strong> رزولوشن 1920x1080 با بیت‌ریت 4500k و صدای 192k AAC
              <br />• <strong>720p:</strong> رزولوشن 1280x720 با بیت‌ریت 2500k و صدای 128k AAC
              <br />• <strong>480p:</strong> رزولوشن 854x480 با بیت‌ریت 1200k و صدای 96k AAC
              <br />• <strong>360p:</strong> رزولوشن 640x360 با بیت‌ریت 800k و صدای 64k AAC
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800">
            <strong className="text-zinc-200">۴. استریم تطبیقی HLS:</strong>
            <p className="text-zinc-400 mt-1">
              تولید فایل <code className="text-purple-300 font-mono">master.m3u8</code> و قطعات بندانگشتی TS برای جلوگیری از افت فریم و توقف تصویر در شبکه ضعیف.
            </p>
          </div>
        </div>
      </section>

      {/* Section 4: File Storage Abstraction */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-sm space-y-4">
        <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
          <HardDrive className="w-5 h-5 text-purple-400" />
          <span>۴. امنیت ذخیره‌سازی ایزوله (IFileStorage)</span>
        </h2>
        <p className="text-xs text-zinc-300 leading-relaxed">
          هیچ ویدیویی در پوشه‌های عمومی وب قرار نمی‌گیرد. تمام فایل‌ها درون <code className="text-purple-300 font-mono">data/storage/</code> نگهداری شده و استریم آن‌ها صرفاً از طریق توکن‌های امضا شده و درخواست‌های HTTP 206 Partial Content میسر است.
        </p>
      </section>

      {/* Section 5: VPN & Port Forwarding Guide */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
            <Globe className="w-5 h-5 text-emerald-400" />
            <span>۵. راهنمای اتصال با VPN، آی‌پی ثابت و پورت فورواردینگ (Port Forwarding)</span>
          </h2>
          <button
            onClick={() =>
              copyToClipboard(
                `netsh advfirewall firewall add rule name="20Negar Ports" dir=in action=allow protocol=TCP localport=3000,80,443`,
                'firewall'
              )
            }
            className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs flex items-center gap-1.5"
          >
            {copiedSection === 'firewall' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>کپی دستور فایروال</span>
          </button>
        </div>

        <p className="text-xs text-zinc-300 leading-relaxed">
          اگر روی سیستم خود پورت فوروارد کرده‌اید و آی‌پی ثابت دارید، سرور ۲۰نگار به‌گونه‌ای مهندسی شده است که با فعال بودن VPN نیز کاملاً در دسترس بماند:
        </p>

        <div className="space-y-3 text-xs">
          <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800">
            <strong className="text-emerald-400">۱. اتصال روی تمام کارت‌های شبکه (0.0.0.0):</strong>
            <p className="text-zinc-400 mt-1">
              سرور Express به‌جای <code className="text-purple-300 font-mono">localhost</code> بر روی <code className="text-purple-300 font-mono">0.0.0.0</code> متصل است؛ در نتیجه درخواست‌هایی که از طریق آی‌پی اینترنتی ثابت یا پورت‌های فوروارد شده ارسال می‌شوند، مسدود نمی‌شوند.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800">
            <strong className="text-emerald-400">۲. تنظیم VPN برای عدم مسدودسازی شبکه محلی (Bypass LAN):</strong>
            <p className="text-zinc-400 mt-1">
              در نرم‌افزار VPN خود (مانند v2rayN، Nekoray، Outline یا OpenVPN) گزینه‌های <strong>«Bypass LAN»</strong>، <strong>«Routing: Bypass private IPs»</strong> یا <strong>«Split Tunneling»</strong> را فعال کنید تا بسته‌های شبکه محلی به داخل تونل VPN فرستاده نشوند.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800">
            <strong className="text-emerald-400">۳. عبور از فایروال ویندوز:</strong>
            <p className="text-zinc-400 mt-1">
              در صورت باز نشدن صفحه در سایر دستگاه‌ها، دستور زیر را در CMD ویندوز با دسترسی Run as Administrator اجرا کنید:
            </p>
            <pre className="mt-2 p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-purple-300" dir="ltr">
netsh advfirewall firewall add rule name="20Negar Ports" dir=in action=allow protocol=TCP localport=3000,80,443
            </pre>
          </div>

          <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800">
            <strong className="text-emerald-400">۴. پورت‌های استاندارد وب (۸۰ و ۴۴۳):</strong>
            <p className="text-zinc-400 mt-1">
              بسیاری از سرویس‌دهنده‌های اینترنت پورت‌های غیرمعمول را روی آی‌پی‌های ثابت می‌بندند؛ سرور ۲۰نگار علاوه بر پورت ۳۰۰۰ می‌تواند روی پورت‌های ۸۰ و ۴۴۳ نیز گوش دهد.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
