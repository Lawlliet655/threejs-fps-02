// state.js — one place holds the whole game state. Every other module reads and
// writes this object; nothing keeps a second copy of a fighter, a score or a timer.
// The simulation (main.js fixed step) mutates it; rendering and the HUD only read it.

export const MATCH_TARGET = 5;      // first team to 5 rounds takes the match
export const ROUND_TIME = 100;      // seconds per round
export const BUY_TIME = 12;         // seconds of buy phase
export const KILL_REWARD = 300;
export const ROUND_REWARD = 300;    // per round played, at round start
export const WIN_REWARD = 800;

/** A fighter: the player or a bot. pos is the feet position on the ground plane. */
export function makeFighter(id, name, team, isPlayer) {
  return {
    id, name, team, isPlayer,
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0, pitch: 0,
    hp: 100, maxHp: 100, armor: 0, alive: true,
    weapon: 'pistol', mag: 12, reserve: 36,
    // Per-weapon ammo records: { mag, reserve, cap }. Every code path that
    // touches ammo (reload, buy, switch, death-drop) reads them, so they must
    // exist from the start — the player starts with the pistol loadout.
    ammo: { pistol: { mag: 12, reserve: 36, cap: 12 } },
    reloading: 0, reloadTotal: 0,
    grenades: 0, fireCooldown: 0, lastShotAt: -99,
    crouched: false, onGround: true,
    // bot brain (unused by the player)
    ai: isPlayer ? null : {
      state: 'advance', lane: 0, wpIndex: 0, wpDir: 1, target: null,
      reaction: 0, strafeDir: 1, strafeT: 0, burstLeft: 0, burstPause: 0,
      holdT: 0, coverWp: -1, coverCooldown: 0, coverT: 0, lastSeenPos: null, stuckT: 0,
    },
    // three.js objects, filled by map.js / effects.js
    mesh: null, headMesh: null, bodyMesh: null, gunMesh: null,
    // per-frame scratch (reused, never re-allocated in the hot loop)
    _eyeY: 1.55,
  };
}

/** The whole game, created once by main.js. */
export function createGame() {
  const g = {
    phase: 'title',            // title | buy | round | roundEnd | matchEnd
    paused: false,
    time: 0,                   // total sim time (s)
    round: 0,
    score: { ember: 0, ash: 0 },
    roundTimer: ROUND_TIME,
    buyTimer: BUY_TIME,
    roundEndTimer: 0,
    roundEndWinner: null,
    matchWinner: null,
    money: 800,
    owned: { pistol: true },   // weapon ids the player owns (pistol always)
    kills: 0, deaths: 0, shots: 0, hits: 0, headshots: 0,
    player: makeFighter('p', 'You', 'ember', true),
    bots: [],
    events: [],                // drained by main.js each frame -> audio / hud / effects
    settings: { muted: false },
    // input state, written by main.js listeners, read by the sim
    input: {
      fwd: 0, strafe: 0, jump: false, crouch: false, steady: false,
      fire: false, reload: false, grenade: false,
      lookDX: 0, lookDY: 0, locked: false,
    },
    // debug / test hooks (URL params, never on by default)
    debug: { freelook: false, autotest: false, demo: null },
    // shared temp objects for the sim (no per-frame allocation in hot loops)
    tmp: { dx: 0, dz: 0, len: 0 },
  };
  return g;
}

export function pushEvent(g, ev) { g.events.push(ev); }

