/**
 * Класс CardGameClient - управляет клиентской частью игры
 * Отвечает за отображение интерфейса и взаимодействие с сервером
 */
const SESSION_TOKEN_KEY = 'durak_session_token';

class CardGameClient {
  constructor() {
    // Подключаемся к серверу Socket.io
    this.socket = io();

    // ID текущего игрока (теперь это username)
    this.playerId = null;
    // Имя текущего игрока (равно username после авторизации)
    this.playerName = '';
    // Авторизованы ли мы
    this.authenticated = false;
    // Информация об активной сохранённой игре (если есть)
    this.activeGame = null;
    // Текущее состояние игры
    this.gameState = null;
    // Индекс выбранной карты в руке
    this.selectedCardIndex = null;
    // Индекс выбранной карты на столе для отбития
    this.selectedTargetIndex = null;

    // Настройки звука
    this.volume = 0.7;
    this.sounds = {
      click: this.createAudio('sounds/click.mp3'),
      attack: this.createAudio('sounds/attack.mp3'),
      defend: this.createAudio('sounds/defend.mp3'),
      draw: this.createAudio('sounds/draw.mp3')
    };

    console.log('Клиент игры инициализирован');

    // Инициализируем обработчики событий
    this.initEventListeners();
    this.setupSocketListeners();

    // На каждое подключение (в т.ч. авто-реконнект) пробуем восстановить
    // сессию по сохранённому токену.
    this.socket.on('connect', () => this.tryRestoreSession());
  }

  /**
   * Создает объект Audio с учетом текущей громкости
   */
  createAudio(src) {
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.volume = this.volume;
    return audio;
  }

  /**
   * Воспроизведение звука по ключу
   */
  playSound(name) {
    const sound = this.sounds[name];
    if (!sound) return;

    // Создаем клон, чтобы звуки могли накладываться
    const clone = sound.cloneNode();
    clone.volume = this.volume;
    clone.play().catch(() => {});
  }

  /**
   * Установка громкости (0–1)
   */
  setVolume(value) {
    this.volume = Math.min(1, Math.max(0, value));
  }

