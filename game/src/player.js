// player.js — the human player: WASD movement with acceleration and friction,
// jump, crouch, Shift to aim steady, pointer-lock mouse look. The camera sits at
// the fighter's eye; the viewmodel gun kicks with recoil and bobs while walking.

import { collideCircle } from './map.js';
import { aimDir, currentSpread, tryFire, startReload, finishReload, throwGrenade, switchWeapon, WEAPONS } from './weapons.js';

const WALK_SPEED = 6.2;
const CROUCH_SPEED = 3.0;
const STEADY_SPEED = 3.4;
const ACCEL = 55;
const FRICTION = 10;
const JUMP_VEL = 6.5;
const GRAVITY = 16;
const EYE_STAND = 1.55;
const EYE_CROUCH = 1.05;

/** Apply the look deltas accumulated this frame (mouse or debug freelook). */
export function applyLook(g, f, dx, dy) {
  const sens = 0.0021;
  f.yaw -= dx * sens;
  f.pitch -= dy * sens;
  const lim = 1.52;
  if (f.pitch > lim) f.pitch = lim;
  if (f.pitch < -lim) f.pitch = -lim;
}

/** One fixed-step update of the player. Returns nothing; mutates f and g. */
export function updatePlayer(g, f, dt, colliders) {
  const input = g.input;
  if (!f.alive) return;

  // Crouch: lower eye, slower, tighter spread.
  f.crouched = !!input.crouch;
  const speed = f.crouched ? CROUCH_SPEED : (input.steady ? STEADY_SPEED : WALK_SPEED);

  // Wish direction from keys, rotated by yaw.
  const sy = Math.sin(f.yaw), cy = Math.cos(f.yaw);
  let wx = 0, wz = 0;
  if (input.fwd !== 0) { wx += -sy * input.fwd; wz += -cy * input.fwd; }
  if (input.strafe !== 0) { wx += cy * input.strafe; wz += -sy * input.strafe; }
  const wl = Math.hypot(wx, wz);
  if (wl > 0.01) { wx /= wl; wz /= wl; }

  // Accelerate toward the wish velocity; friction when no input.
  const tx = wx * speed, tz = wz * speed;
  const ax = (tx - f.vel.x) * Math.min(1, ACCEL * dt / speed * 6);
  const az = (tz - f.vel.z) * Math.min(1, ACCEL * dt / speed * 6);
  f.vel.x += ax;
  f.vel.z += az;
  if (wl < 0.01) {
    const fr = Math.max(0, 1 - FRICTION * dt);
    f.vel.x *= fr;
    f.vel.z *= fr;
  }

  // Jump + gravity.
  if (input.jump && f.onGround) {
    f.vel.y = JUMP_VEL;
    f.onGround = false;
  }
  f.vel.y -= GRAVITY * dt;
  f.pos.x += f.vel.x * dt;
  f.pos.z += f.vel.z * dt;
  collideCircle(f.pos, 0.35, colliders);
  // Arena bounds (the perimeter walls also collide, this is a backstop).
  f.pos.x = Math.max(-29.5, Math.min(29.5, f.pos.x));
  f.pos.z = Math.max(-19.5, Math.min(19.5, f.pos.z));
  f.pos.y += f.vel.y * dt;
  if (f.pos.y <= 0) { f.pos.y = 0; f.vel.y = 0; f.onGround = true; }

  // Eye height eases toward stand/crouch.
  const targetEye = f.crouched ? EYE_CROUCH : EYE_STAND;
  f._eyeY += (targetEye - f._eyeY) * Math.min(1, 12 * dt);

  // Recoil recovery: pitch drifts back toward the pre-shot aim.
  f.pitch *= Math.max(0, 1 - 6 * dt);
  if (f.spreadBloom) f.spreadBloom = Math.max(0, f.spreadBloom - 0.05 * dt);

  // Reload timer.
  if (f.reloading > 0) {
    f.reloading -= dt;
    if (f.reloading <= 0) finishReload(f);
  }
  if (f.fireCooldown > 0) f.fireCooldown -= dt;

  // Firing: hold for auto weapons, one shot per click for semi-auto.
  const def = WEAPONS[f.weapon];
  const wantFire = def.auto ? input.fire : input.fireEdge;
  if (wantFire) {
    const dir = aimDir(f);
    const eyeY = f.pos.y + f._eyeY;
    tryFire(g, f, f.pos.x, eyeY, f.pos.z, dir.x, dir.y, dir.z, colliders);
    if (!def.auto) input.fireEdge = false;
  }
  if (input.reload) {
    input.reload = false;
    startReload(g, f);
  }
  // Dry weapon with no reserve: fall back to the sidearm automatically.
  if (f.mag === 0 && f.reserve === 0 && f.reloading <= 0 && f.weapon !== 'pistol' && f.ammo?.pistol && (f.ammo.pistol.mag > 0 || f.ammo.pistol.reserve > 0)) {
    switchWeapon(g, f, 'pistol');
  }
  if (input.grenade) {
    input.grenade = false;
    throwGrenade(g, f);
  }
}

/** Place the camera at the player's eye and the viewmodel gun in front of it. */
export function updateCamera(camera, viewmodel, f, dt, bobPhase) {
  const eyeY = f.pos.y + f._eyeY;
  camera.position.set(f.pos.x, eyeY, f.pos.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = f.yaw;
  camera.rotation.x = f.pitch;
  camera.rotation.z = 0;
  // Walk bob on the viewmodel only (the camera stays steady for aiming).
  const speed = Math.hypot(f.vel.x, f.vel.z);
  const bob = f.onGround ? Math.min(1, speed / 6) * 0.012 : 0;
  const t = bobPhase;
  viewmodel.position.set(
    0.28 + Math.sin(t * 2) * bob,
    -0.26 + Math.abs(Math.sin(t * 2)) * bob * 0.7 - (f.crouched ? 0.02 : 0),
    -0.5,
  );
  // Recoil kick: the gun jumps back and up briefly after a shot.
  const kick = f._kick || 0;
  viewmodel.position.z += kick * 0.12;
  viewmodel.rotation.x = kick * 0.35;
  if (f._kick) f._kick = Math.max(0, f._kick - dt * 6);
}

/** Current spread as a CSS pixel offset for the crosshair. */
export function crosshairSpreadPx(g, f) {
  const def = { spread: 0.011, moveSpread: 0.02 };
  const s = currentSpread(g, f, def);
  return Math.round(s * 900);
}