/** Put every fighter back at full health on its spawn point for a new round. */
export function resetFighters(g, spawns) {
  const all = [g.player, ...g.bots];
  const taken = { ember: 0, ash: 0 };
  for (const f of all) {
    const list = spawns[f.team];
    const s = list[taken[f.team] % list.length];
    taken[f.team] += 1;
    f.pos.x = s.x; f.pos.y = 0; f.pos.z = s.z;
    f.vel.x = 0; f.vel.y = 0; f.vel.z = 0;
    f.hp = f.maxHp; f.armor = f.team === 'ember' && f.isPlayer ? f.armor : 0;
    f.alive = true;
    f.yaw = f.team === 'ember' ? -Math.PI / 2 : Math.PI / 2;
    f.pitch = 0;
    f.reloading = 0; f.fireCooldown = 0;
    f.crouched = false;
    // The sidearm is the fallback weapon: the player's pistol reserve is
    // restocked at round start, so the player can always fight. Better guns
    // still need money and their reserves only refill from the buy menu.
    if (f.isPlayer && f.ammo?.pistol) f.ammo.pistol.reserve = 36;
    // Refill the current magazine from reserve at round start.
    const rec = f.ammo?.[f.weapon];
    if (rec) {
      const take = Math.min(rec.cap - rec.mag, rec.reserve);
      rec.mag += take; rec.reserve -= take;
      f.mag = rec.mag; f.reserve = rec.reserve;
    }
    if (f.ai) {
      f.ai.state = 'advance';
      f.ai.wpIndex = 0;
      f.ai.target = null;
      f.ai.reaction = 0;
      f.ai.burstLeft = 0;
      f.ai.burstPause = 0;
      f.ai.holdT = 0;
      f.ai.coverWp = -1;
      f.ai.lastSeenPos = null;
      f.ai.stuckT = 0;
    }
  }
}

/** Start a fresh match: scores, money and weapons reset. */
export function resetMatch(g) {
  g.round = 0;
  g.score.ember = 0; g.score.ash = 0;
  g.money = 800;
  g.owned = { pistol: true };
  g.kills = 0; g.deaths = 0; g.shots = 0; g.hits = 0; g.headshots = 0;
  g.player.weapon = 'pistol';
  // Pistol loadout (matches WEAPONS.pistol: 12-round mag, 36 reserve).
  g.player.ammo = { pistol: { mag: 12, reserve: 36, cap: 12 } };
  g.player.mag = 12;
  g.player.reserve = 36;
  g.player.grenades = 0;
  g.player.armor = 0;
  g.matchWinner = null;
  g.roundEndWinner = null;
  g.phase = 'buy';
  g.buyTimer = BUY_TIME;
  pushEvent(g, { type: 'matchReset' });
}

/** Open the buy phase before a round. */
export function startBuyPhase(g) {
  g.phase = 'buy';
  g.buyTimer = BUY_TIME;
  g.money += ROUND_REWARD;
  pushEvent(g, { type: 'buyPhase' });
}

/** Begin a round: fighters reset, timer set, first round counts the round number. */
export function startRound(g, spawns) {
  g.round += 1;
  g.phase = 'round';
  g.roundTimer = ROUND_TIME;
  resetFighters(g, spawns);
  pushEvent(g, { type: 'roundStart', round: g.round });
}

/** Close a round. winner: 'ember' | 'ash' | null (tie: no point). */
export function endRound(g, winner) {
  g.phase = 'roundEnd';
  g.roundEndTimer = 4;
  g.roundEndWinner = winner;
  if (winner === 'ember') {
    g.score.ember += 1;
    g.money += WIN_REWARD;
  } else if (winner === 'ash') {
    g.score.ash += 1;
  }
  pushEvent(g, { type: 'roundEnd', winner, score: { ...g.score } });
}

/** Close the match once a team reaches MATCH_TARGET. */
export function endMatch(g, winner) {
  g.phase = 'matchEnd';
  g.matchWinner = winner;
  pushEvent(g, { type: 'matchEnd', winner });
}

/** Count the alive fighters of a team. */
export function aliveCount(g, team) {
  let n = 0;
  const all = [g.player, ...g.bots];
  for (const f of all) if (f.team === team && f.alive) n++;
  return n;
}

/** The current round winner by elimination, or null while the round is live. */
export function eliminationWinner(g) {
  const e = aliveCount(g, 'ember');
  const a = aliveCount(g, 'ash');
  if (e === 0 && a === 0) return null;
  if (e === 0) return 'ash';
  if (a === 0) return 'ember';
  return null;
}
