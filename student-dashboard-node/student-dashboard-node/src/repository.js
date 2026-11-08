'use strict';
const bcrypt = require('bcryptjs');
const pool = require('./db');
const { AppException, strChars, cleanText, AVATARS, toInt } = require('./helpers');

const SORT_OPTIONS = {
  scoreDesc: 's.score DESC, s.name ASC, s.id ASC',
  scoreAsc: 's.score ASC, s.name ASC, s.id ASC',
  nameAsc: 's.name ASC, s.id ASC',
  idAsc: 's.id ASC',
};

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

/** Sanitise search / filter / sort input (whitelist based). */
function parseFilters(src) {
  src = src && typeof src === 'object' ? src : {};
  const q = typeof src.q === 'string' ? [...src.q.trim()].slice(0, 100).join('') : '';
  const g = toInt(src.group, 1);
  const group = g !== null ? g : 'ALL';
  const sort = typeof src.sort === 'string' && Object.prototype.hasOwnProperty.call(SORT_OPTIONS, src.sort)
    ? src.sort : 'scoreDesc';
  return { q, group, sort };
}

/** Global rank for every student id. Equal scores share the same rank. */
async function rankMap() {
  const [rows] = await pool.query('SELECT id, score FROM students ORDER BY score DESC, name ASC, id ASC');
  const map = new Map();
  let i = 0, rank = 0, prev = null;
  for (const r of rows) {
    i++;
    if (r.score !== prev) { rank = i; prev = r.score; }
    map.set(r.id, rank);
  }
  return map;
}

async function fetchGroups() {
  const [rows] = await pool.query('SELECT id, name FROM `groups` ORDER BY id ASC');
  return rows.map((g) => ({ id: g.id, name: g.name }));
}

/** Everything the admin dashboard needs in one payload. */
async function buildState(filters) {
  const ranks = await rankMap();

  const where = [];
  const params = [];
  if (filters.q !== '') {
    const like = '%' + filters.q.replace(/[!%_]/g, (c) => '!' + c) + '%';
    where.push("(s.name LIKE ? ESCAPE '!' OR s.student_code LIKE ? ESCAPE '!')");
    params.push(like, like);
  }
  if (filters.group !== 'ALL') {
    where.push('s.group_id = ?');
    params.push(filters.group);
  }
  const sql =
    'SELECT s.id, s.student_code, s.name, s.group_id, s.score, s.avatar, g.name AS group_name ' +
    'FROM students s JOIN `groups` g ON g.id = s.group_id' +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY ' + SORT_OPTIONS[filters.sort];
  const [srows] = await pool.execute(sql, params);

  const students = srows.map((r) => ({
    id: r.id,
    code: String(r.student_code ?? ''),
    name: r.name,
    group_id: r.group_id,
    group: r.group_name,
    score: r.score,
    avatar: r.avatar,
    rank: ranks.get(r.id) || 0,
  }));

  const [top] = await pool.query(
    'SELECT s.id, s.name, s.score, s.avatar, g.name AS group_name ' +
    'FROM students s JOIN `groups` g ON g.id = s.group_id ' +
    'ORDER BY s.score DESC, s.name ASC, s.id ASC LIMIT 3'
  );
  const podium = top.map((r) => ({ id: r.id, name: r.name, score: r.score, avatar: r.avatar, group: r.group_name }));

  const [[agg]] = await pool.query('SELECT COUNT(*) AS c, AVG(score) AS a FROM students');
  const totalStudents = Number(agg.c);
  const groups = await fetchGroups();

  return {
    groups,
    students,
    podium,
    total_students: totalStudents,
    stats: {
      total_students: totalStudents,
      total_groups: groups.length,
      avg_score: totalStudents > 0 ? round1(agg.a) : 0,
      top_name: podium[0] ? podium[0].name : null,
      top_score: podium[0] ? podium[0].score : 0,
    },
  };
}

function translateDbError(e) {
  if (e && e.errno === 1062) return new AppException('هذا الاسم مسجل مسبقاً، يرجى اختيار اسم مختلف.');
  if (e && e.errno === 1452) return new AppException('المجموعة المحددة غير موجودة.');
  return e;
}

