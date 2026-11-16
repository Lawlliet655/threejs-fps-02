// hud.js — every DOM element the player sees: health, armor, ammo, money, timer,
// score, kill feed, crosshair, hitmarker, banners and the four menus. The HUD
// only reads state; main.js owns the phase transitions and calls showPhase.

import { buyCatalog } from './rounds.js';
import { WEAPONS } from './weapons.js';
import { MATCH_TARGET } from './state.js';

const $ = (id) => document.getElementById(id);
let feed = [];   // { el, until }
let hitT = 0;
let dmgT = 0;

export function initHud(cb) {
  $('btn-start').addEventListener('click', () => cb.onStart());
  $('btn-start-round').addEventListener('click', () => cb.onStartRound());
  $('btn-resume').addEventListener('click', () => cb.onResume());
  $('btn-restart').addEventListener('click', () => cb.onRestart());
  $('btn-again').addEventListener('click', () => cb.onRestart());
}

function fmtTime(s) {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export function showPhase(g) {
  const phase = g.phase;
  $('menu-title').classList.toggle('hidden', phase !== 'title');
  $('menu-buy').classList.toggle('hidden', phase !== 'buy' || g.paused);
  $('menu-pause').classList.toggle('hidden', !g.paused || phase === 'title' || phase === 'matchEnd');
  $('menu-end').classList.toggle('hidden', phase !== 'matchEnd');
  $('hud').classList.toggle('hidden', phase === 'title' || phase === 'matchEnd');
  if (phase === 'buy') renderBuy(g);
  if (phase === 'matchEnd') renderEnd(g);
}

export function renderBuy(g) {
  $('buy-money').textContent = g.money;
  $('buy-timer').textContent = Math.ceil(g.buyTimer);
  const grid = $('buy-grid');
  grid.innerHTML = '';
  for (const item of buyCatalog(g)) {
    const div = document.createElement('div');
    const owned = item.owned;
    const afford = g.money >= item.price;
    div.className = 'buy-item' + (owned ? ' owned' : '') + (!owned && !afford ? ' cant' : '');
    div.innerHTML = `<span class="bi-key">${item.key}</span><div class="bi-name">${item.name}</div>` +
      `<div class="bi-desc">${item.desc}</div>` +
      `<div class="bi-price">${owned ? 'OWNED' : '$' + item.price}${item.count ? ' · ×' + item.count : ''}</div>`;
    div.addEventListener('click', () => {
      if (window.__emberBuy) window.__emberBuy(item.id);
    });
    grid.appendChild(div);
  }
}

function renderEnd(g) {
  const won = g.matchWinner === 'ember';
  $('end-title').textContent = won ? 'EMBER WINS' : 'ASH WINS';
  $('end-title').style.color = won ? '#ffb347' : '#ff5b5b';
  $('end-sub').textContent = `Final score Ember ${g.score.ember} — ${g.score.ash} Ash · ${g.round} rounds played.`;
  const acc = g.shots > 0 ? Math.round((g.hits / g.shots) * 100) : 0;
  $('end-stats').innerHTML =
    `Kills: <b>${g.kills}</b> · Deaths: <b>${g.deaths}</b> · Headshots: <b>${g.headshots}</b><br>` +
    `Accuracy: <b>${acc}%</b> (${g.hits}/${g.shots} hits) · Money left: <b>$${g.money}</b>`;
}

export function showBanner(text, sub, cls) {
  const b = $('banner');
  b.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
  b.className = cls || '';
  b.classList.remove('hidden');
  setTimeout(() => b.classList.add('hidden'), 2600);
}

export function addKillFeed(killer, victim, weapon, headshot) {
  const el = document.createElement('div');
  el.className = 'kf';
  const wn = weapon === 'grenade' ? 'Grenade' : (WEAPONS[weapon]?.name || weapon);
  el.innerHTML = `<b>${killer}</b> <span class="w">${wn}</span> <b>${victim}</b>${headshot ? ' <span class="hs">HEADSHOT</span>' : ''}`;
  $('killfeed').appendChild(el);
  feed.push({ el, until: performance.now() + 4000 });
  while (feed.length > 5) feed.shift().el.remove();
}

export function showHitmarker(kill) {
  const h = $('hitmarker');
  h.classList.toggle('kill', !!kill);
  h.classList.add('show');
  hitT = 0.12;
}

export function showDamage() {
  $('dmg-vignette').style.opacity = '1';
  dmgT = 0.5;
}

/** Per-frame HUD refresh. Called from main.js every rendered frame. */
export function updateHud(g, dt) {
  const p = g.player;
  $('score-ember').textContent = `EMBER ${g.score.ember}`;
  $('score-ash').textContent = `${g.score.ash} ASH`;
  $('round-label').textContent = g.phase === 'buy' ? `ROUND ${g.round + 1} · BUY` : `ROUND ${g.round}`;
  const timer = g.phase === 'buy' ? g.buyTimer : g.roundTimer;
  const rt = $('round-timer');
  rt.textContent = fmtTime(timer);
  rt.classList.toggle('low', timer <= 15 && g.phase === 'round');

  $('hp-fill').style.width = `${Math.max(0, p.hp)}%`;
  $('hp-num').textContent = Math.max(0, Math.ceil(p.hp));
  $('armor-fill').style.width = `${Math.min(100, p.armor)}%`;
  $('armor-num').textContent = Math.ceil(p.armor);
  const def = WEAPONS[p.weapon];
  $('weapon-name').textContent = def.name;
  const ammoEl = $('ammo');
  $('ammo-mag').textContent = p.reloading > 0 ? '--' : p.mag;
  $('ammo-res').textContent = `/ ${p.reserve}`;
  ammoEl.classList.toggle('low', p.mag <= Math.ceil(def.mag * 0.25) && p.mag > 0);
  $('money').textContent = g.money;
  $('grenades').textContent = `◉ ${p.grenades}`;

  // Crosshair spread follows the player's current spread.
  const spreadPx = window.__emberSpread ? window.__emberSpread() : 0;
  document.documentElement.style.setProperty('--sp', `${spreadPx}px`);

  if (hitT > 0) { hitT -= dt; if (hitT <= 0) $('hitmarker').classList.remove('show'); }
  if (dmgT > 0) {
    dmgT -= dt;
    $('dmg-vignette').style.opacity = String(Math.max(0, dmgT / 0.5));
  }
  const now = performance.now();
  while (feed.length > 0 && feed[0].until < now) feed.shift().el.remove();

  // Context hint.
  let hint = '';
  if (g.phase === 'round' && p.alive) {
    if (p.mag === 0) hint = 'Press R to reload';
    else if (g.input && !g.input.locked) hint = 'Click to lock the mouse and aim';
  } else if (g.phase === 'buy') {
    hint = 'Buy gear, then press Space to start the round';
  }
  $('hint').textContent = hint;

  if (g.phase === 'buy') $('buy-timer').textContent = Math.ceil(g.buyTimer);
}
