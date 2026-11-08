# لوحة تقييم الطلاب — Node.js + MySQL

نفس المشروع القديم (PHP) لكن:
- صفحات الواجهة صارت **HTML + CSS + JS** صافية داخل مجلد `public/` (بدون أي كود PHP).
- الباك اند صار **Node.js (Express)** بدل PHP، ويستخدم **نفس قاعدة بيانات MySQL ونفس الجداول**.

## هيكل المشروع

```
server.js              السيرفر (Express) + مسارات الـAPI + حماية الصفحات
src/
  config.js            قراءة الإعدادات من .env
  db.js                اتصال MySQL (pool)
  helpers.js           تنظيف المدخلات، الأخطاء، الأفاتارات
  repository.js        كل استعلامات SQL (بديل repository.php)
  auth.js              تسجيل الدخول، الجلسات، CSRF، منع التخمين (بديل auth.php)
scripts/
  init-db.js           إنشاء الجداول + البيانات التجريبية
  create-admin.js      إنشاء أول مشرف (بديل install.php)
database/database.sql  نفس ملف قاعدة البيانات القديم
public/                الواجهة (HTML/CSS/JS)
  index.html
  admin/login.html · admin/index.html
  student/login.html · student/index.html
  assets/css/style.css
  assets/js/ common.js · admin.js · student.js · login.js · landing.js · tailwind-config.js
```

## التشغيل

1. ثبّت Node.js (الإصدار 18 أو أحدث) و MySQL (أو XAMPP للـMySQL فقط).
2. داخل مجلد المشروع:
   ```bash
   npm install
   cp .env.example .env      # على ويندوز: copy .env.example .env
   ```
3. افتح `.env` وعدّل بيانات MySQL و`SESSION_SECRET` (اكتب أي نص طويل عشوائي).
4. أنشئ قاعدة البيانات والجداول:
   ```bash
   npm run db:init
   ```
5. أنشئ حساب المشرف الأول:
   ```bash
   npm run admin:create -- admin MyStrongPass123 "اسم المشرف"
   ```
6. شغّل السيرفر:
   ```bash
   npm start
   ```
7. افتح `http://localhost:3000`

الطلاب التجريبيون كلمة مرورهم `Student@2026` (مثلاً: `عمر خالد العتيبي`). غيّرها قبل النشر.

## مقارنة سريعة بالنسخة القديمة

| PHP القديم | Node.js الجديد |
|---|---|
| `admin/index.php` | `public/admin/index.html` + `GET /api/admin` |
| `api/admin.php` | `GET/POST /api/admin` |
| `admin/login.php` / `student/login.php` | `login.html` + `POST /api/admin/login` / `POST /api/student/login` |
| `logout.php` | `POST /api/logout` |
| `install.php` | `npm run db:init` + `npm run admin:create` |
| `includes/repository.php` | `src/repository.js` |
| `includes/auth.php` | `src/auth.js` |
| `config/config.php` | `.env` |
| `.htaccess` يمنع config/includes | غير مطلوب: يُقدَّم فقط مجلد `public/` |

## الأمان (نفس مستوى النسخة القديمة)

- استعلامات SQL كلها Prepared Statements.
- كلمات المرور بـ bcrypt (`bcryptjs`) — وهاشات النسخة القديمة (`$2y$` / `$2b$`) تشتغل مباشرة.
- جلسات HttpOnly + SameSite=Lax + Secure تلقائياً على HTTPS، وانتهاء بعد ساعتين خمول.
- حماية CSRF بهيدر `X-CSRF-Token` على كل عملية تعديل وتسجيل دخول وخروج.
- صلاحيات على السيرفر: الأدمن فقط يوصل `/api/admin`، والطالب يشوف بياناته فقط (الـid من الجلسة).
- منع التخمين: 8 محاولات فاشلة / 15 دقيقة لكل IP لكل بوابة، ومسجلة في `login_logs`.

## ملاحظات للنشر

- الجلسات تُخزَّن بالذاكرة (MemoryStore) وهذا مناسب للتجربة والمشاريع الصغيرة، لكنها تُمسح عند إعادة تشغيل السيرفر. للإنتاج الكبير استخدم `express-mysql-session`.
- خلف Nginx / Cloudflare / استضافة Node: اجعل `TRUST_PROXY=true` و`NODE_ENV=production` وفعّل HTTPS.
- الواجهة ما زالت تحمّل Tailwind و FontAwesome و خط Tajawal من CDN مثل الأصل.
