// Импортируем необходимые модули
const express = require('express');      // Веб-фреймворк
const http = require('http');           // HTTP сервер
const socketIo = require('socket.io');  // WebSocket библиотека
const path = require('path');           // Работа с путями файлов
const CardGame = require('./game');     // Наш класс игры
const bot = require('./bot');           // ИИ-противник для одиночной игры
const db = require('./db');             // Файловая БД: пользователи + игры

// Создаем Express приложение
const app = express();
// Создаем HTTP сервер на основе Express
const server = http.createServer(app);
// Инициализируем Socket.io на сервере
const io = socketIo(server);

// Настраиваем раздачу статических файлов из папки client
app.use(express.static(path.join(__dirname, '../client')));

/**
 * Менеджер лобби в памяти.
 *   code -> { game, vsBot, botId, sockets: { username -> socketId } }
 * Все игроки внутри game.players идентифицируются по username (стабильный id),
 * а сопоставление username <-> socket.id хранится в lobby.sockets.
 */
const lobbies = new Map();

// Соответствие сокет -> { username, code }
const socketInfo = new Map();

const BOT_USERNAME = '__bot__';

/**
 * Сохраняет состояние игры в БД.
 */
function persistLobby(code) {
  const lobby = lobbies.get(code);
  if (!lobby) return;
  const game = lobby.game;
  const humanPlayers = game.players.filter(p => p.id !== BOT_USERNAME);
  db.saveGame(code, {
    vsBot: !!lobby.vsBot,
    status: game.gameState,
    state: game.toJSON(),
    player1: humanPlayers[0] ? humanPlayers[0].id : null,
    player2: humanPlayers[1] ? humanPlayers[1].id : null,
  });
  // Поддерживаем "активная игра" для каждого человека-игрока
  for (const p of humanPlayers) {
    if (game.gameState === 'finished') {
      db.setActiveGame(p.id, null);
    } else {
      db.setActiveGame(p.id, code);
    }
  }
}

/**
 * Загружает из БД все не завершённые игры в память — на старте сервера.
 * Боты подгрузятся вместе с игрой, ходить продолжат как раньше.
 */
function restoreLobbiesFromDb() {
  const live = db.listLiveGames();
  for (const row of live) {
    if (!row || !row.state) continue;
    try {
      const game = CardGame.fromJSON(row.state);
      const lobby = {
        game,
        vsBot: !!row.vsBot,
        botId: row.vsBot ? BOT_USERNAME : null,
        sockets: {}, // никто пока не подключён
      };
      lobbies.set(row.code, lobby);
      console.log('[restore] восстановлено лобби', row.code, 'статус:', game.gameState);
    } catch (e) {
      console.error('[restore] не смогли восстановить', row.code, e.message);
    }
  }
}

/**
 * Генерирует случайный код лобби из 6 букв/цифр
 */
function generateLobbyCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  if (lobbies.has(code) || db.getGame(code)) return generateLobbyCode();
  return code;
}

/**
 * Проверяет, закончилась ли игра (у кого-то нет карт и колода пуста).
 */
function checkGameOver(code, lobby) {
  const game = lobby.game;
  if (game.gameState !== 'playing') return false;
  if (game.deck.length > 0) return false;
  const winner = game.players.find(p => p.cards.length === 0);
  if (!winner) return false;
  game.gameState = 'finished';
  io.to(code).emit('gameFinished', { winner: winner.name });
  persistLobby(code);
  return true;
}

/**
 * Планирует ход бота, если очередь его и игра ещё идёт.
 */
function scheduleBotMove(code) {
  const lobby = lobbies.get(code);
  if (!lobby || !lobby.botId) return;
  const game = lobby.game;
  if (game.gameState !== 'playing') return;
  if (!game.currentPlayer || game.currentPlayer.id !== lobby.botId) return;

  setTimeout(() => {
    const lob = lobbies.get(code);
    if (!lob || !lob.botId) return;
    const g = lob.game;
    if (g.gameState !== 'playing') return;
    if (!g.currentPlayer || g.currentPlayer.id !== lob.botId) return;

    const move = bot.decideMove(g, lob.botId);
    let acted = false;
    if (move.type === 'attack') {
      acted = g.playCard(lob.botId, move.cardIndex);
    } else if (move.type === 'defend') {
      acted = g.playCard(lob.botId, move.cardIndex, move.targetCardIndex);
    } else if (move.type === 'take') {
      acted = g.takeCards(lob.botId);
    }

    if (!acted) return;

    io.to(code).emit('gameStateUpdate', g.getGameState());
    persistLobby(code);
    if (checkGameOver(code, lob)) return;
    scheduleBotMove(code);
  }, 900);
}

