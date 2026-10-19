# 20negar Manager

رابط دسکتاپ مدیریت سرویس 20negar با PySide6. برنامه سرور واقعی همین repository را با Node.js/tsx اجرا می‌کند، PID و command line را بررسی می‌کند، health endpoint واقعی `/api/health` را می‌خواند و stdout/stderr را با محدودیت حجم ثبت می‌کند.

## اجرا

```bat
scripts\install.bat
scripts\run_manager.bat
```

برای ساخت فایل اجرایی:

```bat
scripts\build_exe.bat
```

آیکن فایل اجرایی با گزینه‌ی `-i` و فایل `scripts\20negar.ico` اعمال می‌شود (PyInstaller همراه فایل `.spec` گزینه‌ی `-i/--icon` را نمی‌پذیرد، پس build روی command line است). تصویر مبدأ `scripts/icon-512.png` است و همان تصویر با `--add-data` در `assets` باندل می‌شود تا آیکن پنجره و tray هم از آن خوانده شود.

تست‌ها (از ریشه repository):

```bat
py -3 -m pytest manager\tests -q
npm test
npm run lint
```

## رابط کاربری

رابط کاربری از یک design system توکن‌محور ساخته شده است:

- دو تم کامل Dark/Light با پالت، stylesheet و کنترل‌های custom-painted؛ انتخاب تم ذخیره می‌شود.
- کارت‌های ۱۶px، spacing منظم، تایپوگرافی و بج‌های وضعیت، سوییچ‌های سفارشی، console های مونواسپیس و toast های شناور.
- Sidebar با گروه‌بندی، نشانگر انتخاب و فوتر زنده؛ top bar با breadcrumb، وضعیت لحظه‌ای و دسترسی سریع.
- کنترل‌های `Start/Stop` از یک state machine واحد تغذیه می‌شوند و هرگز با واقعیت اختلاف ندارند.
- کلیدهای میان‌بر: `F5` تازه‌سازی، `Ctrl+R` ری‌استارت، `Ctrl+Shift+S` استارت/استاپ، `Ctrl+T` تم، `Ctrl+Q` خروج.

### چرخه‌ی عمر سرویس

فازها در `app/core/server_controller.py` محاسبه می‌شوند و رابط کاربری هر ۱ تا چند ثانیه (بر اساس `monitor_interval`) آن‌ها را می‌خواند:

| فاز | معنی | دکمه |
| --- | --- | --- |
| `stopped` | فرآیندی وجود ندارد | Start server |
| `starting` | فرآیند زنده است و health هنوز OK نشده | Starting… (غیرفعال) |
| `running` | فرآیند زنده و `/api/health` سالم | Stop server |
| `stopping` | در حال خاتمه | Stopping… (غیرفعال) |
| `unhealthy` | فرآیند زنده ولی health پاسخ نمی‌دهد | Stop server |
| `external` | سرور دستی اجرا شده و مدیر فقط health را می‌بیند | Stop server با پیام راهنما |

پس از استارت، UI بلافاصله فاز `starting` را نشان می‌دهد، سپس با رسیدن health به `running` سوییچ می‌کند و دکمه به Stop تغییر می‌کند. فرآیند استارت شده در `settings.json` ثبت می‌شود تا اگر مدیر بسته و دوباره باز شود، دوباره به همان PID متصل شود و Stop واقعاً کار کند.

## Tray روی ویندوز

- به‌محض باز شدن برنامه، آیکن در ناحیه‌ی hidden icons کنار ساعت ظاهر می‌شود.
- دکمه‌ی بستن پنجره، برنامه را به tray منتقل می‌کند (قابل تنظیم با `close_to_tray`).
- منوی tray شامل Open، وضعیت زنده، Start/Stop، Restart، Settings و `Exit manager…` است.
- خروج فقط از منوی tray و با تأیید اضافی انجام می‌شود. اگر سرور در حال اجرا باشد، سه گزینه وجود دارد: `Stop server and exit`، `Exit and keep server running` و `Cancel`. اگر سرور متوقف باشد، یک تأیید ساده‌ی Exit/Cancel نمایش داده می‌شود.
- انتخاب Stop در خروج، ابتدا فرآیند را متوقف می‌کند و سپس آیکن tray را حذف و برنامه را می‌بندد.

## به‌روزرسانی از GitHub

