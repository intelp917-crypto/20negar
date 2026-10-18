# 20negar Manager

رابط دسکتاپ واقعی برای مدیریت سرویس 20negar با PySide6 است. برنامه سرور واقعی همین repository را با Node.js/tsx اجرا می‌کند، PID و command line را بررسی می‌کند، health endpoint واقعی `/api/health` را می‌خواند و خروجی stdout/stderr را محدود و چرخشی ثبت می‌کند.

## اجرا

```bat
scripts\install.bat
scripts\run_manager.bat
```

برای ساخت فایل اجرایی:

```bat
scripts\build_exe.bat
```

## قابلیت‌ها

- sidebar دائمی و صفحات Dashboard، کنترل سرویس، ذخیره‌سازی و پایگاه‌داده، لاگ، پشتیبان، شبکه، به‌روزرسانی، startup، diagnostics و settings/about
- تم dark/light و کنترل‌های start/stop/restart و health
- انتخاب مسیر و عملیات backup/restore با تأیید کاربر
- لاگ زنده‌ی محدود به ۵۰۰ خط
- اجرای عملیات کند در `QThreadPool` با `QRunnable`؛ رابط کاربری بلاک نمی‌شود
- خروجی خطا در status bar و fallback امن تا آماده شدن core
- تنظیمات واقعی پورت، mode، مسیر storage، database و startup در APPDATA
- backup اتمیک ZIP با manifest، snapshot قبل از restore و جلوگیری از Zip Slip
- گزارش diagnostics با نسخه Node/npm/git، فضای دیسک، مسیرها و health بدون secrets

## پیش‌نیاز و مسیرها

- Windows 10/11، Python 3.11+، Node.js/npm و repository نصب‌شده 20Negar
- تنظیمات manager در `%APPDATA%\20negar-manager\settings.json`
- داده‌های پیش‌فرض server در `data/` شامل `cineflow.sqlite` و `storage/`
- manager برای تغییر مسیر storage، متغیر `NEGAR_STORAGE_DIR` را به‌صورت اتمیک در `.env` می‌نویسد؛ server از `NEGAR_DATA_DIR`, `NEGAR_STORAGE_DIR`, `NEGAR_DB_FILE_PATH` و مسیرهای media پشتیبانی می‌کند.

## تست

از ریشه repository:

```bat
py -3 -m pytest manager\tests -q
npm test
npm run lint
npm run build
```

`build_exe.bat` پس از نصب requirements فایل standalone را در `manager\dist` می‌سازد. اجرای manager نیاز به باز بودن terminal ندارد؛ فقط server باید Node.js و dependencies خودش را داشته باشد.

## قرارداد اتصال

فایل `app/core/bridge.py` تنها نقطه‌ی اتصال است. برای اتصال هسته، ماژول عمومی `app.core.config` (تابع اختیاری `get`) و ماژول عمومی سرویس (تابع‌های اختیاری `start`، `stop`، `restart`) کافی است.
