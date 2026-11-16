// bots.js — one bot AI shared by both teams. A bot walks its lane's waypoints
// toward the enemy side, fights what it can see, strafes while it shoots, and
// falls back to a cover point when it is hurt. Bots are beatable on purpose:
// a reaction delay before the first shot, burst fire with pauses, and aim error
// that grows with distance and with how fast the target moves.

import { collideCircle, losClear } from './map.js';
import { aimDir, giveWeapon, tryFire, startReload, finishReload, WEAPONS } from './weapons.js';

const BOT_SPEED = 4.4;
const SIGHT_RANGE = 48;

/** Assign lanes and weapons at the start of a round. */
export function setupBots(g, lanes) {
  const emberBots = g.bots.filter((b) => b.team === 'ember');
  const ashBots = g.bots.filter((b) => b.team === 'ash');
  emberBots.forEach((b, i) => { b.ai.lane = i % lanes.length; b.ai.wpIndex = 0; b.ai.wpDir = 1; });
  ashBots.forEach((b, i) => { b.ai.lane = (i + 1) % lanes.length; b.ai.wpIndex = lanes[(i + 1) % lanes.length].length - 1; b.ai.wpDir = -1; });
  for (const b of g.bots) {
    const w = Math.random() < 0.7 ? 'rifle' : 'smg';
    giveWeapon(b, w);
    // Bots never buy ammo: refill their reserve every round so they never
    // run dry mid-match.
    b.ammo[w].reserve = WEAPONS[w].reserve;
    b.reserve = WEAPONS[w].reserve;
    b.grenades = 0;
  }
}

/** Nearest alive enemy the bot can see (LOS + range), or null. */
function acquireTarget(g, bot, colliders) {
  const foes = [g.player, ...g.bots].filter((f) => f.team !== bot.team && f.alive);
  let best = null;
  let bestD = SIGHT_RANGE;
  const eye = { x: bot.pos.x, y: bot.pos.y + 1.5, z: bot.pos.z };
  for (const f of foes) {
    const d = Math.hypot(f.pos.x - bot.pos.x, f.pos.z - bot.pos.z);
    if (d > bestD) continue;
    const chest = { x: f.pos.x, y: f.pos.y + 1.1, z: f.pos.z };
    if (!losClear(eye, chest, colliders)) continue;
    best = f;
    bestD = d;
  }
  return best;
}

/** Aim direction at a target with an error that grows with distance and motion. */
function aimAt(bot, target, errScale) {
  const tx = target.pos.x, ty = target.pos.y + 1.25, tz = target.pos.z;
  const dx = tx - bot.pos.x, dy = ty - (bot.pos.y + 1.5), dz = tz - bot.pos.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  const speed = Math.hypot(target.vel.x, target.vel.z);
  const err = (0.015 + len * 0.0011 + speed * 0.004) * errScale;
  const ex = (Math.random() - 0.5) * 2 * err;
  const ey = (Math.random() - 0.5) * 2 * err;
  const ez = (Math.random() - 0.5) * 2 * err;
  const nx = dx / len + ex, ny = dy / len + ey, nz = dz / len + ez;
  const nl = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / nl, y: ny / nl, z: nz / nl };
}

/** Move a bot toward a point with collision, returning how far it got. */
function moveToward(bot, tx, tz, speed, dt, colliders) {
  const dx = tx - bot.pos.x, dz = tz - bot.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) return 0;
  const vx = (dx / d) * speed, vz = (dz / d) * speed;
  bot.vel.x = vx; bot.vel.z = vz;
  const ox = bot.pos.x, oz = bot.pos.z;
  bot.pos.x += vx * dt;
  bot.pos.z += vz * dt;
  collideCircle(bot.pos, 0.35, colliders);
  bot.pos.x = Math.max(-29.5, Math.min(29.5, bot.pos.x));
  bot.pos.z = Math.max(-19.5, Math.min(19.5, bot.pos.z));
  bot.yaw = Math.atan2(-vx, -vz);
  return Math.hypot(bot.pos.x - ox, bot.pos.z - oz);
}