  /**
   * Настраивает обработчики событий DOM элементов
   */
  initEventListeners() {
    // Ползунок громкости
    const volumeControl = document.getElementById('volumeControl');
    if (volumeControl) {
      volumeControl.addEventListener('input', (e) => {
        const value = Number(e.target.value) || 0;
        this.setVolume(value / 100);
      });
    }

    // Авторизация
    document.getElementById('tabLogin').addEventListener('click', () => {
      this.playSound('click');
      this.showAuthTab('login');
    });
    document.getElementById('tabRegister').addEventListener('click', () => {
      this.playSound('click');
      this.showAuthTab('register');
    });
    document.getElementById('loginBtn').addEventListener('click', () => {
      this.playSound('click');
      this.doLogin();
    });
    document.getElementById('registerBtn').addEventListener('click', () => {
      this.playSound('click');
      this.doRegister();
    });
    document.getElementById('loginUsername').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.doLogin();
    });
    document.getElementById('loginPassword').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.doLogin();
    });
    document.getElementById('registerUsername').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.doRegister();
    });
    document.getElementById('registerPassword').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.doRegister();
    });

    document.getElementById('logoutBtn').addEventListener('click', () => {
      this.playSound('click');
      this.doLogout();
    });

    document.getElementById('resumeBtn').addEventListener('click', () => {
      this.playSound('click');
      this.socket.emit('resumeGame');
    });
    document.getElementById('abandonBtn').addEventListener('click', () => {
      this.playSound('click');
      if (confirm('Удалить сохранённую игру? Это действие нельзя отменить.')) {
        this.socket.emit('abandonGame');
      }
    });

    // Вкладки: создать / войти в лобби / против бота
    document.getElementById('tabCreate').addEventListener('click', () => {
      this.playSound('click');
      this.showLobbyTab('create');
    });
    document.getElementById('tabJoin').addEventListener('click', () => {
      this.playSound('click');
      this.showLobbyTab('join');
    });
    document.getElementById('tabBot').addEventListener('click', () => {
      this.playSound('click');
      this.showLobbyTab('bot');
    });

    document.getElementById('createLobbyBtn').addEventListener('click', () => {
      this.playSound('click');
      this.createLobby();
    });
    document.getElementById('joinLobbyBtn').addEventListener('click', () => {
      this.playSound('click');
      this.joinLobby();
    });
    document.getElementById('createBotLobbyBtn').addEventListener('click', () => {
      this.playSound('click');
      this.createBotLobby();
    });

    document.getElementById('lobbyCodeInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.joinLobby();
    });

    document.getElementById('takeCardsBtn').addEventListener('click', () => {
      this.playSound('click');
      this.takeCards();
    });
    document.getElementById('endTurnBtn').addEventListener('click', () => {
      this.playSound('click');
      this.endTurn();
    });
  }

  showAuthTab(tab) {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
    document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
    loginForm.classList.toggle('hidden', tab !== 'login');
    registerForm.classList.toggle('hidden', tab !== 'register');
  }

  tryRestoreSession() {
    let token = null;
    try { token = localStorage.getItem(SESSION_TOKEN_KEY); } catch (e) {}
    if (token) {
      this.socket.emit('authByToken', { token });
    }
  }

  doLogin() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!username || !password) {
      alert('Введите логин и пароль');
      return;
    }
    this.socket.emit('login', { username, password });
  }

  doRegister() {
    const username = document.getElementById('registerUsername').value.trim();
    const password = document.getElementById('registerPassword').value;
    if (!username || !password) {
      alert('Введите логин и пароль');
      return;
    }
    this.socket.emit('register', { username, password });
  }

  doLogout() {
    let token = null;
    try {
      token = localStorage.getItem(SESSION_TOKEN_KEY);
      localStorage.removeItem(SESSION_TOKEN_KEY);
    } catch (e) {}
    this.socket.emit('logout', { token });
    this.authenticated = false;
    this.playerId = null;
    this.playerName = '';
    this.activeGame = null;
    // Возвращаемся к экрану авторизации
    document.getElementById('authBlock').classList.remove('hidden');
    document.getElementById('lobbyChoice').classList.add('hidden');
    document.getElementById('lobbyWaiting').classList.add('hidden');
    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('mainInstructions').classList.remove('hidden');
  }

  onAuthSuccess(data) {
    const wasInGame = this.authenticated && this.gameState && !document.getElementById('gameScreen').classList.contains('hidden');

    this.authenticated = true;
    this.playerId = data.username;
    this.playerName = data.username;
    this.activeGame = data.activeGame || null;
    try { localStorage.setItem(SESSION_TOKEN_KEY, data.token); } catch (e) {}

    document.getElementById('currentUsername').textContent = data.username;
    document.getElementById('authBlock').classList.add('hidden');
    document.getElementById('lobbyChoice').classList.remove('hidden');

    const resumePanel = document.getElementById('resumePanel');
    if (this.activeGame && this.activeGame.code) {
      document.getElementById('resumeCode').textContent = this.activeGame.code;
      resumePanel.classList.remove('hidden');
    } else {
      resumePanel.classList.add('hidden');
    }

    // Если это был авто-реконнект во время активной игры — сразу обратно
    if (wasInGame && this.activeGame && this.activeGame.code) {
      this.socket.emit('resumeGame');
    }
  }

  showLobbyTab(tab) {
    const createBlock = document.getElementById('createLobbyBlock');
    const joinBlock = document.getElementById('joinLobbyBlock');
    const botBlock = document.getElementById('botLobbyBlock');
    document.querySelectorAll('.lobby-tab').forEach(t => t.classList.remove('active'));
    createBlock.classList.add('hidden');
    joinBlock.classList.add('hidden');
    botBlock.classList.add('hidden');
    if (tab === 'create') {
      createBlock.classList.remove('hidden');
      document.getElementById('tabCreate').classList.add('active');
    } else if (tab === 'join') {
      joinBlock.classList.remove('hidden');
      document.getElementById('tabJoin').classList.add('active');
    } else {
      botBlock.classList.remove('hidden');
      document.getElementById('tabBot').classList.add('active');
    }
  }

  /**
   * Настраивает обработчики событий Socket.io
   */
  setupSocketListeners() {
    this.socket.on('authSuccess', (data) => {
      console.log('Авторизация успешна:', data);
      this.onAuthSuccess(data);
    });

    this.socket.on('authError', (data) => {
      console.log('Ошибка авторизации:', data);
      // Сессия могла истечь — чистим токен
      try { localStorage.removeItem(SESSION_TOKEN_KEY); } catch (e) {}
      if (this.authenticated) {
        this.authenticated = false;
        this.doLogout();
      }
      alert(data.message || 'Ошибка авторизации');
    });

    this.socket.on('gameAbandoned', (data) => {
      console.log('Игра удалена:', data);
      this.activeGame = null;
      document.getElementById('resumePanel').classList.add('hidden');
      this.showHint('Сохранение удалено');
    });

    this.socket.on('lobbyCreated', (data) => {
      console.log('Лобби создано:', data);
      this.playerId = data.playerId;
      document.getElementById('lobbyChoice').classList.add('hidden');
      document.getElementById('mainInstructions').classList.add('hidden');
      if (data.vsBot) {
        // Одиночная игра: игра уже идёт, ждать никого не нужно
        this.showHint('Игра против бота началась. Удачи!');
      } else {
        document.getElementById('lobbyCodeDisplay').textContent = data.code;
        document.getElementById('lobbyWaiting').classList.remove('hidden');
        document.querySelector('#lobbyWaiting .lobby-code-box').classList.remove('hidden');
        document.querySelector('#lobbyWaiting .message p').textContent = 'Ожидание второго игрока...';
        this.showHint('Передайте код второго игрока. Ожидание...');
      }
    });

    this.socket.on('lobbyError', (data) => {
      console.log('Ошибка лобби:', data);
      alert(data.message || 'Ошибка');
    });

    this.socket.on('gameJoined', (data) => {
      console.log('Присоединились к лобби:', data);
      this.playerId = data.playerId;
      document.getElementById('lobbyChoice').classList.add('hidden');
      document.getElementById('mainInstructions').classList.add('hidden');
      document.getElementById('lobbyWaiting').classList.remove('hidden');
      document.querySelector('#lobbyWaiting .lobby-code-box').classList.add('hidden');
      document.querySelector('#lobbyWaiting .message p').textContent =
        data.resumed ? 'Восстановление игры...' : 'Ожидание начала игры...';
      this.showHint(
        data.resumed
          ? 'Возвращаемся к сохранённой игре...'
          : 'Вы в лобби. Игра начнётся, когда оба игрока на месте.'
      );
    });

    /**
     * Обработчик обновления состояния игры
     * Сервер присылает это сообщение при любых изменениях в игре
     */
    this.socket.on('gameStateUpdate', (gameState) => {
      console.log('Получено обновление состояния игры:', gameState);
      this.gameState = gameState;
      this.updateGameUI();
    });

    /**
     * Обработчик окончания игры
     */
    this.socket.on('gameFinished', (data) => {
      console.log('Игра окончена! Победитель:', data.winner);
      this.showMessage(`🎉 Игра окончена! Победитель: ${data.winner}`);
      this.activeGame = null;

      // Возвращаемся к лобби через 5 секунд (без logout)
      setTimeout(() => {
        document.getElementById('gameScreen').classList.add('hidden');
        document.getElementById('lobbyWaiting').classList.add('hidden');
        document.getElementById('loginScreen').classList.remove('hidden');
        document.getElementById('mainInstructions').classList.remove('hidden');
        document.getElementById('lobbyChoice').classList.remove('hidden');
        document.getElementById('resumePanel').classList.add('hidden');
        this.gameState = null;
      }, 5000);
    });

    /**
     * Обработчик ошибок хода
     */
    this.socket.on('moveError', (data) => {
      console.log('Ошибка хода:', data);
      this.showHint(data.message);
    });

    this.socket.on('playerLeft', (data) => {
      this.showMessage(data.message || 'Игрок вышел. Перезагрузите страницу для новой игры.');
    });

    this.socket.on('connect_error', (error) => {
      console.error('Ошибка подключения к серверу:', error);
      this.showHint('Ошибка подключения к серверу');
    });
  }

  /**
   * Создать новое лобби
   */
  createLobby() {
    if (!this.authenticated) {
      alert('Сначала войдите в аккаунт');
      return;
    }
    this.socket.emit('createLobby');
  }

  /**
   * Создать одиночную игру против бота
   */
  createBotLobby() {
    if (!this.authenticated) {
      alert('Сначала войдите в аккаунт');
      return;
    }
    this.socket.emit('createBotLobby');
  }

  /**
   * Войти в лобби по коду
   */
  joinLobby() {
    if (!this.authenticated) {
      alert('Сначала войдите в аккаунт');
      return;
    }
    const code = document.getElementById('lobbyCodeInput').value.trim().toUpperCase();
    if (!code) {
      alert('Введите код лобби');
      document.getElementById('lobbyCodeInput').focus();
      return;
    }
    this.socket.emit('joinLobby', { lobbyCode: code });
  }

  /**
   * Отправляет ход игрока на сервер
   * @param {number} cardIndex - индекс карты в руке
   * @param {number} targetCardIndex - индекс цели на столе (для защиты)
   */
  playCard(cardIndex, targetCardIndex = null) {
    console.log('Отправка хода на сервер:', { cardIndex, targetCardIndex });
    this.socket.emit('playCard', { cardIndex, targetCardIndex });
  }

  /**
   * Отправляет запрос на взятие карт со стола
   */
  takeCards() {
    console.log('Запрос на взятие карт');
    this.socket.emit('takeCards');
  }

  /**
   * Отправляет запрос на завершение хода (бито)
   */
  endTurn() {
    console.log('Запрос "Бито"');
    // В текущей реализации сервер сам определяет когда раунд завершен
    // Эта кнопка может быть использована для дополнительных действий
  }

  /**
   * Основной метод обновления пользовательского интерфейса
   * Перерисовывает весь интерфейс согласно текущему состоянию игры
   */
  updateGameUI() {
    if (!this.gameState) {
      console.log('Нет состояния игры для обновления UI');
      return;
    }

    console.log('Обновление UI, состояние игры:', this.gameState.gameState);

    // Если игра началась - показываем игровой экран
    if (this.gameState.gameState === 'playing') {
      document.getElementById('loginScreen').classList.add('hidden');
      document.getElementById('gameScreen').classList.remove('hidden');
      console.log('Переключение на игровой экран');
    }

    // Обновляем все компоненты интерфейса
    this.updatePlayersInfo();
    this.updateTable();
    this.updatePlayerCards();
    this.updateActionButtons();
    this.updateGameInfo();
  }

  /**
   * Обновляет информацию об игроках (имена, роли)
   */
  updatePlayersInfo() {
    const player = this.gameState.players.find(p => p.id === this.playerId);
    const opponent = this.gameState.players.find(p => p.id !== this.playerId);
    
    // Обновляем информацию о текущем игроке
    if (player) {
      document.getElementById('playerNameDisplay').textContent = this.playerName;
      
      // Показываем роль игрока
      const roleElement = document.getElementById('playerRole');
      if (player.isAttacker) {
        roleElement.textContent = '🎯 Атакующий';
        roleElement.style.background = '#e74c3c';
      } else if (player.isDefender) {
        roleElement.textContent = '🛡️ Защищающийся';
        roleElement.style.background = '#3498db';
      } else {
        roleElement.textContent = '';
      }
    }
    
    // Обновляем информацию о противнике
    if (opponent) {
      document.getElementById('opponentName').textContent = opponent.name;
      this.updateOpponentCards(opponent.cardsCount);
    } else {
      document.getElementById('opponentName').textContent = 'Ожидание...';
      this.updateOpponentCards(0);
    }
  }

  /**
   * Обновляет отображение карт противника (показывает только рубашки)
   * @param {number} count - количество карт у противника
   */
  updateOpponentCards(count) {
    const opponentCardsContainer = document.getElementById('opponentCards');
    opponentCardsContainer.innerHTML = '';
    
    // Создаем элементы-рубашки для каждой карты противника
    for (let i = 0; i < count; i++) {
      const cardElement = document.createElement('div');
      cardElement.className = 'card opponent-card';
      cardElement.innerHTML = `
        <div class="card-value">?</div>
        <div class="card-suit">?</div>
      `;
      opponentCardsContainer.appendChild(cardElement);
    }
  }

  /**
   * Обновляет отображение карт текущего игрока
   * Показывает реальные карты и делает их интерактивными
   */
  updatePlayerCards() {
    const previousCount = this._lastPlayerCardsCount ?? 0;

    const playerCardsContainer = document.getElementById('playerCards');
    playerCardsContainer.innerHTML = '';
    
    const player = this.gameState.players.find(p => p.id === this.playerId);
    
    if (!player || !player.cards) {
      console.log('Нет карт для отображения');
      return;
    }
    
    console.log('Отображение карт игрока:', player.cards);

    // Если карт стало больше, чем в прошлый раз — проигрываем звук взятия
    if (player.cards.length > previousCount) {
      this.playSound('draw');
    }

    this._lastPlayerCardsCount = player.cards.length;
    
    // Создаем элементы для каждой карты в руке
    player.cards.forEach((card, index) => {
      const cardElement = document.createElement('div');
      cardElement.className = `card ${this.getCardColor(card.suit)}`;
      cardElement.innerHTML = `
        <div class="card-value">${card.rank}</div>
        <div class="card-suit">${this.getSuitSymbol(card.suit)}</div>
      `;
      
      // Если сейчас ход игрока - делаем карту кликабельной
      const isMyTurn = this.gameState.currentPlayer === this.playerId;
      if (isMyTurn) {
        cardElement.style.cursor = 'pointer';
        cardElement.title = 'Нажмите чтобы сыграть этой картой';
        
        // Навешиваем обработчик клика
        cardElement.addEventListener('click', () => this.handleCardClick(index));
      } else {
        cardElement.style.cursor = 'not-allowed';
        cardElement.title = 'Сейчас не ваш ход';
      }
      
      playerCardsContainer.appendChild(cardElement);
    });
  }

  /**
   * Обновляет отображение карт на игровом столе
   * Показывает пары "атака-защита"
   */
  updateTable() {
    const tableContainer = document.getElementById('tableCards');
    tableContainer.innerHTML = '';
    
    const player = this.gameState.players.find(p => p.id === this.playerId);
    const isMyTurn = this.gameState.currentPlayer === this.playerId;
    const isDefender = player && player.isDefender;
    
    console.log('Обновление стола, карт на столе:', this.gameState.table.length);
    
    // Проходим по всем картам на столе
    this.gameState.table.forEach((tableCard, index) => {
      // Создаем контейнер для пары карт
      const pairElement = document.createElement('div');
      pairElement.className = 'attack-defense-pair';
      
      // Создаем элемент атакующей карты
      const attackCard = document.createElement('div');
      attackCard.className = `card attack-card ${this.getCardColor(tableCard.card.suit)}`;
      attackCard.innerHTML = `
        <div class="card-value">${tableCard.card.rank}</div>
        <div class="card-suit">${this.getSuitSymbol(tableCard.card.suit)}</div>
      `;
      
      // Если игрок защищается, его ход и карта еще не отбита
      if (isMyTurn && isDefender && !tableCard.defendingCard) {
        attackCard.classList.add('beatable');
        attackCard.style.cursor = 'pointer';
        attackCard.title = 'Нажмите чтобы выбрать для отбития';
        
        // Обработчик для выбора цели отбития
        attackCard.addEventListener('click', () => this.handleTargetClick(index));
      } else if (!tableCard.defendingCard) {
        attackCard.title = 'Ожидание отбития';
      }
      
      pairElement.appendChild(attackCard);
      
      // Если карта отбита - показываем защитную карту
      if (tableCard.defendingCard) {
        const defenseCard = document.createElement('div');
        defenseCard.className = `card defense-card ${this.getCardColor(tableCard.defendingCard.suit)} card-play-animation`;
        defenseCard.innerHTML = `
          <div class="card-value">${tableCard.defendingCard.rank}</div>
          <div class="card-suit">${this.getSuitSymbol(tableCard.defendingCard.suit)}</div>
        `;
        defenseCard.title = 'Отбито';
        pairElement.appendChild(defenseCard);
      }
      
      tableContainer.appendChild(pairElement);
    });
    
    // Показываем подсказки для игрока
    this.showGameHints();
  }

  /**
   * Показывает подсказки для игрока в зависимости от ситуации
   */
  showGameHints() {
    const player = this.gameState.players.find(p => p.id === this.playerId);
    const isMyTurn = this.gameState.currentPlayer === this.playerId;
    
    if (!isMyTurn) return;
    
    if (player.isAttacker) {
      // Подсказка для атакующего
      if (this.gameState.table.length === 0) {
        this.showHint('Ваш ход! Выберите карту для атаки');
      } else {
        this.showHint('Вы можете добавить карту того же достоинства или передать ход');
      }
    } else if (player.isDefender) {
      // Подсказка для защищающегося
      const hasUnbeatenCards = this.gameState.table.some(t => !t.defendingCard);
      
      if (hasUnbeatenCards && this.selectedTargetIndex === null) {
        this.showHint('Сначала выберите карту на столе для отбития');
      } else if (hasUnbeatenCards && this.selectedTargetIndex !== null) {
        this.showHint('Теперь выберите свою карту для отбития');
      } else {
        this.showHint('Все карты отбиты! Раунд завершен');
      }
    }
  }

  /**
   * Обновляет состояние кнопок действий
   */
  updateActionButtons() {
    const takeCardsBtn = document.getElementById('takeCardsBtn');
    const endTurnBtn = document.getElementById('endTurnBtn');
    
    const player = this.gameState.players.find(p => p.id === this.playerId);
    const isMyTurn = this.gameState.currentPlayer === this.playerId;
    
    // Кнопка "Взять карты"
    // Показываем её защищающемуся, если на столе есть карты
    // (даже если сервер потом отклонит невозможный момент, игрок всегда видит кнопку)
    const hasCardsOnTable = this.gameState.table && this.gameState.table.length > 0;
    if (player && player.isDefender && hasCardsOnTable) {
      takeCardsBtn.classList.remove('hidden');
    } else {
      takeCardsBtn.classList.add('hidden');
    }
    
    // Кнопка "Бито" показывается когда все карты отбиты
    const allCardsBeaten = this.gameState.table.length > 0 && 
                          this.gameState.table.every(t => t.defendingCard);
    
    if (isMyTurn && player && player.isAttacker && allCardsBeaten) {
      endTurnBtn.classList.remove('hidden');
    } else {
      endTurnBtn.classList.add('hidden');
    }
  }

  /**
   * Обновляет общую информацию об игре
   */
  updateGameInfo() {
    // Отображаем козырную масть
    const trumpElement = document.getElementById('trumpSuit');
    trumpElement.textContent = this.getSuitSymbol(this.gameState.trumpSuit);
    trumpElement.className = `trump ${this.getCardColor(this.gameState.trumpSuit)}`;
    
    // Отображаем количество карт в колоде
    document.getElementById('deckCount').textContent = this.gameState.deckCount;
    
    // Отображаем текущего игрока
    const currentPlayer = this.gameState.players.find(p => p.id === this.gameState.currentPlayer);
    if (currentPlayer) {
      document.getElementById('currentPlayer').textContent = currentPlayer.name;
    }
  }

  /**
   * Обрабатывает клик по карте в руке игрока
   * @param {number} cardIndex - индекс карты
   */
  handleCardClick(cardIndex) {
    console.log('Клик по карте в руке:', cardIndex);
    
    const player = this.gameState.players.find(p => p.id === this.playerId);
    
    if (player.isAttacker) {
      // АТАКА: сразу играем выбранной картой
      console.log('Атака картой:', cardIndex);
      this.playSound('attack');
      this.playCard(cardIndex);
      
    } else if (player.isDefender) {
      // ЗАЩИТА: нужна предварительно выбранная цель на столе
      if (this.selectedTargetIndex !== null) {
        console.log('Защита: карта', cardIndex, 'против цели', this.selectedTargetIndex);
        this.playSound('defend');
        this.playCard(cardIndex, this.selectedTargetIndex);
        
        // Сбрасываем выбор
        this.selectedTargetIndex = null;
        this.clearSelections();
      } else {
        console.log('Для защиты сначала выберите карту на столе');
        this.showHint('Сначала выберите карту на столе для отбития!');
      }
    }
  }

  /**
   * Обрабатывает клик по карте на столе (для выбора цели отбития)
   * @param {number} targetIndex - индекс карты на столе
   */
  handleTargetClick(targetIndex) {
    console.log('Выбор цели для отбития:', targetIndex);
    
    // Сохраняем выбранную цель
    this.selectedTargetIndex = targetIndex;
    
    // Очищаем предыдущие выделения
    this.clearSelections();
    
    // Подсвечиваем выбранную цель
    const tableCards = document.querySelectorAll('.attack-card');
    if (tableCards[targetIndex]) {
      tableCards[targetIndex].classList.add('selected');
      console.log('Цель выделена');
      
      this.showHint('Теперь выберите свою карту для отбития');
    }
  }

  /**
   * Очищает все выделения карт
   */
  clearSelections() {
    document.querySelectorAll('.card.selected').forEach(card => {
      card.classList.remove('selected');
    });
  }

  /**
   * Определяет цвет карты по масти
   * @param {string} suit - масть карты
   * @returns {string} - 'red' или 'black'
   */
  getCardColor(suit) {
    return (suit === 'hearts' || suit === 'diamonds') ? 'red' : 'black';
  }

  /**
   * Возвращает символ масти для отображения
   * @param {string} suit - масть карты
   * @returns {string} - символ масти
   */
  getSuitSymbol(suit) {
    switch(suit) {
      case 'hearts': return '♥';
      case 'diamonds': return '♦';
      case 'clubs': return '♣';
      case 'spades': return '♠';
      default: return '?';
    }
  }

  /**
   * Показывает системное сообщение (победа, ошибка)
   * @param {string} message - текст сообщения
   */
  showMessage(message) {
    const messagesContainer = document.getElementById('gameMessages');
    messagesContainer.innerHTML = `<p>${message}</p>`;
    messagesContainer.classList.remove('hidden');
    
    // Автоматически скрываем через 5 секунд
    setTimeout(() => {
      messagesContainer.classList.add('hidden');
    }, 5000);
  }

  /**
   * Показывает временную подсказку для игрока
   * @param {string} message - текст подсказки
   */
  showHint(message) {
    // Удаляем старую подсказку если есть
    const oldHint = document.querySelector('.hint-message');
    if (oldHint) oldHint.remove();
    
    // Создаем новую подсказку
    const hint = document.createElement('div');
    hint.className = 'hint-message';
    hint.textContent = message;
    document.body.appendChild(hint);
    
    // Автоматически удаляем через 4 секунды
    setTimeout(() => {
      if (hint.parentNode) {
        hint.parentNode.removeChild(hint);
      }
    }, 4000);
  }
}

// Запускаем клиент когда страница полностью загружена
document.addEventListener('DOMContentLoaded', () => {
  console.log('Документ загружен, инициализация игры...');
  new CardGameClient();
});