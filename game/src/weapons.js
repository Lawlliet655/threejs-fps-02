// weapons.js — weapon definitions, hitscan shooting, damage, reload and grenades.
// Shooting is a ray: map boxes first, then fighter hit volumes (head sphere = 2x
// damage, body capsule = 1x). Armor absorbs half of incoming damage.

import { rayBox, losClear } from './map.js';
import { KILL_REWARD, pushEvent } from './state.js';

export const WEAPONS = {
  pistol: { name: 'P210 Sidearm', price: 0, damage: 26, headMul: 2, rate: 0.22, mag: 12, reserve: 36, spread: 0.011, moveSpread: 0.020, recoil: 0.30, auto: false, range: 60, kick: 0.010, sound: 'pistol' },
  smg: { name: 'Spark SMG', price: 900, damage: 19, headMul: 2, rate: 0.09, mag: 28, reserve: 84, spread: 0.016, moveSpread: 0.030, recoil: 0.18, auto: true, range: 45, kick: 0.007, sound: 'smg' },
  rifle: { name: 'Ember Rifle', price: 2100, damage: 34, headMul: 2, rate: 0.13, mag: 25, reserve: 75, spread: 0.006, moveSpread: 0.018, recoil: 0.45, auto: true, range: 80, kick: 0.014, sound: 'rifle' },
  sniper: { name: 'Longshot', price: 3800, damage: 95, headMul: 2, rate: 1.10, mag: 5, reserve: 15, spread: 0.001, moveSpread: 0.020, recoil: 2.00, auto: false, range: 120, kick: 0.05, sound: 'sniper' },
};
export const GRENADE_PRICE = 300;
export const ARMOR_PRICE = 650;
export const AMMO_PRICE = 200;
export const MAX_GRENADES = 2;

/** Give a fighter a weapon with a full loadout (used on buy and on round start). */
export function giveWeapon(f, id) {
  const def = WEAPONS[id];
  if (!f.ammo) f.ammo = {};
  if (!f.ammo[id]) f.ammo[id] = { mag: def.mag, reserve: def.reserve, cap: def.mag };
  f.weapon = id;
  f.mag = f.ammo[id].mag;
  f.reserve = f.ammo[id].reserve;
  f.reloading = 0;
}

/** Switch to an owned weapon, keeping its saved ammo. */
export function switchWeapon(g, f, id) {
  if (!f.ammo || !f.ammo[id]) return false;
  if (f.weapon === id) return false;
  if (f.reloading > 0) f.reloading = 0;
  giveWeapon(f, id);
  pushEvent(g, { type: 'switch', fighter: f });
  return true;
}

export function startReload(g, f) {
  const def = WEAPONS[f.weapon];
  if (f.reloading > 0 || f.mag >= def.mag || f.reserve <= 0) return false;
  f.reloading = def.mag <= 12 ? 1.1 : 1.6;
  f.reloadTotal = f.reloading;
  pushEvent(g, { type: 'reload', fighter: f });
  return true;
}

export function finishReload(f) {
  const def = WEAPONS[f.weapon];
  const need = def.mag - f.mag;
  const take = Math.min(need, f.reserve);
  f.mag += take;
  f.reserve -= take;
  f.ammo[f.weapon] = { mag: f.mag, reserve: f.reserve, cap: def.mag };
  f.reloading = 0;
}

// ---------------------------------------------------------------- ray tests

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxT) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  const t = tca - Math.sqrt(r2 - d2);
  return t >= 0 && t <= maxT ? t : Infinity;
}

// Distance from a ray to a vertical segment; returns the ray t of the closest
// approach when it is inside the capsule radius, else Infinity.
function rayCapsule(ox, oy, oz, dx, dy, dz, cx, cz, y0, y1, r, maxT) {
  // Closest point on the ray to the segment axis (x/z only, segment vertical).
  const px = ox - cx, pz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) {
    // Ray nearly vertical: check horizontal distance and y range.
    const hd = Math.hypot(px, pz);
    if (hd > r) return Infinity;
    const t = dy > 0 ? (y0 - oy) / dy : (y1 - oy) / dy;
    return t >= 0 && t <= maxT ? t : Infinity;
  }
  const b = px * dx + pz * dz;
  let t = -b / a;
  if (t < 0) t = 0;
  if (t > maxT) return Infinity;
  const qx = ox + dx * t - cx, qz = oz + dz * t - cz;
  const hd = Math.hypot(qx, qz);
  if (hd > r) return Infinity;
  const y = oy + dy * t;
  if (y < y0 - r || y > y1 + r) return Infinity;
  return t;
}

