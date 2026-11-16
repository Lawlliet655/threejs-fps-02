// rounds.js — round flow and the economy. A match is first to MATCH_TARGET rounds.
// Each round: buy phase (spend money) -> round (100 s, elimination or timer) ->
// banner -> next buy phase. Money: $300 per round, $300 per kill, $800 per round
// win. Dying drops the player's bought primary weapon.

import { MATCH_TARGET, startBuyPhase, startRound, endRound, endMatch, aliveCount, eliminationWinner, pushEvent } from './state.js';
import { WEAPONS, GRENADE_PRICE, ARMOR_PRICE, AMMO_PRICE, MAX_GRENADES, giveWeapon } from './weapons.js';

/** The buy catalogue the HUD renders: id, key, name, price, description. */
export function buyCatalog(g) {
  const p = g.player;
  return [
    { id: 'smg', key: '1', name: WEAPONS.smg.name, price: WEAPONS.smg.price, desc: 'Fast, close range. 28-round mag, high spread on the move.', owned: !!p.ammo?.smg },
    { id: 'rifle', key: '2', name: WEAPONS.rifle.name, price: WEAPONS.rifle.price, desc: 'Accurate mid-range rifle. 25-round mag, the all-rounder.', owned: !!p.ammo?.rifle },
    { id: 'sniper', key: '3', name: WEAPONS.sniper.name, price: WEAPONS.sniper.price, desc: 'One-shot headshot machine. 5-round mag, slow and loud.', owned: !!p.ammo?.sniper },
    { id: 'armor', key: '4', name: 'Kevlar Armor', price: ARMOR_PRICE, desc: 'Absorbs half of incoming damage until it breaks. 100 points.', owned: p.armor >= 100 },
    { id: 'grenade', key: '5', name: 'Frag Grenade', price: GRENADE_PRICE, desc: 'Throw with G. Explodes after 1.6 s, big area damage.', owned: false, count: p.grenades },
    { id: 'ammo', key: '6', name: 'Ammo Resupply', price: AMMO_PRICE, desc: 'Refill the reserve ammo of your current weapon.', owned: false },
  ];
}

/** Buy an item during the buy phase. Returns true when the purchase went through. */
export function buyItem(g, id) {
  if (g.phase !== 'buy') return false;
  const p = g.player;
  if (id === 'armor') {
    if (p.armor >= 100 || g.money < ARMOR_PRICE) return false;
    g.money -= ARMOR_PRICE;
    p.armor = 100;
  } else if (id === 'grenade') {
    if (p.grenades >= MAX_GRENADES || g.money < GRENADE_PRICE) return false;
    g.money -= GRENADE_PRICE;
    p.grenades += 1;
  } else if (id === 'ammo') {
    const def = WEAPONS[p.weapon];
    if (!p.ammo || p.ammo[p.weapon].reserve >= def.reserve || g.money < AMMO_PRICE) return false;
    g.money -= AMMO_PRICE;
    p.ammo[p.weapon].reserve = def.reserve;
    p.reserve = def.reserve;
  } else if (WEAPONS[id]) {
    const def = WEAPONS[id];
    if (p.ammo?.[id] || g.money < def.price) return false;
    g.money -= def.price;
    giveWeapon(p, id);
  } else {
    return false;
  }
  pushEvent(g, { type: 'buy', item: id });
  return true;
}

/** Equip an owned weapon (1/2/3 keys). */
export function equipOwned(g, slot) {
  const order = ['pistol', 'smg', 'rifle', 'sniper'];
  const id = order[slot];
  if (!id || !g.player.ammo?.[id]) return false;
  if (g.player.weapon === id) return false;
  giveWeapon(g.player, id);
  pushEvent(g, { type: 'switch', fighter: g.player });
  return true;
}

/**
 * One fixed-step tick of the round state machine. Called by main.js after the
 * fighters update. Handles the buy timer, the round timer and round endings.
 */
export function updateRounds(g, dt, spawns) {
  if (g.phase === 'buy') {
    g.buyTimer -= dt;
    if (g.buyTimer <= 0) {
      startRound(g, spawns);
    }
    return;
  }
  if (g.phase === 'round') {
    g.roundTimer -= dt;
    const elim = eliminationWinner(g);
    if (elim) {
      endRound(g, elim);
      return;
    }
    if (g.roundTimer <= 0) {
      // Timer: the team with more players alive wins; a tie replays the round.
      const e = aliveCount(g, 'ember');
      const a = aliveCount(g, 'ash');
      endRound(g, e === a ? null : (e > a ? 'ember' : 'ash'));
    }
    return;
  }
  if (g.phase === 'roundEnd') {
    g.roundEndTimer -= dt;
    if (g.roundEndTimer <= 0) {
      if (g.roundEndWinner && g.score[g.roundEndWinner] >= MATCH_TARGET) {
        endMatch(g, g.roundEndWinner);
      } else {
        startBuyPhase(g);
      }
    }
  }
}
