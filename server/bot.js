/**
 * Простой бот для одиночной игры (лёгкий уровень сложности).
 *
 * Логика:
 *  - В атаке играет самой младшей картой, предпочитая некозырные.
 *  - В защите бьёт самой младшей подходящей картой (тоже предпочитая некозырь).
 *  - Если отбиться нечем — забирает карты со стола.
 *
 * Бот не пытается анализировать руку соперника, не "сохраняет" козыри
 * на потом и не подкидывает излишних карт — этого достаточно для лёгкого
 * уровня и для того, чтобы у нового игрока был реальный шанс выиграть.
 */

const RANKS = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function rankValue(rank) {
  return RANKS.indexOf(rank);
}

/**
 * Возвращает карты руки, отсортированные так, чтобы первой шла
 * самая "дешёвая" для бота карта: сперва некозырные младшие,
 * затем козырные младшие.
 */
function sortHandCheapestFirst(cards, trumpSuit) {
  return cards
    .map((card, originalIndex) => ({ card, originalIndex }))
    .sort((a, b) => {
      const aTrump = a.card.suit === trumpSuit ? 1 : 0;
      const bTrump = b.card.suit === trumpSuit ? 1 : 0;
      if (aTrump !== bTrump) return aTrump - bTrump;
      return rankValue(a.card.rank) - rankValue(b.card.rank);
    });
}

/**
 * Может ли карта `defense` побить карту `attack` по правилам "Дурака".
 */
function canBeat(attack, defense, trumpSuit) {
  if (attack.suit === defense.suit) {
    return rankValue(defense.rank) > rankValue(attack.rank);
  }
  return defense.suit === trumpSuit && attack.suit !== trumpSuit;
}

/**
 * Решает, какое действие совершить боту на основе текущего состояния игры.
 *
 * Возвращает один из вариантов:
 *  - { type: 'attack', cardIndex }
 *  - { type: 'defend', cardIndex, targetCardIndex }
 *  - { type: 'take' }
 *  - { type: 'wait' }   — ходить нечем / не очередь бота
 */
function decideMove(game, botId) {
  const bot = game.players.find(p => p.id === botId);
  if (!bot) return { type: 'wait' };
  if (!game.currentPlayer || game.currentPlayer.id !== botId) {
    return { type: 'wait' };
  }

  const sorted = sortHandCheapestFirst(bot.cards, game.trumpSuit);
  if (sorted.length === 0) return { type: 'wait' };

  if (bot.isAttacker) {
    if (game.table.length === 0) {
      return { type: 'attack', cardIndex: sorted[0].originalIndex };
    }

    const tableRanks = new Set();
    game.table.forEach(t => {
      tableRanks.add(t.card.rank);
      if (t.defendingCard) tableRanks.add(t.defendingCard.rank);
    });

    const matching = sorted.filter(c => tableRanks.has(c.card.rank));
    if (matching.length > 0) {
      return { type: 'attack', cardIndex: matching[0].originalIndex };
    }
    return { type: 'wait' };
  }

  if (bot.isDefender) {
    let targetIndex = -1;
    let targetCard = null;
    for (let i = 0; i < game.table.length; i++) {
      if (!game.table[i].defendingCard) {
        targetIndex = i;
        targetCard = game.table[i].card;
        break;
      }
    }
    if (targetIndex === -1) return { type: 'wait' };

    const beaters = sorted.filter(c => canBeat(targetCard, c.card, game.trumpSuit));
    if (beaters.length > 0) {
      return {
        type: 'defend',
        cardIndex: beaters[0].originalIndex,
        targetCardIndex: targetIndex,
      };
    }
    return { type: 'take' };
  }

  return { type: 'wait' };
}

module.exports = { decideMove };
