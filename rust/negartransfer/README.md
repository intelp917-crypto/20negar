# negartransfer — موتور پرسرعت آپلود و دانلود (Rust)

موتور انتقال فایل استودیو ۲۰نگار. کارهای سنگین انتقال بایت را از Node جدا می‌کند:

- **آپلود چانکی موازی و ازسر‌گیر**: هر تکه مستقیم روی offset خودش در فایل نوشته
  می‌شود، پس چند تکه هم‌زمان و بدون بافر شدن در حافظه ارسال می‌شوند.
- **دانلود بازه‌ای (Range/206)**: فایل با بافر بزرگ و بدون خواندن کامل در حافظه
  استریم می‌شود؛ برای پخش ویدیو و قطعات HLS.

بدون وابستگی سنگین نوشته شده است (std + رمزنگاری pure-Rust)، بنابراین روی هر
ماشینی بدون نیاز به ابزار بیلد C کامپایل می‌شود.

## بیلد

```bash
npm run build:transfer
# یا
cargo build --release --manifest-path rust/negartransfer/Cargo.toml
```

خروجی: `rust/negartransfer/target/release/negartransfer[.exe]`

سرور Node این باینری را در استارتاپ به‌صورت خودکار اجرا می‌کند. اگر باینری موجود
نباشد، برنامه به‌صورت خودکار به پیاده‌سازی داخلی Node برمی‌گردد (بدون خطا).

## مسیرها

پروکسی روی `/api/transfer` توسط سرور Node:

| متد | مسیر | توضیح |
| --- | --- | --- |
| `GET` | `/health` | وضعیت موتور (بدون احراز هویت) |
| `POST` | `/upload/init` | ساخت نشست آپلود (JSON: fileName، fileSize، mimeType، chunkSize) |
| `PUT` | `/upload/:id/chunk/:index` | ارسال یک تکه (بدنه خام، قابل ارسال موازی) |
| `GET` | `/upload/:id` | وضعیت و ازسر‌گیری (کدام تکه‌ها رسیده‌اند) |
| `POST` | `/upload/:id/complete` | نهایی‌سازی و اعتبارسنجی حجم |
| `GET` | `/download?key=&exp=&sig=&name=&dl=` | استریم فایل با پشتیبانی Range |

## احراز هویت

- **آپلود**: توکن JWT برنامه (HS256) با همان `JWT_SECRET` سرور؛ نقش‌های مجاز:
  `Editor`، `Cameraman`، `Admin`، `SuperAdmin`.
- **دانلود**: امضای کوتاه‌مدت HMAC که سرور Node پس از اعمال کنترل دسترسی خودش
  صادر می‌کند؛ بنابراین موتور به دیتابیس دسترسی ندارد.
- مسیرها در برابر `../` محافظت شده‌اند و فقط داخل پوشه storage سرو می‌شوند.

## متغیرهای محیطی

`NEGAR_TRANSFER_PORT`، `NEGAR_TRANSFER_SECRET`، `NEGAR_TRANSFER_ENABLED`،
`NEGAR_TRANSFER_BIN`، `JWT_SECRET`، `NEGAR_DATA_DIR`، `NEGAR_STORAGE_DIR`،
`NEGAR_CHUNK_DIR`.

## سازگاری

نشست‌های آپلود در همان قالب روی‌دیسک پیاده‌سازی Node
(`<id>.data` و `<id>.json` در `data/storage/temp/chunked`) نوشته می‌شوند، پس
پایپ‌لاین ساخت ویدیو بدون هیچ تغییری کار می‌کند.