/**
 * Cast a shot ray. Returns { kind: 'fighter', fighter, part: 'head'|'body', t }
 * or { kind: 'map', t } or null. The shooter's own volumes are skipped.
 */
export function raycastShot(g, ox, oy, oz, dx, dy, dz, maxDist, shooter, colliders) {
  let bestT = maxDist;
  let best = null;
  for (let i = 0; i < colliders.length; i++) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, colliders[i], bestT);
    if (t < bestT) { bestT = t; best = { kind: 'map', t }; }
  }
  const all = [g.player, ...g.bots];
  for (const f of all) {
    if (f === shooter || !f.alive) continue;
    const hx = f.pos.x, hy = f.pos.y + 1.58, hz = f.pos.z;
    const th = raySphere(ox, oy, oz, dx, dy, dz, hx, hy, hz, 0.26, bestT);
    if (th < bestT) { bestT = th; best = { kind: 'fighter', fighter: f, part: 'head', t: th }; }
    const tb = rayCapsule(ox, oy, oz, dx, dy, dz, f.pos.x, f.pos.z, f.pos.y + 0.25, f.pos.y + 1.38, 0.38, bestT);
    if (tb < bestT) { bestT = tb; best = { kind: 'fighter', fighter: f, part: 'body', t: tb }; }
  }
  return best;
}

// ---------------------------------------------------------------- shooting

/** Spread angle (radians) for a shot: base + movement + bloom, reduced by crouch/steady. */
export function currentSpread(g, f, def) {
  const speed = Math.hypot(f.vel.x, f.vel.z);
  let s = def.spread + (f.spreadBloom || 0);
  if (speed > 0.5) s += def.moveSpread * Math.min(1, speed / 6);
  if (!f.onGround) s += 0.02;
  if (f.crouched) s *= 0.55;
  if (f.isPlayer && g.input.steady) s *= 0.6;
  return s;
}

/** Fire one hitscan shot from a fighter along dir (unit vector). */
export function tryFire(g, f, ox, oy, oz, dx, dy, dz, colliders) {
  if (!f.alive || f.reloading > 0 || f.fireCooldown > 0) return false;
  const def = WEAPONS[f.weapon];
  if (f.mag <= 0) {
    f.fireCooldown = 0.25;
    pushEvent(g, { type: 'dryfire', fighter: f });
    return false;
  }
  f.mag -= 1;
  if (f.ammo) f.ammo[f.weapon].mag = f.mag;
  f.fireCooldown = def.rate;
  f.spreadBloom = Math.min(0.03, (f.spreadBloom || 0) + def.recoil * 0.012);
  g.shots += f.isPlayer ? 1 : 0;

  // Spread: perturb the direction by a random cone.
  const s = currentSpread(g, f, def);
  const rx = (Math.random() - 0.5) * 2 * s;
  const ry = (Math.random() - 0.5) * 2 * s;
  // Build an orthonormal basis around dir.
  let ux = -dz, uy = 0, uz = dx;
  const ul = Math.hypot(ux, uz) || 1;
  ux /= ul; uz /= ul;
  const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
  let nx = dx + ux * rx + vx * ry;
  let ny = dy + uy * rx + vy * ry;
  let nz = dz + uz * rx + vz * ry;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;

  const hit = raycastShot(g, ox, oy, oz, nx, ny, nz, def.range, f, colliders);
  const endT = hit ? hit.t : def.range;
  pushEvent(g, { type: 'shot', fighter: f, weapon: f.weapon, ox, oy, oz, ex: ox + nx * endT, ey: oy + ny * endT, ez: oz + nz * endT });
  if (hit && hit.kind === 'fighter') {
    const falloff = Math.max(0.6, 1 - Math.max(0, hit.t - 25) * 0.008);
    let dmg = def.damage * falloff * (hit.part === 'head' ? def.headMul : 1);
    dmg = Math.round(dmg);
    applyDamage(g, hit.fighter, dmg, f, f.weapon, hit.part === 'head');
    if (f.isPlayer) { g.hits += 1; if (hit.part === 'head') g.headshots += 1; }
    pushEvent(g, { type: 'hit', shooter: f, target: hit.fighter, headshot: hit.part === 'head' });
  } else if (hit && hit.kind === 'map') {
    pushEvent(g, { type: 'impact', x: ox + nx * hit.t, y: oy + ny * hit.t, z: oz + nz * hit.t });
  }
  // Recoil kick on the shooter's aim.
  f.pitch += def.kick * (f.isPlayer ? 1 : 0.4);
  return true;
}

