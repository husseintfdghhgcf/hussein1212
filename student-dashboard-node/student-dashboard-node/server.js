'use strict';
const path = require('path');
const express = require('express');
const session = require('express-session');
const config = require('./src/config');
const repo = require('./src/repository');
const auth = require('./src/auth');
const { AppException } = require('./src/helpers');

const app = express();
const PUBLIC_DIR = path.join(__dirname, 'public');

if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');

/* ---------- security headers ---------- */
app.use((req, res, next) => {
  res.set({
    'X-Frame-Options': 'SAMEORIGIN',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});

/* ---------- body parsing + session ---------- */
app.use(express.json({ limit: '64kb' }));
app.use(session({
  name: 'SDASH_SESSID',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true, // idle timeout: the cookie is renewed on every request
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto', // Secure automatically when served over HTTPS
    maxAge: config.sessionTimeout * 1000,
  },
}));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };

/* ================= API ================= */
const api = express.Router();
api.use(noStore);

// Who am I + CSRF token (the static pages call this first)
api.get('/session', (req, res) => {
  res.json({ ok: true, role: (req.session && req.session.role) || null, csrf: auth.ensureCsrf(req) });
});

api.post('/admin/login', auth.csrfProtect, wrap(async (req, res) => {
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!username || !password) return res.status(422).json({ ok: false, message: 'يرجى إدخال اسم المستخدم وكلمة المرور.' });
  const r = await auth.attemptAdminLogin(req, username, password);
  if (!r.ok) return res.status(r.status).json({ ok: false, message: r.message });
  res.json({ ok: true, csrf: req.session.csrf });
}));

api.post('/student/login', auth.csrfProtect, wrap(async (req, res) => {
  const name = typeof req.body.student_name === 'string' ? req.body.student_name.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!name || !password) return res.status(422).json({ ok: false, message: 'يرجى إدخال الاسم وكلمة المرور.' });
  const r = await auth.attemptStudentLogin(req, name, password);
  if (!r.ok) return res.status(r.status).json({ ok: false, message: r.message });
  res.json({ ok: true, csrf: req.session.csrf });
}));

api.post('/logout', auth.csrfProtect, wrap(async (req, res) => {
  await auth.destroySession(req, res);
  res.json({ ok: true });
}));

// ----- admin data API (admin only) -----
api.get('/admin', wrap(auth.apiRequireAdmin), wrap(async (req, res) => {
  res.json({ ok: true, state: await repo.buildState(repo.parseFilters(req.query)) });
}));

api.post('/admin', wrap(auth.apiRequireAdmin), auth.csrfProtect, wrap(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const action = typeof body.action === 'string' ? body.action : '';
  const filters = repo.parseFilters(body.filters);
  const idOf = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) ? n : 0; };

  let message;
  switch (action) {
    case 'student_save':   message = await repo.saveStudent(body); break;
    case 'student_delete': message = await repo.deleteStudent(idOf(body.id)); break;
    case 'score_adjust':   message = await repo.adjustScore(idOf(body.id), body.delta); break;
    case 'group_add':      message = await repo.addGroup(body.name ?? ''); break;
    case 'group_delete':   message = await repo.deleteGroup(idOf(body.id)); break;
    default:
      return res.status(400).json({ ok: false, message: 'عملية غير معروفة.' });
  }
  res.json({ ok: true, message, state: await repo.buildState(filters) });
}));

// ----- student data API (own data only) -----
api.get('/student/me', wrap(auth.apiRequireStudent), wrap(async (req, res) => {
  res.json({ ok: true, me: req.profile, groups_total: await repo.groupsCount() });
}));

api.use((req, res) => res.status(404).json({ ok: false, message: 'المسار غير موجود.' }));
app.use('/api', api);

/* ================= Pages (static HTML) ================= */
// Dashboards are only served to the right role; everyone else is sent to the login page.
const adminOnly = auth.pageRequireRole('admin', '/admin/login.html');
const studentOnly = auth.pageRequireRole('student', '/student/login.html');
app.get(['/admin', '/admin/', '/admin/index.html'], adminOnly, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'index.html')));
app.get(['/student', '/student/', '/student/index.html'], studentOnly, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'student', 'index.html')));

app.use(express.static(PUBLIC_DIR, { index: 'index.html', dotfiles: 'ignore', extensions: ['html'] }));

/* ================= Errors ================= */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const isApi = req.path.startsWith('/api');
  if (err instanceof AppException) {
    return res.status(err.status).json({ ok: false, message: err.message });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, message: 'صيغة الطلب غير صحيحة.' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, message: 'حجم الطلب كبير جداً.' });
  }
  console.error('[student-dashboard]', err);
  if (isApi) return res.status(500).json({ ok: false, message: 'حدث خطأ في الخادم، يرجى المحاولة لاحقاً.' });
  res.status(500).type('html').send(
    '<!DOCTYPE html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>خطأ</title>' +
    '<body style="font-family:Tahoma,sans-serif;text-align:center;padding:60px;background:#111827;color:#f3f4f6">' +
    '<h2>تعذر إكمال الطلب</h2><p>تحقق من إعدادات قاعدة البيانات في ملف .env</p></body>'
  );
});

app.listen(config.port, () => {
  console.log(`Student dashboard running on http://localhost:${config.port}`);
});