صفحه‌ی **Updates** نسخه‌ی نصب‌شده را با `https://github.com/intelp917-crypto/20negar.git` مقایسه می‌کند و دکمه‌ی **Update now** کل فرآیند را انجام می‌دهد:

1. بررسی read-only با `git fetch` (هیچ فایلی تغییر نمی‌کند)
2. توقف سرور
3. ساخت ZIP بازیابی از دیتابیس در `backups/`
4. فقط fast-forward (`git merge --ff-only`)؛ commitهای محلی و تغییرات ذخیره‌نشده هرگز دور ریخته نمی‌شوند
5. اگر `package.json` یا lockfile تغییر کرده باشد، `npm install`
6. استارت مجدد سرور و تأیید از طریق `/api/health`

اگر working tree تغییر commit‌نشده داشته باشد، دکمه با پیام مشخص غیرفعال می‌ماند تا کاری از دست نرود. اگر خود مدیر (پوشه‌ی `manager/`) به‌روز شود، پس از پایان یک هشدار برای ری‌استارت مدیر نمایش داده می‌شود.

## HTTPS و Let's Encrypt

صفحه‌ی **TLS / HTTPS** گواهی را دقیقاً همان‌جایی می‌نویسد که `server/tls.ts` می‌خواند (`<data>/certs/server.crt` و `server.key`):

- **Self-signed** — بدون نیاز به دامنه؛ مناسب LAN/VPN (مرورگر هشدار می‌دهد).
- **Let's Encrypt** — با ACME v2 و چالش HTTP-01، بدون نصب certbot یا ابزار بیرونی. مدیر حساب ACME را می‌سازد، توکن چالش را در web root منتشر می‌کند (`<data>/acme` که سرور روی `/.well-known/acme-challenge` سرو می‌کند) و زنجیره‌ی گواهی را ذخیره می‌کند.
- **Auto-renew** — تا زمانی که مدیر باز است (حتی در tray) هر ۳۰ دقیقه بررسی می‌کند و اگر کمتر از N روز از اعتبار مانده باشد، گواهی را تمدید و سرور را ری‌استارت می‌کند. N پیش‌فرض ۳۰ روز است.

پیش‌نیازها: رکورد DNS دامنه به IP عمومی سرور اشاره کند و پورت ۸۰ از اینترنت قابل دسترسی باشد (`ENABLE_STANDARD_PORTS`). اگر سرور متوقف باشد، مدیر خودش موقتاً روی پورت ۸۰ به چالش پاسخ می‌دهد. برخی مناطق به دلیل تحریم‌ها از Let's Encrypt گواهی نمی‌گیرند؛ در این حالت self-signed یا CA تجاری جایگزین است.

## FFmpeg و تبدیل خودکار

تبدیل FFmpeg دیگر در مسیر اجرای خودکار سرور نیست: فایل آپلودشده دست‌نخورده ذخیره و همان‌طور استریم می‌شود. برای فعال‌کردن آگاهانه‌ی ladder کیفیت، در `.env` مقدار `NEGAR_TRANSCODER_ENABLED=true` را قرار دهید. بدون آن، هیچ worker یا job تبدیلی هنگام استارت شروع نمی‌شود.

## تغییر مسیر Storage و Database

مسیرها از سه لایه هم‌زمان مدیریت می‌شوند تا تغییر واقعاً اعمال شود:

1. تنظیمات مدیر در `%APPDATA%\20negar-manager\settings.json`
2. فایل `.env` در ریشه‌ی repository که `server/config.ts` با `dotenv` می‌خواند
3. environment متغیرهای فرآیند Node هنگام spawn

فرآیند تغییر (از دکمه‌ی «Change destination…»):

- اعتبارسنجی مسیر، دسترسی نوشتن و فضای آزاد
- اگر سرور در حال اجراست، ابتدا متوقف می‌شود (تا SQLite و فایل‌های رسانه در نیمه‌ی کار تغییر نکنند)
- ساخت ZIP بازیابی در پوشه‌ی backups
- کپی اتمیک و تأیید SHA-256 برای هر فایل
- بررسی `PRAGMA integrity_check` برای دیتابیس
- نوشتن `NEGAR_DB_FILE_PATH` / `NEGAR_STORAGE_DIR` / `NEGAR_VIDEOS_DIR` / `PORT` در `.env` با quoting ایمن ویندوزی
- ذخیره‌ی تنظیمات، به‌روزرسانی environment و ری‌استارت اختیاری سرور
- تأیید نهایی از طریق health و خطوط `[Config] Database file: …` / `[Config] Storage root: …` / `[Config] Videos root: …` در لاگ

