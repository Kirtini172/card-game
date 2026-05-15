/**
 * Минимальная файловая "БД" без внешних зависимостей.
 * Хранит users / games / sessions / activeGames в одном JSON-файле.
 * Запись атомарная (через временный файл + переименование), плюс
 * дебаунс ~100 мс, чтобы не дёргать диск на каждый ход.
 *
 * Если в будущем понадобится настоящая БД (SQLite/Postgres) — достаточно
 * заменить тело этого модуля, сохранив публичный API.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const TMP_FILE = DB_FILE + '.tmp';

const EMPTY_DB = {
  users: {},        // username -> { username, passwordHash, salt, createdAt }
  sessions: {},     // token -> { username, createdAt }
  games: {},        // code   -> { code, vsBot, status, state, updatedAt }
  activeGames: {},  // username -> code  (последняя незаконченная игра пользователя)
};

let cache = null;
let writeTimer = null;
let pendingResolves = [];

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  if (cache) return cache;
  ensureDir();
  if (!fs.existsSync(DB_FILE)) {
    cache = JSON.parse(JSON.stringify(EMPTY_DB));
    return cache;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    cache = Object.assign({}, EMPTY_DB, parsed);
    for (const key of Object.keys(EMPTY_DB)) {
      if (!cache[key]) cache[key] = JSON.parse(JSON.stringify(EMPTY_DB[key]));
    }
    return cache;
  } catch (e) {
    console.error('[db] не удалось прочитать БД, начинаем с пустой:', e.message);
    cache = JSON.parse(JSON.stringify(EMPTY_DB));
    return cache;
  }
}

function flushNow() {
  if (!cache) return;
  ensureDir();
  const json = JSON.stringify(cache, null, 2);
  fs.writeFileSync(TMP_FILE, json, 'utf8');
  fs.renameSync(TMP_FILE, DB_FILE);
}

function scheduleSave() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      flushNow();
      pendingResolves.splice(0).forEach(r => r());
    } catch (e) {
      console.error('[db] ошибка записи:', e.message);
      pendingResolves.splice(0).forEach(r => r());
    }
  }, 100);
}

function save() {
  scheduleSave();
}

// --- Пароли ---

function hashPassword(password, saltHex) {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const computed = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// --- Пользователи ---

const USERNAME_RE = /^[A-Za-z0-9_\-]{3,20}$/;

function registerUser(username, password) {
  const db = load();
  const name = String(username || '').trim();
  if (!USERNAME_RE.test(name)) {
    return { ok: false, error: 'Логин: 3–20 символов (буквы/цифры/_-)' };
  }
  if (!password || String(password).length < 4) {
    return { ok: false, error: 'Пароль минимум 4 символа' };
  }
  const key = name.toLowerCase();
  if (db.users[key]) {
    return { ok: false, error: 'Такой логин уже занят' };
  }
  const { salt, hash } = hashPassword(password);
  db.users[key] = {
    username: name,
    salt,
    passwordHash: hash,
    createdAt: new Date().toISOString(),
  };
  save();
  return { ok: true, username: name };
}

function authenticateUser(username, password) {
  const db = load();
  const key = String(username || '').trim().toLowerCase();
  const user = db.users[key];
  if (!user) return { ok: false, error: 'Неверный логин или пароль' };
  if (!verifyPassword(password, user.salt, user.passwordHash)) {
    return { ok: false, error: 'Неверный логин или пароль' };
  }
  return { ok: true, username: user.username };
}

// --- Сессии (токены) ---

function createSession(username) {
  const db = load();
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = { username, createdAt: new Date().toISOString() };
  save();
  return token;
}

function getSessionUsername(token) {
  if (!token) return null;
  const db = load();
  const s = db.sessions[token];
  return s ? s.username : null;
}

function destroySession(token) {
  if (!token) return;
  const db = load();
  if (db.sessions[token]) {
    delete db.sessions[token];
    save();
  }
}

// --- Игры ---

function saveGame(code, payload) {
  const db = load();
  db.games[code] = Object.assign({}, db.games[code], payload, {
    code,
    updatedAt: new Date().toISOString(),
  });
  save();
}

function getGame(code) {
  const db = load();
  return db.games[code] || null;
}

function deleteGame(code) {
  const db = load();
  if (db.games[code]) delete db.games[code];
  for (const u of Object.keys(db.activeGames)) {
    if (db.activeGames[u] === code) delete db.activeGames[u];
  }
  save();
}

function setActiveGame(username, code) {
  const db = load();
  if (code) db.activeGames[username] = code;
  else delete db.activeGames[username];
  save();
}

function getActiveGameCode(username) {
  const db = load();
  return db.activeGames[username] || null;
}

/**
 * Возвращает все игры, статус которых не finished — нужно для восстановления
 * лобби в памяти при старте сервера.
 */
function listLiveGames() {
  const db = load();
  return Object.values(db.games).filter(g => g && g.status !== 'finished');
}

// На случай аварийного завершения — синхронный сброс при exit
function flushOnExit() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
    try { flushNow(); } catch (e) { /* ничего не поделать */ }
  }
}
process.on('exit', flushOnExit);
process.on('SIGINT', () => { flushOnExit(); process.exit(0); });
process.on('SIGTERM', () => { flushOnExit(); process.exit(0); });

module.exports = {
  registerUser,
  authenticateUser,
  createSession,
  getSessionUsername,
  destroySession,
  saveGame,
  getGame,
  deleteGame,
  setActiveGame,
  getActiveGameCode,
  listLiveGames,
};