export function updateBots(g, dt, colliders, lanes, coverPoints) {
  for (const bot of g.bots) {
    if (!bot.alive) continue;
    const ai = bot.ai;
    if (bot.fireCooldown > 0) bot.fireCooldown -= dt;
    if (bot.reloading > 0) {
      bot.reloading -= dt;
      if (bot.reloading <= 0) finishReload(bot);
    }
    if (bot.spreadBloom) bot.spreadBloom = Math.max(0, bot.spreadBloom - 0.05 * dt);

    // Target acquisition with a reaction delay on a fresh target.
    const seen = acquireTarget(g, bot, colliders);
    if (seen && seen !== ai.target) {
      ai.target = seen;
      ai.reaction = 0.35 + Math.random() * 0.35;
    } else if (!seen) {
      ai.target = null;
    }
    if (ai.reaction > 0) ai.reaction -= dt;

    // Hurt badly: fall back to a cover point, then resume. A cooldown keeps the
    // bot from ducking straight back into cover the moment it steps out. Only
    // cover points the bot can actually see are considered — a point behind a
    // wall would make the bot walk into the wall forever.
    if (ai.coverCooldown > 0) ai.coverCooldown -= dt;
    if (bot.hp < 35 && ai.state !== 'cover' && ai.coverWp < 0 && ai.coverCooldown <= 0) {
      let best = -1, bestD = 1e9;
      for (let i = 0; i < coverPoints.length; i++) {
        const d = Math.hypot(coverPoints[i][0] - bot.pos.x, coverPoints[i][1] - bot.pos.z);
        if (d >= bestD) continue;
        if (!losClear({ x: bot.pos.x, y: bot.pos.y + 1.5, z: bot.pos.z }, { x: coverPoints[i][0], y: bot.pos.y + 1.5, z: coverPoints[i][1] }, colliders)) continue;
        bestD = d; best = i;
      }
      if (best >= 0) {
        ai.coverWp = best;
        ai.state = 'cover';
        ai.holdT = 3;
        ai.coverT = 4;
      }
    }

    if (ai.state === 'cover') {
      const cp = coverPoints[ai.coverWp];
      ai.coverT -= dt;
      const moved = moveToward(bot, cp[0], cp[1], BOT_SPEED, dt, colliders);
      if (Math.hypot(cp[0] - bot.pos.x, cp[1] - bot.pos.z) < 1.2) {
        ai.holdT -= dt;
        bot.vel.x = 0; bot.vel.z = 0;
        if (ai.holdT <= 0) { ai.state = 'advance'; ai.coverWp = -1; ai.coverCooldown = 8; }
      } else if (ai.coverT <= 0) {
        // Could not reach the cover point (blocked): give up and keep moving.
        ai.state = 'advance'; ai.coverWp = -1; ai.coverCooldown = 8;
      }
      void moved;
    } else if (ai.target && ai.reaction <= 0) {
      // Combat: strafe sideways while firing in bursts.
      ai.state = 'combat';
      ai.strafeT -= dt;
      if (ai.strafeT <= 0) { ai.strafeDir *= -1; ai.strafeT = 0.8 + Math.random() * 0.8; }
      const t = ai.target;
      const dx = t.pos.x - bot.pos.x, dz = t.pos.z - bot.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      // Strafe perpendicular to the target, keep roughly 8-25m away.
      let mx = (-dz / d) * ai.strafeDir;
      let mz = (dx / d) * ai.strafeDir;
      if (d > 25) { mx += (dx / d) * 0.7; mz += (dz / d) * 0.7; }
      if (d < 7) { mx -= (dx / d) * 0.7; mz -= (dz / d) * 0.7; }
      const ml = Math.hypot(mx, mz) || 1;
      bot.vel.x = (mx / ml) * BOT_SPEED * 0.7;
      bot.vel.z = (mz / ml) * BOT_SPEED * 0.7;
      const ox = bot.pos.x, oz = bot.pos.z;
      bot.pos.x += bot.vel.x * dt;
      bot.pos.z += bot.vel.z * dt;
      collideCircle(bot.pos, 0.35, colliders);
      bot.pos.x = Math.max(-29.5, Math.min(29.5, bot.pos.x));
      bot.pos.z = Math.max(-19.5, Math.min(19.5, bot.pos.z));
      void ox; void oz;
      // Face the target and fire bursts.
      bot.yaw = Math.atan2(-(t.pos.x - bot.pos.x), -(t.pos.z - bot.pos.z));
      const dy = (t.pos.y + 1.25) - (bot.pos.y + 1.5);
      bot.pitch = Math.atan2(dy, d);
      if (bot.mag <= 0) {
        startReload(g, bot);
      } else if (ai.burstLeft > 0) {
        const dir = aimAt(bot, t, 1);
        if (tryFire(g, bot, bot.pos.x, bot.pos.y + 1.5, bot.pos.z, dir.x, dir.y, dir.z, colliders)) ai.burstLeft -= 1;
      } else {
        ai.burstPause -= dt;
        if (ai.burstPause <= 0) {
          ai.burstLeft = 3 + Math.floor(Math.random() * 3);
          ai.burstPause = 0.5 + Math.random() * 0.6;
        }
      }
    } else {
      // Advance along the lane, ping-ponging it end to end so the bot keeps
      // crossing mid instead of parking on the enemy side.
      ai.state = 'advance';
      const lane = lanes[ai.lane];
      const wp = lane[ai.wpIndex];
      const moved = moveToward(bot, wp[0], wp[1], BOT_SPEED, dt, colliders);
      if (Math.hypot(wp[0] - bot.pos.x, wp[1] - bot.pos.z) < 1.0) {
        ai.wpIndex += ai.wpDir;
        let reversed = false;
        if (ai.wpIndex >= lane.length - 1) { ai.wpIndex = lane.length - 1; ai.wpDir = -1; reversed = true; }
        if (ai.wpIndex <= 0) { ai.wpIndex = 0; ai.wpDir = 1; reversed = true; }
        if (reversed && lanes.length > 1 && Math.random() < 0.5) {
          // Half the time, change lanes at the end of a run: bots that only
          // ever walk one lane can patrol past each other forever.
          const other = (ai.lane + 1 + Math.floor(Math.random() * (lanes.length - 1))) % lanes.length;
          const nl = lanes[other];
          ai.lane = other;
          ai.wpIndex = bot.pos.x < 0 ? 0 : nl.length - 1;
          ai.wpDir = bot.pos.x < 0 ? 1 : -1;
        }
      }
      // Stuck detection: barely moving while trying to advance.
      if (moved < 0.02 && Math.hypot(wp[0] - bot.pos.x, wp[1] - bot.pos.z) > 1.5) {
        ai.stuckT += dt;
        if (ai.stuckT > 1.5) {
          ai.stuckT = 0;
          ai.lane = (ai.lane + 1) % lanes.length;
          ai.wpIndex = bot.team === 'ember' ? 0 : lanes[ai.lane].length - 1;
          ai.wpDir = bot.team === 'ember' ? 1 : -1;
        }
      } else {
        ai.stuckT = 0;
      }
    }
  }
}