/**
 * Привязывает сокет к игроку лобби (по username) и подписывает на комнату.
 */
function bindSocketToLobby(socket, username, code) {
  const lobby = lobbies.get(code);
  if (!lobby) return false;
  // если у пользователя был старый сокет — отключаем тот привязку
  for (const [u, sid] of Object.entries(lobby.sockets)) {
    if (u === username && sid !== socket.id) {
      const prev = io.sockets.sockets.get(sid);
      if (prev) prev.leave(code);
    }
  }
  lobby.sockets[username] = socket.id;
  socketInfo.set(socket.id, { username, code });
  socket.join(code);
  return true;
}

/**
 * Возвращает игрока в лобби, видимого "под этим логином".
 */
function findPlayerByUsername(lobby, username) {
  return lobby.game.players.find(p => p.id === username);
}

/**
 * Считаем сколько человек-игроков сейчас онлайн (есть привязанный сокет).
 */
function onlineHumanCount(lobby) {
  let n = 0;
  for (const username of Object.keys(lobby.sockets)) {
    if (username === BOT_USERNAME) continue;
    if (lobby.sockets[username]) n++;
  }
  return n;
}

/**
 * Подключения клиентов через Socket.io
 */
io.on('connection', (socket) => {
  console.log('=== НОВОЕ ПОДКЛЮЧЕНИЕ ===', socket.id);

  // -------- АУТЕНТИФИКАЦИЯ --------

  socket.on('register', (data) => {
    const username = (data && data.username || '').trim();
    const password = (data && data.password) || '';
    const res = db.registerUser(username, password);
    if (!res.ok) {
      socket.emit('authError', { message: res.error });
      return;
    }
    const token = db.createSession(res.username);
    socket.data.username = res.username;
    socket.emit('authSuccess', {
      username: res.username,
      token,
      activeGame: null,
    });
    console.log('Зарегистрирован пользователь:', res.username);
  });

  socket.on('login', (data) => {
    const username = (data && data.username || '').trim();
    const password = (data && data.password) || '';
    const res = db.authenticateUser(username, password);
    if (!res.ok) {
      socket.emit('authError', { message: res.error });
      return;
    }
    const token = db.createSession(res.username);
    socket.data.username = res.username;
    const activeCode = db.getActiveGameCode(res.username);
    socket.emit('authSuccess', {
      username: res.username,
      token,
      activeGame: activeCode ? { code: activeCode } : null,
    });
    console.log('Вход:', res.username, 'активная игра:', activeCode);
  });

  /**
   * Восстановление сессии по токену (например, после перезагрузки страницы).
   */
  socket.on('authByToken', (data) => {
    const token = data && data.token;
    const username = db.getSessionUsername(token);
    if (!username) {
      socket.emit('authError', { message: 'Сессия истекла, войдите заново' });
      return;
    }
    socket.data.username = username;
    const activeCode = db.getActiveGameCode(username);
    socket.emit('authSuccess', {
      username,
      token,
      activeGame: activeCode ? { code: activeCode } : null,
    });
    console.log('Авторизация по токену:', username);
  });

  socket.on('logout', (data) => {
    const info = socketInfo.get(socket.id);
    if (info) {
      const lobby = lobbies.get(info.code);
      if (lobby && lobby.sockets[info.username] === socket.id) {
        delete lobby.sockets[info.username];
      }
      socket.leave(info.code);
      socketInfo.delete(socket.id);
    }
    socket.data.username = null;
    if (data && data.token) db.destroySession(data.token);
  });

  // -------- ЛОББИ --------

  /**
   * Создать новое лобби (игрок становится хостом)
   */
  socket.on('createLobby', () => {
    const username = socket.data.username;
    if (!username) {
      socket.emit('lobbyError', { message: 'Сначала войдите в аккаунт' });
      return;
    }
    // Если у пользователя уже есть незакрытая игра — не создаём ещё одну
    const existing = db.getActiveGameCode(username);
    if (existing) {
      socket.emit('lobbyError', {
        message: 'У вас уже есть незаконченная игра. Продолжите её или завершите.',
      });
      return;
    }
    const code = generateLobbyCode();
    const game = new CardGame();
    game.addPlayer(username, username);
    const lobby = { game, vsBot: false, botId: null, sockets: {} };
    lobbies.set(code, lobby);
    bindSocketToLobby(socket, username, code);
    persistLobby(code);
    socket.emit('lobbyCreated', { code, playerId: username });
    io.to(code).emit('gameStateUpdate', game.getGameState());
    console.log('Лобби создано:', code, 'хост:', username);
  });

  /**
   * Создать одиночную игру против бота
   */
  socket.on('createBotLobby', () => {
    const username = socket.data.username;
    if (!username) {
      socket.emit('lobbyError', { message: 'Сначала войдите в аккаунт' });
      return;
    }
    const existing = db.getActiveGameCode(username);
    if (existing) {
      socket.emit('lobbyError', {
        message: 'У вас уже есть незаконченная игра. Продолжите её или завершите.',
      });
      return;
    }
    const code = generateLobbyCode();
    const game = new CardGame();
    game.addPlayer(username, username);
    game.addPlayer(BOT_USERNAME, 'Бот');
    const lobby = { game, vsBot: true, botId: BOT_USERNAME, sockets: {} };
    lobbies.set(code, lobby);
    bindSocketToLobby(socket, username, code);
    persistLobby(code);
    socket.emit('lobbyCreated', { code, playerId: username, vsBot: true });
    io.to(code).emit('gameStateUpdate', game.getGameState());
    console.log('Создано лобби с ботом:', code, 'игрок:', username);
    scheduleBotMove(code);
  });

  /**
   * Присоединиться к лобби по коду
   */
  socket.on('joinLobby', (data) => {
    const username = socket.data.username;
    if (!username) {
      socket.emit('lobbyError', { message: 'Сначала войдите в аккаунт' });
      return;
    }
    const code = (data && (data.lobbyCode || data.code) || '').toString().toUpperCase().trim();
    if (!code || code.length < 4) {
      socket.emit('lobbyError', { message: 'Введите код лобби' });
      return;
    }
    const lobby = lobbies.get(code);
    if (!lobby) {
      socket.emit('lobbyError', { message: 'Лобби с таким кодом не найдено' });
      return;
    }
    if (lobby.vsBot) {
      socket.emit('lobbyError', { message: 'Это одиночная игра против бота' });
      return;
    }
    // Если этот пользователь уже в лобби — это re-join, просто переподключаем
    if (findPlayerByUsername(lobby, username)) {
      bindSocketToLobby(socket, username, code);
      socket.emit('gameJoined', { playerId: username, lobbyCode: code, resumed: true });
      io.to(code).emit('gameStateUpdate', lobby.game.getGameState());
      return;
    }
    if (lobby.game.players.length >= 2) {
      socket.emit('lobbyError', { message: 'В лобби уже два игрока' });
      return;
    }
    // У присоединяющегося не должно быть другой незакрытой игры
    const existing = db.getActiveGameCode(username);
    if (existing && existing !== code) {
      socket.emit('lobbyError', {
        message: 'У вас уже есть незаконченная игра. Продолжите её или завершите.',
      });
      return;
    }
    const success = lobby.game.addPlayer(username, username);
    if (!success) {
      socket.emit('lobbyError', { message: 'Не удалось присоединиться' });
      return;
    }
    bindSocketToLobby(socket, username, code);
    persistLobby(code);
    socket.emit('gameJoined', { playerId: username, lobbyCode: code });
    io.to(code).emit('gameStateUpdate', lobby.game.getGameState());
    console.log('Игрок', username, 'вошёл в лобби', code);
  });

  /**
   * Продолжить ранее начатую игру: загружаем лобби (если выгружено) и
   * переподключаем сокет.
   */
  socket.on('resumeGame', () => {
    const username = socket.data.username;
    if (!username) {
      socket.emit('lobbyError', { message: 'Сначала войдите в аккаунт' });
      return;
    }
    const code = db.getActiveGameCode(username);
    if (!code) {
      socket.emit('lobbyError', { message: 'У вас нет сохранённой игры' });
      return;
    }
    let lobby = lobbies.get(code);
    if (!lobby) {
      const row = db.getGame(code);
      if (!row || !row.state) {
        db.setActiveGame(username, null);
        socket.emit('lobbyError', { message: 'Сохранение не найдено' });
        return;
      }
      const game = CardGame.fromJSON(row.state);
      lobby = {
        game,
        vsBot: !!row.vsBot,
        botId: row.vsBot ? BOT_USERNAME : null,
        sockets: {},
      };
      lobbies.set(code, lobby);
    }
    if (!findPlayerByUsername(lobby, username)) {
      socket.emit('lobbyError', { message: 'Вы не участвуете в этой игре' });
      return;
    }
    bindSocketToLobby(socket, username, code);
    socket.emit('gameJoined', {
      playerId: username,
      lobbyCode: code,
      resumed: true,
      vsBot: lobby.vsBot,
    });
    io.to(code).emit('gameStateUpdate', lobby.game.getGameState());
    console.log('Игрок', username, 'продолжил игру', code);
    // Если за нас ход бота — запускаем его
    scheduleBotMove(code);
  });

  /**
   * Полностью отказаться от текущей сохранённой игры (например, если
   * напарник пропал навсегда). Удаляет игру из БД.
   */
  socket.on('abandonGame', () => {
    const username = socket.data.username;
    if (!username) return;
    const code = db.getActiveGameCode(username);
    if (!code) return;
    const lobby = lobbies.get(code);
    if (lobby) {
      // Уведомим оставшегося игрока, если он есть
      io.to(code).emit('playerLeft', { message: 'Игрок покинул игру навсегда' });
      lobbies.delete(code);
    }
    db.deleteGame(code);
    socket.emit('gameAbandoned', { code });
    console.log('Игра', code, 'удалена пользователем', username);
  });

  // -------- ХОДЫ --------

  socket.on('playCard', (data) => {
    const info = socketInfo.get(socket.id);
    if (!info) {
      socket.emit('moveError', { message: 'Вы не в игре' });
      return;
    }
    const lobby = lobbies.get(info.code);
    if (!lobby) return;
    const { cardIndex, targetCardIndex } = data || {};
    const success = lobby.game.playCard(info.username, cardIndex, targetCardIndex);
    if (success) {
      io.to(info.code).emit('gameStateUpdate', lobby.game.getGameState());
      persistLobby(info.code);
      if (checkGameOver(info.code, lobby)) return;
      scheduleBotMove(info.code);
    } else {
      socket.emit('moveError', { message: 'Невозможно сделать этот ход' });
    }
  });

  socket.on('takeCards', () => {
    const info = socketInfo.get(socket.id);
    if (!info) return;
    const lobby = lobbies.get(info.code);
    if (!lobby) return;
    const success = lobby.game.takeCards(info.username);
    if (success) {
      io.to(info.code).emit('gameStateUpdate', lobby.game.getGameState());
      persistLobby(info.code);
      if (checkGameOver(info.code, lobby)) return;
      scheduleBotMove(info.code);
    } else {
      socket.emit('moveError', { message: 'Невозможно взять карты сейчас' });
    }
  });

  /**
   * Отключение игрока. ВАЖНО: игрока из CardGame НЕ удаляем — сохраняем
   * состояние, чтобы он мог вернуться. Просто рвём связь сокет<->лобби и
   * сообщаем второму игроку, что напарник вышел.
   */
  socket.on('disconnect', () => {
    const info = socketInfo.get(socket.id);
    socketInfo.delete(socket.id);
    if (!info) return;
    const lobby = lobbies.get(info.code);
    if (!lobby) return;
    if (lobby.sockets[info.username] === socket.id) {
      delete lobby.sockets[info.username];
    }
    if (lobby.game.gameState === 'finished') {
      // Финальная игра — можно убрать из памяти, в БД она уже отмечена finished
      // (и в активных играх её нет)
      if (onlineHumanCount(lobby) === 0) {
        lobbies.delete(info.code);
      }
      return;
    }
    io.to(info.code).emit('playerLeft', {
      message: 'Игрок вышел. Прогресс сохранён — он может вернуться и продолжить.',
      username: info.username,
    });
    // Если никого не осталось онлайн — выгружаем лобби из памяти,
    // оно по-прежнему лежит в БД и поднимется при resumeGame.
    if (onlineHumanCount(lobby) === 0) {
      lobbies.delete(info.code);
      console.log('Лобби', info.code, 'выгружено из памяти (сохранение в БД)');
    }
  });
});

// Восстанавливаем сохранённые лобби перед стартом
restoreLobbiesFromDb();

// Запускаем сервер на порту 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('=================================');
  console.log('🚀 СЕРВЕР ЗАПУЩЕН!');
  console.log('📡 Порт:', PORT);
  console.log('🌐 Откройте в браузере: http://localhost:' + PORT);
  console.log('=================================');
});
