/**
 * Класс CardGame - управляет всей игровой логикой на сервере
 * Создает колоду, управляет игроками, проверяет ходы
 */
class CardGame {
  constructor() {
    this.players = [];      // Массив игроков
    this.deck = [];         // Колода карт
    this.table = [];        // Карты на столе
    this.currentPlayer = null; // Чей сейчас ход
    this.attacker = null;   // Игрок который атакует
    this.defender = null;   // Игрок который защищается
    this.trumpSuit = null;  // Козырная масть
    this.gameState = 'waiting'; // Состояние игры: waiting, playing, finished
    
    this.initDeck(); // Создаем и перемешиваем колоду
  }

  /**
   * Создает колоду из 36 карт (4 масти × 9 достоинств)
   * И определяет козырную масть
   */
  initDeck() {
    const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
    const ranks = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    
    this.deck = [];
    
    for (let suit of suits) {
      for (let rank of ranks) {
        this.deck.push({ suit, rank });
      }
    }
    
    this.shuffleDeck();
    this.trumpSuit = this.deck[0].suit;
    
    console.log('Колода создана. Козырь:', this.trumpSuit);
  }

  /**
   * Перемешивает колоду случайным образом
   */
  shuffleDeck() {
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  /**
   * Добавляет нового игрока в игру
   */
  addPlayer(playerId, playerName) {
    if (this.players.length >= 2) {
      console.log('Игра уже заполнена, игрок', playerName, 'не может присоединиться');
      return false;
    }
    
    const player = {
      id: playerId,
      name: playerName,
      cards: [],
      isAttacker: false,
      isDefender: false
    };
    
    this.players.push(player);
    console.log('Игрок добавлен:', playerName, 'ID:', playerId);
    
    if (this.players.length === 2) {
      console.log('Два игрока подключены, начинаем игру!');
      this.startGame();
    }
    
    return true;
  }

  /**
   * Удаляет игрока при отключении
   */
  removePlayer(playerId) {
    this.players = this.players.filter(p => p.id !== playerId);
    console.log('Игрок отключен, ID:', playerId);
    
    if (this.players.length < 2) {
      this.gameState = 'waiting';
      console.log('Игра переведена в режим ожидания');
    }
  }

  /**
   * Начинает игру после подключения второго игрока
   */
  startGame() {
    this.gameState = 'playing';
    console.log('=== НАЧАЛО ИГРЫ ===');
    
    // Раздаем по 6 карт каждому игроку
    this.players.forEach(player => {
      this.dealCards(player, 6);
      console.log('Игроку', player.name, 'раздано', player.cards.length, 'карт');
    });
    
    // Назначаем роли
    this.attacker = this.players[0];
    this.defender = this.players[1];
    this.attacker.isAttacker = true;
    this.defender.isDefender = true;
    this.currentPlayer = this.attacker;
    
    console.log('Атакующий:', this.attacker.name);
    console.log('Защищающийся:', this.defender.name);
    console.log('Первым ходит:', this.currentPlayer.name);
  }

  /**
   * Раздает карты игроку из колоды
   */
  dealCards(player, count) {
    while (player.cards.length < count && this.deck.length > 0) {
      player.cards.push(this.deck.pop());
    }
  }

  /**
   * Обрабатывает ход игрока (атака или защита)
   */
  playCard(playerId, cardIndex, targetCardIndex = null) {
    console.log('=== ОБРАБОТКА ХОДА ===');
    
    const player = this.players.find(p => p.id === playerId);
    if (!player) {
      console.log('Ошибка: игрок не найден');
      return false;
    }
    
    if (this.currentPlayer.id !== playerId) {
      console.log('Ошибка: не ход игрока', player.name);
      return false;
    }
    
    if (cardIndex < 0 || cardIndex >= player.cards.length) {
      console.log('Ошибка: неверный индекс карты');
      return false;
    }
    
    const card = player.cards[cardIndex];
    console.log('Игрок', player.name, 'играет картой:', card.rank, card.suit);
    
    // ЛОГИКА АТАКИ
    if (player.isAttacker) {
      console.log('Режим: АТАКА');
      
      if (this.table.length === 0) {
        console.log('Первая атака в раунде');
        this.table.push({ 
          card: card, 
          playerId: playerId, 
          defendingCard: null, 
          defenderId: null 
        });
        
        player.cards.splice(cardIndex, 1);
        this.currentPlayer = this.defender;
        console.log('Ход передан защищающемуся:', this.defender.name);
        
        return true;
      }
      else if (this.table.length < 6) {
        console.log('Дополнительная атака');
        
        const tableRanks = this.table.map(t => t.card.rank);
        console.log('Достоинства на столе:', tableRanks);
        
        if (tableRanks.includes(card.rank)) {
          console.log('Достоинство совпадает, атака возможна');
          this.table.push({ 
            card: card, 
            playerId: playerId, 
            defendingCard: null, 
            defenderId: null 
          });
          
          player.cards.splice(cardIndex, 1);
          this.currentPlayer = this.defender;
          console.log('Ход передан защищающемуся');
          
          return true;
        } else {
          console.log('Ошибка: достоинство карты не совпадает с картами на столе');
          return false;
        }
      } else {
        console.log('Ошибка: на столе уже максимальное количество карт (6)');
        return false;
      }
    }
    
    // ЛОГИКА ЗАЩИТЫ
    if (player.isDefender) {
      console.log('Режим: ЗАЩИТА');
      
      if (targetCardIndex === null) {
        console.log('Ошибка: для защиты нужно указать targetCardIndex');
        return false;
      }
      
      if (targetCardIndex < 0 || targetCardIndex >= this.table.length) {
        console.log('Ошибка: неверный индекс целевой карты');
        return false;
      }
      
      const targetCard = this.table[targetCardIndex];
      
      if (targetCard.defendingCard) {
        console.log('Ошибка: эта карта уже отбита');
        return false;
      }
      
      console.log('Отбиваем карту:', targetCard.card.rank, targetCard.card.suit);
      console.log('Защищаемся картой:', card.rank, card.suit);
      
      if (this.canBeat(targetCard.card, card)) {
        console.log('УСПЕШНАЯ ЗАЩИТА!');
        
        targetCard.defendingCard = card;
        targetCard.defenderId = playerId;
        player.cards.splice(cardIndex, 1);
        
        const allCardsBeaten = this.table.every(t => t.defendingCard);
        console.log('Все карты отбиты?', allCardsBeaten);
        
        if (allCardsBeaten) {
          console.log('РАУНД ЗАВЕРШЕН - ВСЕ КАРТЫ ОТБИТЫ');
          this.table = [];
          this.switchRoles();
          this.currentPlayer = this.attacker;
          
          this.players.forEach(p => this.dealCards(p, 6));
          console.log('Новый атакующий:', this.attacker.name);
        } else {
          console.log('Не все карты отбиты, ход возвращается атакующему');
          this.currentPlayer = this.attacker;
        }
        
        return true;
      } else {
        console.log('Ошибка: нельзя отбить эту карту');
        return false;
      }
    }
    
    console.log('Ход не обработан');
    return false;
  }

  /**
   * Проверяет может ли одна карта побить другую по правилам игры
   */
  canBeat(attackCard, defenseCard) {
    console.log('Проверка отбития:');
    console.log('Атака:', attackCard.rank, attackCard.suit);
    console.log('Защита:', defenseCard.rank, defenseCard.suit);
    console.log('Козырь:', this.trumpSuit);
    
    if (attackCard.suit === defenseCard.suit) {
      const ranks = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
      const attackRankIndex = ranks.indexOf(attackCard.rank);
      const defenseRankIndex = ranks.indexOf(defenseCard.rank);
      
      const canBeat = defenseRankIndex > attackRankIndex;
      console.log('Одинаковые масти, можно отбить?', canBeat);
      return canBeat;
    }
    
    if (defenseCard.suit === this.trumpSuit && attackCard.suit !== this.trumpSuit) {
      console.log('Защитная карта - козырь, можно отбить');
      return true;
    }
    
    console.log('Нельзя отбить');
    return false;
  }

  /**
   * Игрок забирает все карты со стола (не может отбиться)
   */
  takeCards(playerId) {
    console.log('=== ВЗЯТИЕ КАРТ ===');
    
    const player = this.players.find(p => p.id === playerId);
    if (!player) {
      console.log('Ошибка: игрок не найден');
      return false;
    }
    
    if (!player.isDefender || this.currentPlayer.id !== playerId) {
      console.log('Ошибка: игрок не может взять карты сейчас');
      return false;
    }
    
    console.log('Игрок', player.name, 'забирает карты со стола');
    
    // Забираем все карты со стола
    this.table.forEach(tableCard => {
      player.cards.push(tableCard.card);
      if (tableCard.defendingCard) {
        player.cards.push(tableCard.defendingCard);
      }
    });
    
    this.table = [];
    
    // ВАЖНО: После взятия карт ход переходит к ПРОТИВНИКУ
    const opponent = this.players.find(p => p.id !== playerId);
    
    if (opponent) {
      this.currentPlayer = opponent;
      console.log('Ход перешел к противнику:', opponent.name);
    } else {
      console.log('Ошибка: противник не найден');
    }
    
    // Добираем карты игрокам
    this.players.forEach(p => this.dealCards(p, 6));
    
    console.log('Игрок взял карты. Теперь ходит:', this.currentPlayer.name);
    
    return true;
  }

  /**
   * Меняет роли атакующего и защищающегося местами
   */
  switchRoles() {
    console.log('=== СМЕНА РОЛЕЙ ===');
    
    const oldAttacker = this.attacker ? this.attacker.name : 'none';
    const oldDefender = this.defender ? this.defender.name : 'none';
    
    [this.attacker, this.defender] = [this.defender, this.attacker];
    
    this.players.forEach(p => {
      p.isAttacker = (p.id === this.attacker.id);
      p.isDefender = (p.id === this.defender.id);
    });
    
    console.log('Роли поменялись:');
    console.log('Было - Атакующий:', oldAttacker, 'Защищающийся:', oldDefender);
    console.log('Стало - Атакующий:', this.attacker.name, 'Защищающийся:', this.defender.name);
  }

  /**
   * Возвращает текущее состояние игры для отправки клиентам
   */
  getGameState() {
    const state = {
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        cards: p.cards,
        cardsCount: p.cards.length,
        isAttacker: p.isAttacker,
        isDefender: p.isDefender
      })),
      table: this.table,
      trumpSuit: this.trumpSuit,
      deckCount: this.deck.length,
      currentPlayer: this.currentPlayer ? this.currentPlayer.id : null,
      gameState: this.gameState
    };
    
    console.log('Текущее состояние игры:', state);
    return state;
  }
}

module.exports = CardGame;