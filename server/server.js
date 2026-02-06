// Импортируем необходимые модули
const express = require('express');      // Веб-фреймворк
const http = require('http');           // HTTP сервер
const socketIo = require('socket.io');  // WebSocket библиотека
const path = require('path');           // Работа с путями файлов
const CardGame = require('./game');     // Наш класс игры

// Создаем Express приложение
const app = express();
// Создаем HTTP сервер на основе Express
const server = http.createServer(app);
// Инициализируем Socket.io на сервере
const io = socketIo(server);

// Настраиваем раздачу статических файлов из папки client
app.use(express.static(path.join(__dirname, '../client')));

// Менеджер лобби: код лобби -> { game, playerIds }
const lobbies = new Map();
// Сокет -> код лобби (для быстрого поиска)
const socketToLobby = new Map();

/**
 * Генерирует случайный код лобби из 6 букв/цифр
 */
function generateLobbyCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  if (lobbies.has(code)) return generateLobbyCode();
  return code;
}

/**
 * Обрабатываем подключения клиентов через Socket.io
 */
io.on('connection', (socket) => {
  console.log('=== НОВОЕ ПОДКЛЮЧЕНИЕ ===', socket.id);

  /**
   * Создать новое лобби (игрок становится хостом)
   */
  socket.on('createLobby', (playerName) => {
    const name = (playerName || '').trim();
    if (!name) {
      socket.emit('lobbyError', { message: 'Введите имя' });
      return;
    }
    const code = generateLobbyCode();
    const game = new CardGame();
    game.addPlayer(socket.id, name);
    lobbies.set(code, { game, playerIds: [socket.id] });
    socketToLobby.set(socket.id, code);
    socket.join(code);
    socket.emit('lobbyCreated', { code, playerId: socket.id });
    io.to(code).emit('gameStateUpdate', game.getGameState());
    console.log('Лобби создано:', code, 'хост:', name);
  });

  /**
   * Присоединиться к лобби по коду
   */
  socket.on('joinLobby', (data) => {
    const name = (data.playerName || data).trim();
    const code = (data.lobbyCode || data.code || '').toString().toUpperCase().trim();
    if (!name) {
      socket.emit('lobbyError', { message: 'Введите имя' });
      return;
    }
    if (!code || code.length < 4) {
      socket.emit('lobbyError', { message: 'Введите код лобби' });
      return;
    }
    const lobby = lobbies.get(code);
    if (!lobby) {
      socket.emit('lobbyError', { message: 'Лобби с таким кодом не найдено' });
      return;
    }
    if (lobby.playerIds.length >= 2) {
      socket.emit('lobbyError', { message: 'В лобби уже два игрока' });
      return;
    }
    const success = lobby.game.addPlayer(socket.id, name);
    if (!success) {
      socket.emit('lobbyError', { message: 'Не удалось присоединиться' });
      return;
    }
    lobby.playerIds.push(socket.id);
    socketToLobby.set(socket.id, code);
    socket.join(code);
    socket.emit('gameJoined', { playerId: socket.id, lobbyCode: code });
    io.to(code).emit('gameStateUpdate', lobby.game.getGameState());
    console.log('Игрок', name, 'вошёл в лобби', code);
  });

  /**
   * Ход игрока — обрабатываем в контексте лобби
   */
  socket.on('playCard', (data) => {
    const code = socketToLobby.get(socket.id);
    if (!code) {
      socket.emit('moveError', { message: 'Вы не в игре' });
      return;
    }
    const lobby = lobbies.get(code);
    if (!lobby) return;
    const game = lobby.game;
    const { cardIndex, targetCardIndex } = data || {};
    const success = game.playCard(socket.id, cardIndex, targetCardIndex);
    if (success) {
      io.to(code).emit('gameStateUpdate', game.getGameState());
      const player = game.players.find(p => p.id === socket.id);
      if (player && player.cards.length === 0 && game.deck.length === 0) {
        io.to(code).emit('gameFinished', { winner: player.name });
        game.gameState = 'finished';
      }
    } else {
      socket.emit('moveError', { message: 'Невозможно сделать этот ход' });
    }
  });

  /**
   * Взять карты со стола
   */
  socket.on('takeCards', () => {
    const code = socketToLobby.get(socket.id);
    if (!code) return;
    const lobby = lobbies.get(code);
    if (!lobby) return;
    const success = lobby.game.takeCards(socket.id);
    if (success) {
      io.to(code).emit('gameStateUpdate', lobby.game.getGameState());
    } else {
      socket.emit('moveError', { message: 'Невозможно взять карты сейчас' });
    }
  });

  /**
   * Отключение игрока — выходим из лобби, уведомляем второго игрока
   */
  socket.on('disconnect', () => {
    const code = socketToLobby.get(socket.id);
    socketToLobby.delete(socket.id);
    if (!code) return;
    const lobby = lobbies.get(code);
    if (!lobby) return;
    lobby.game.removePlayer(socket.id);
    lobby.playerIds = lobby.playerIds.filter(id => id !== socket.id);
    if (lobby.playerIds.length === 0) {
      lobbies.delete(code);
      console.log('Лобби удалено:', code);
    } else {
      io.to(code).emit('gameStateUpdate', lobby.game.getGameState());
      io.to(code).emit('playerLeft', { message: 'Игрок вышел из игры' });
    }
  });
});

// Запускаем сервер на порту 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('=================================');
  console.log('🚀 СЕРВЕР ЗАПУЩЕН!');
  console.log('📡 Порт:', PORT);
  console.log('🌐 Откройте в браузере: http://localhost:' + PORT);
  console.log('=================================');
});