/** Create or update a student. Returns the success message. */
async function saveStudent(input) {
  const rawId = input.id;
  const id = rawId === undefined || rawId === null || rawId === '' ? 0 : (toInt(rawId, 0) || 0);

  const name = cleanText(input.name ?? '');
  const len = strChars(name);
  if (len < 2 || len > 120) throw new AppException('اسم الطالب يجب أن يتراوح بين 2 و 120 حرفاً.');

  const score = toInt(input.score, 0, 100);
  if (score === null) throw new AppException('التقييم يجب أن يكون رقماً صحيحاً بين 0 و 100.');

  let avatar = typeof input.avatar === 'string' ? input.avatar : '';
  if (!AVATARS.includes(avatar)) avatar = AVATARS[0];

  const groupId = toInt(input.group_id, 1);
  if (groupId === null) throw new AppException('يرجى اختيار المجموعة.');
  const [g] = await pool.execute('SELECT 1 FROM `groups` WHERE id = ?', [groupId]);
  if (g.length === 0) throw new AppException('المجموعة المحددة غير موجودة.');

  const password = typeof input.password === 'string' ? input.password : '';
  if (id === 0 && password === '') throw new AppException('كلمة مرور الطالب مطلوبة.');
  const pwBytes = Buffer.byteLength(password);
  if (password !== '' && (pwBytes < 6 || pwBytes > 72)) {
    throw new AppException('كلمة المرور يجب أن تتراوح بين 6 و 72 حرفاً.');
  }

  if (id > 0) {
    const [ex] = await pool.execute('SELECT 1 FROM students WHERE id = ?', [id]);
    if (ex.length === 0) throw new AppException('الطالب غير موجود.', 404);
    let sql = 'UPDATE students SET name = ?, group_id = ?, score = ?, avatar = ?';
    const p = [name, groupId, score, avatar];
    if (password !== '') {
      sql += ', password_hash = ?';
      p.push(await bcrypt.hash(password, 10));
    }
    sql += ' WHERE id = ?';
    p.push(id);
    try {
      await pool.execute(sql, p);
    } catch (e) {
      throw translateDbError(e);
    }
    return 'تم تعديل بيانات الطالب بنجاح';
  }

  const hash = await bcrypt.hash(password, 10);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [res] = await conn.execute(
      'INSERT INTO students (name, password_hash, group_id, score, avatar) VALUES (?, ?, ?, ?, ?)',
      [name, hash, groupId, score, avatar]
    );
    const newId = res.insertId;
    await conn.execute('UPDATE students SET student_code = ? WHERE id = ?', ['STD-' + (100 + newId), newId]);
    await conn.commit();
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw translateDbError(e);
  } finally {
    conn.release();
  }
  return 'تمت إضافة الطالب الجديد بنجاح';
}

async function deleteStudent(id) {
  const [res] = await pool.execute('DELETE FROM students WHERE id = ?', [id]);
  if (res.affectedRows === 0) throw new AppException('الطالب غير موجود.', 404);
  return 'تم حذف الطالب من القائمة';
}

/** Atomically change a score by delta, clamped to 0..100. */
async function adjustScore(id, deltaRaw) {
  const delta = toInt(deltaRaw, -100, 100);
  if (delta === null) throw new AppException('قيمة التعديل غير صحيحة.');
  await pool.execute(
    'UPDATE students SET score = LEAST(100, GREATEST(0, CAST(score AS SIGNED) + ?)) WHERE id = ?',
    [delta, id]
  );
  const [rows] = await pool.execute('SELECT name, score FROM students WHERE id = ?', [id]);
  if (rows.length === 0) throw new AppException('الطالب غير موجود.', 404);
  return 'تم تحديث تقييم ' + rows[0].name + ' إلى ' + rows[0].score + ' نقطة';
}

async function addGroup(nameRaw) {
  const name = cleanText(nameRaw);
  const len = strChars(name);
  if (len < 1 || len > 100) throw new AppException('اسم المجموعة يجب أن يتراوح بين 1 و 100 حرف.');
  try {
    await pool.execute('INSERT INTO `groups` (name) VALUES (?)', [name]);
  } catch (e) {
    if (e && e.errno === 1062) throw new AppException('هذه المجموعة موجودة مسبقاً.');
    throw e;
  }
  return 'تمت إضافة مجموعة "' + name + '"';
}

async function deleteGroup(id) {
  const [g] = await pool.execute('SELECT name FROM `groups` WHERE id = ?', [id]);
  if (g.length === 0) throw new AppException('المجموعة غير موجودة.', 404);
  const name = g[0].name;
  const msg = 'لا يمكن حذف المجموعة (' + name + ') لأنها تحتوي على طلاب مسجلين حالياً. قم بنقل الطلاب أولاً.';
  const [[c]] = await pool.execute('SELECT COUNT(*) AS c FROM students WHERE group_id = ?', [id]);
  if (Number(c.c) > 0) throw new AppException(msg);
  try {
    await pool.execute('DELETE FROM `groups` WHERE id = ?', [id]);
  } catch (e) {
    if (e && e.errno === 1451) throw new AppException(msg); // FK restrict (student added concurrently)
    throw e;
  }
  return 'تم حذف المجموعة';
}

/** A student's own data + ranking. Never exposes other students. */
async function studentProfile(id) {
  const [rows] = await pool.execute(
    'SELECT s.id, s.student_code, s.name, s.score, s.avatar, s.group_id, g.name AS group_name ' +
    'FROM students s JOIN `groups` g ON g.id = s.group_id WHERE s.id = ? LIMIT 1',
    [id]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  const score = r.score;

  const [[a]] = await pool.execute('SELECT COUNT(*) AS c FROM students WHERE score > ?', [score]);
  const [[b]] = await pool.execute('SELECT COUNT(*) AS c FROM students WHERE group_id = ? AND score > ?', [r.group_id, score]);
  const [[t]] = await pool.query('SELECT COUNT(*) AS c, AVG(score) AS a FROM students');
  const [[gt]] = await pool.execute('SELECT COUNT(*) AS c FROM students WHERE group_id = ?', [r.group_id]);

  return {
    id: r.id,
    code: String(r.student_code ?? ''),
    name: r.name,
    score,
    avatar: r.avatar,
    group: r.group_name,
    rank: 1 + Number(a.c),
    total: Number(t.c),
    group_rank: 1 + Number(b.c),
    group_total: Number(gt.c),
    avg: round1(t.a),
  };
}

async function groupsCount() {
  const [[r]] = await pool.query('SELECT COUNT(*) AS c FROM `groups`');
  return Number(r.c);
}

module.exports = {
  parseFilters, buildState, saveStudent, deleteStudent, adjustScore,
  addGroup, deleteGroup, studentProfile, groupsCount,
};