/** Damage with armor absorption; death pays the killer and posts a kill event. */
export function applyDamage(g, target, dmg, attacker, weapon, headshot) {
  if (!target.alive) return;
  let remaining = dmg;
  if (target.armor > 0) {
    const absorbed = Math.min(target.armor, Math.round(dmg * 0.5));
    target.armor -= absorbed;
    remaining -= absorbed;
  }
  target.hp -= remaining;
  pushEvent(g, { type: 'damage', target, attacker, dmg: remaining, headshot });
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    if (attacker && attacker.isPlayer && attacker !== target) {
      g.money += KILL_REWARD;
      g.kills += 1;
    }
    if (target.isPlayer) g.deaths += 1;
    pushEvent(g, { type: 'kill', killer: attacker, victim: target, weapon, headshot });
    // Drop the dead player's primary weapon (respawns with the pistol).
    if (target.isPlayer && target.weapon !== 'pistol') {
      delete target.ammo[target.weapon];
      target.weapon = 'pistol';
      target.mag = target.ammo.pistol.mag;
      target.reserve = target.ammo.pistol.reserve;
    }
  }
}

// ---------------------------------------------------------------- grenades

export function throwGrenade(g, f) {
  if (!f.alive || f.grenades <= 0 || f.fireCooldown > 0) return false;
  f.grenades -= 1;
  f.fireCooldown = 0.4;
  const dir = aimDir(f);
  const gr = {
    pos: { x: f.pos.x + dir.x * 0.5, y: f.pos.y + 1.4, z: f.pos.z + dir.z * 0.5 },
    vel: { x: dir.x * 14 + f.vel.x * 0.4, y: dir.y * 14 + 3.5, z: dir.z * 14 + f.vel.z * 0.4 },
    fuse: 1.6, owner: f,
  };
  if (!g.grenades) g.grenades = [];
  g.grenades.push(gr);
  pushEvent(g, { type: 'throw', fighter: f });
  return true;
}

/** A fighter's aim direction from yaw/pitch. */
export function aimDir(f) {
  const cy = Math.cos(f.yaw), sy = Math.sin(f.yaw);
  const cp = Math.cos(f.pitch), sp = Math.sin(f.pitch);
  return { x: -sy * cp, y: sp, z: -cy * cp };
}

export function updateGrenades(g, dt, colliders) {
  if (!g.grenades) return;
  for (let i = g.grenades.length - 1; i >= 0; i--) {
    const gr = g.grenades[i];
    gr.fuse -= dt;
    gr.vel.y -= 12 * dt;
    gr.pos.x += gr.vel.x * dt;
    gr.pos.y += gr.vel.y * dt;
    gr.pos.z += gr.vel.z * dt;
    if (gr.pos.y < 0.08) { gr.pos.y = 0.08; gr.vel.y *= -0.35; gr.vel.x *= 0.7; gr.vel.z *= 0.7; }
    if (gr.pos.x < -29.5) { gr.pos.x = -29.5; gr.vel.x *= -0.4; }
    if (gr.pos.x > 29.5) { gr.pos.x = 29.5; gr.vel.x *= -0.4; }
    if (gr.pos.z < -19.5) { gr.pos.z = -19.5; gr.vel.z *= -0.4; }
    if (gr.pos.z > 19.5) { gr.pos.z = 19.5; gr.vel.z *= -0.4; }
    if (gr.fuse <= 0) {
      g.grenades.splice(i, 1);
      explodeGrenade(g, gr, colliders);
    }
  }
}

function explodeGrenade(g, gr, colliders) {
  pushEvent(g, { type: 'explode', x: gr.pos.x, y: gr.pos.y, z: gr.pos.z });
  const all = [g.player, ...g.bots];
  for (const f of all) {
    if (!f.alive || f === gr.owner) continue;
    const d = Math.hypot(f.pos.x - gr.pos.x, (f.pos.y + 1) - gr.pos.y, f.pos.z - gr.pos.z);
    if (d > 6) continue;
    let dmg = Math.round(90 * (1 - d / 6) + 15);
    const clear = losClear({ x: gr.pos.x, y: gr.pos.y + 0.3, z: gr.pos.z }, { x: f.pos.x, y: f.pos.y + 1.1, z: f.pos.z }, colliders);
    if (!clear) dmg = Math.round(dmg * 0.5);
    applyDamage(g, f, dmg, gr.owner, 'grenade', false);
  }
}
