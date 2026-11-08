'use strict';
const bcrypt = require('bcryptjs');
const pool = require('./db');
const config = require('./config');
const { AppException, cleanText, newCsrf, safeEqual } = require('./helpers');
const { studentProfile } = require('./repository');

// Used so that unknown usernames cost the same time as wrong passwords.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

/* ---------- login logging & brute-force throttling ---------- */

async function logLogin(req, role, userId, username, success) {
  try {
    await pool.execute(
      'INSERT INTO login_logs (role, user_id, username, ip_address, user_agent, success) VALUES (?, ?, ?, ?, ?, ?)',
      [
        role,
        userId,
        [...String(username)].slice(0, 120).join(''),
        String(req.ip || '0.0.0.0').slice(0, 45),
        String(req.get('user-agent') || '').slice(0, 255),
        success ? 1 : 0,
      ]
    );
    if (success) { // housekeeping: keep 90 days of history
      await pool.query('DELETE FROM login_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)');
    }
  } catch (e) {
    console.error('login log failed:', e.message);
  }
}

async function loginIsBlocked(req, role) {
  const [[r]] = await pool.execute(
    'SELECT COUNT(*) AS c FROM login_logs WHERE role = ? AND ip_address = ? AND success = 0 ' +
    'AND created_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)',
    [role, String(req.ip || '0.0.0.0').slice(0, 45), config.lockoutMinutes]
  );
  return Number(r.c) >= config.maxFailedLogins;
}

/* ---------- session helpers ---------- */

function regenerate(req) {
  return new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
}

async function sessionBegin(req, role, userId) {
  await regenerate(req);
  req.session.role = role;
  req.session.uid = userId;
  req.session.csrf = newCsrf();
}

function destroySession(req, res) {
  return new Promise((resolve) => {
    req.session.destroy(() => {
      res.clearCookie('SDASH_SESSID', { path: '/' });
      resolve();
    });
  });
}

function ensureCsrf(req) {
  if (!req.session.csrf) req.session.csrf = newCsrf();
  return req.session.csrf;
}

/* ---------- login attempts ---------- */

const BLOCKED_MSG = 'تم تجاوز عدد محاولات الدخول المسموحة. حاول مرة أخرى بعد قليل.';

async function attemptAdminLogin(req, usernameRaw, password) {
  const username = String(usernameRaw || '').trim();
  if (await loginIsBlocked(req, 'admin')) return { ok: false, status: 429, message: BLOCKED_MSG };

  const [rows] = await pool.execute('SELECT id, username, password_hash FROM admins WHERE username = ? LIMIT 1', [username]);
  const row = rows[0];
  const match = await bcrypt.compare(password, row ? row.password_hash : DUMMY_HASH);

  if (!row || !match) {
    await logLogin(req, 'admin', row ? row.id : null, username, false);
    return { ok: false, status: 401, message: 'اسم المستخدم أو كلمة المرور غير صحيحة.' };
  }
  await pool.execute('UPDATE admins SET last_login_at = NOW() WHERE id = ?', [row.id]);
  await logLogin(req, 'admin', row.id, username, true);
  await sessionBegin(req, 'admin', row.id);
  return { ok: true };
}

async function attemptStudentLogin(req, nameRaw, password) {
  let name;
  try { name = cleanText(nameRaw); } catch (e) { name = ''; }
  if (await loginIsBlocked(req, 'student')) return { ok: false, status: 429, message: BLOCKED_MSG };

  const [rows] = await pool.execute('SELECT id, name, password_hash FROM students WHERE name = ? LIMIT 1', [name]);
  const row = rows[0];
  const match = await bcrypt.compare(password, row ? row.password_hash : DUMMY_HASH);

  if (!row || !match) {
    await logLogin(req, 'student', row ? row.id : null, name, false);
    return { ok: false, status: 401, message: 'الاسم أو كلمة المرور غير صحيحة.' };
  }
  await logLogin(req, 'student', row.id, name, true);
  await sessionBegin(req, 'student', row.id);
  return { ok: true };
}

/* ---------- middleware ---------- */

/** Admin API guard: session + role, re-checked against the database. */
async function apiRequireAdmin(req, res, next) {
  try {
    const s = req.session;
    if (!s || !s.role || !s.uid) {
      return res.status(401).json({ ok: false, message: 'انتهت الجلسة، يرجى تسجيل الدخول.' });
    }
    if (s.role !== 'admin') {
      return res.status(403).json({ ok: false, message: 'غير مصرح لك بتنفيذ هذه العملية.' });
    }
    const [rows] = await pool.execute('SELECT id FROM admins WHERE id = ? LIMIT 1', [s.uid]);
    if (rows.length === 0) {
      return res.status(401).json({ ok: false, message: 'انتهت الجلسة، يرجى تسجيل الدخول.' });
    }
    next();
  } catch (e) { next(e); }
}

/** Student API guard. The student id ALWAYS comes from the session, never from the request. */
async function apiRequireStudent(req, res, next) {
  try {
    const s = req.session;
    if (!s || s.role !== 'student' || !s.uid) {
      return res.status(401).json({ ok: false, message: 'انتهت الجلسة، يرجى تسجيل الدخول.' });
    }
    const profile = await studentProfile(s.uid);
    if (!profile) {
      await destroySession(req, res);
      return res.status(401).json({ ok: false, message: 'انتهت الجلسة، يرجى تسجيل الدخول.' });
    }
    req.profile = profile;
    next();
  } catch (e) { next(e); }
}

/** CSRF check for every state-changing request (X-CSRF-Token header). */
function csrfProtect(req, res, next) {
  const token = req.get('x-csrf-token');
  if (!safeEqual(req.session && req.session.csrf, token)) {
    return res.status(403).json({ ok: false, message: 'رمز الحماية غير صالح، أعد تحميل الصفحة.' });
  }
  next();
}

/** HTML page guards (the pages themselves are static; data is protected by the API guards above). */
function pageRequireRole(role, loginPath) {
  return (req, res, next) => {
    if (req.session && req.session.role === role && req.session.uid) return next();
    res.redirect(loginPath);
  };
}

module.exports = {
  attemptAdminLogin, attemptStudentLogin, apiRequireAdmin, apiRequireStudent,
  csrfProtect, pageRequireRole, destroySession, ensureCsrf, AppException,
};