### پوشه‌ی ویدیوها روی درایو دیگر

کارت **Videos destination** در صفحه‌ی Storage مسیر `data/storage/videos` را به هر درایو یا پوشه‌ی دیگری منتقل می‌کند (`NEGAR_VIDEOS_DIR`):

- کلید رکوردها در دیتابیس همان `videos/<file>` می‌ماند؛ فقط ریشه‌ی فیزیکی عوض می‌شود، پس ویدیوهای قبلی بدون تغییر دیتابیس پیدا می‌شوند.
- پوشه باید بیرون از storage root باشد؛ بنابراین تغییر بعدی storage نمی‌تواند آن را رها یا تکراری کند.
- با گزینه‌ی کپی، همه‌ی فایل‌ها با بررسی size + SHA-256 منتقل می‌شوند و پوشه‌ی قبلی دست‌نخورده می‌ماند.
- «Use storage default» مقدار را پاک می‌کند تا ویدیوها دوباره داخل `<storage>/videos` ذخیره شوند.
- بکاپ رسانه‌ای و آمار فضای مصرفی، پوشه‌ی جداگانه را هم شامل می‌شوند. موتور Rust در این حالت فقط برای دانلود/استریم ویدیوها به fallback داخلی Node می‌رود (آپلودها تغییری نمی‌کنند).

حالت‌های انتقال دیتابیس:

- **Replace**: دیتابیس فعلی به مقصد کپی می‌شود؛ اگر فایلی از قبل آنجا باشد با پسوند `.replaced-YYYYMMDD-HHMMSS` حفظ می‌شود.
- **Adopt**: دیتابیس موجود در مقصد استفاده می‌شود (برای بازگرداندن یک نسخه).

نکات مهم:

- مسیر storage و فایل دیتابیس باید مستقل باشند؛ دیتابیس داخل پوشه‌ی رسانه پذیرفته نمی‌شود.
- مقدارهای `.env` بدون کوتیشن نوشته می‌شوند و فقط در صورت وجود `#` یا فاصله‌ی اضافی، single-quote می‌گیرند؛ dotenv داخل double-quote کاراکترهایی مثل `\n` را تفسیر می‌کند و مسیر ویندوز را خراب می‌کند.
- اتصال‌های SQLite مدیر بلافاصله بسته می‌شوند؛ در غیر این صورت ویندوز فایل را قفل می‌کند و rename اتمیک سرور با `EBUSY` شکست می‌خورد.

### مسیرهای پیش‌فرض

- داده‌های server: `data/` شامل `cineflow.sqlite`، `storage/`، `logs/` و `backups/`
- ویدیوها: `<storage>/videos` مگر اینکه `videos_dir` در تنظیمات مدیر تنظیم شده باشد
- تنظیمات manager: `%APPDATA%\20negar-manager\settings.json`
- `.env` در ریشه‌ی repository (در gitignore است)

### Startup در ویندوز

صفحه‌ی Startup در پوشه‌ی Startup کاربر یک لانچر `.vbs` برای مدیر و یکی برای سرور می‌گذارد؛ هر لانچر با `WScript.Shell.Run …, 0, False` فایل `.cmd` واقعی را **بدون پنجره** اجرا می‌کند (پس node.exe و cmd دیده نمی‌شوند). فایل‌های `.cmd` در `%APPDATA%\20negar-manager\startup` هستند، صریحاً `cd /d` به ریشه‌ی repository می‌زنند و نسخه‌ی سرور متغیرهای `PORT`/`NODE_ENV`/`NEGAR_*` را با `set` اعمال می‌کند؛ در غیر این صورت ویندوز فایل را با پوشه‌ی کاربر اجرا می‌کند، `server.ts` پیدا نمی‌شود و dotenv هم `.env` را نمی‌خواند. خروجی هر بار ورود به `data/logs/startup-server.log` نوشته می‌شود.

- با هر بار Apply، هر دو entry بازنویسی می‌شوند؛ پس جابه‌جایی repository یا تغییر مسیر ویدیوها با یک Apply درست می‌شود.
- نشانگر «entry points elsewhere» یعنی فایل موجود به پوشه‌ی دیگری اشاره می‌کند؛ Apply را بزنید.
- `.cmd` قدیمی (نسخه‌ی پنجره‌دار) هنگام Apply حذف می‌شود تا دو بار شروع نشود.
- سروری که مدیر با دکمه‌ی Start اجرا می‌کند هم با `CREATE_NO_WINDOW` اجرا می‌شود و پنجره‌ی کنسول ندارد.

## دسترسی از اینترنت (port forward)

سرور روی `0.0.0.0` گوش می‌دهد، پس اگر از بیرون جواب نمی‌دهد مسئله bind نیست. این موارد را به ترتیب بررسی کنید:

1. **از داخل شبکه با IP عمومی تست نکنید.** بسیاری از روترها NAT loopback ندارند؛ با موبایل روی داده‌ی همراه تست کنید.
2. **IP عمومی واقعی را با WAN روتر مقایسه کنید.** اگر WAN در بازه‌ی خصوصی یا `100.64.0.0/10` است، اپراتور CGNAT دارد و forward کار نمی‌کند؛ راه‌حل: IP ثابت/پورت اختصاصی از اپراتور، VPN، یا Cloudflare Tunnel.
3. **IP داخلی مقصد forward** باید همان IP فعلی سیستم باشد (DHCP را رزرو کنید). `ipconfig` و صفحه‌ی port-forward روتر را مقایسه کنید.
4. **پورت روی همان میزبان باز است؟** `netstat -ano | findstr :3000` باید `0.0.0.0:3000 ... LISTENING` نشان دهد، نه `127.0.0.1`.
5. **رزرو پورت توسط Hyper-V/WSL**: `netsh interface ipv4 show excludedportrange protocol=tcp`. اگر پورت داخل بازه‌ی رزرو است، EACCES می‌گیرید و سرور بالا نمی‌آید؛ پورت دیگری انتخاب کنید.
6. **فایروال**: خاموش بودن فایروال کافی نیست؛ آنتی‌ویروس/فایروال شخص ثالث هم لایه‌ی فیلتر دارد. یک بار rule بسازید: `netsh advfirewall firewall add rule name="20Negar 3000" dir=in action=allow protocol=TCP localport=3000`.
7. **در خود سرور چه چیزی listen شده؟** لاگ `[Network] LAN addresses available...` و پورت‌های HTTP/HTTPS را نشان می‌دهد. با `ENABLE_STANDARD_PORTS=true` پورت‌های ۸۰/۴۴۳ هم باز می‌شوند؛ اگر روتر فقط ۴۴۳ را forward کرده، آدرس را با `https://` باز کنید (گواهی self-signed هشدار می‌دهد).
8. **پشت reverse proxy**: `TRUST_PROXY=true` را در `.env` تنظیم کنید و `PUBLIC_URL` را با آدرس عمومی (پروتکل + دامنه/آی‌پی) پر کنید تا CORS و لینک‌ها درست بسازند.

## ساختار

- `app/ui/theme.py` — توکن‌های طراحی و stylesheet سراسری
- `app/ui/widgets.py` — کتابخانه‌ی کنترل‌های سفارشی (کارت، بج وضعیت، سوییچ، toast، console)
- `app/ui/pages.py` — دوازده صفحه‌ی managerial و wizard تغییر مسیر
- `app/core/update_manager.py` — بررسی و به‌روزرسانی امن از GitHub
- `app/core/acme.py` / `app/core/cert_manager.py` — ACME v2 و مدیریت گواهی HTTPS
- `app/ui/main_window.py` — shell، polling، state machine رابط کاربری، میان‌برها
- `app/ui/tray.py` — یکپارچگی با system tray ویندوز
- `app/core/bridge.py` — تنها نقطه‌ی اتصال منطق برنامه به UI
- `app/core/database_manager.py` — validate/migrate با آزادسازی قفل فایل

## قرارداد اتصال

`app/core/bridge.py` تنها نقطه‌ی اتصال است. برای اتصال هسته، ماژول عمومی `app.core.config` (تابع اختیاری `get`) و ماژول عمومی سرویس (تابع‌های اختیاری `start`، `stop`، `restart`) کافی است.
