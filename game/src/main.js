// main.js — boot, the fixed-step simulation loop, input, and the event drain.
// The simulation runs at a fixed 60 Hz, apart from rendering: the loop accumulates
// real time and steps the sim in 1/60 s slices, then renders once. All state lives
// in state.js; this file wires the modules together and owns the three.js objects.

import * as THREE from 'three';
import { createGame, resetMatch, startBuyPhase, startRound, MATCH_TARGET } from './state.js';
import { buildWorld, buildFighterMesh, buildViewmodel } from './map.js';
import { updatePlayer, applyLook, updateCamera, crosshairSpreadPx } from './player.js';
import { setupBots, updateBots } from './bots.js';
import { updateGrenades, giveWeapon } from './weapons.js';
import { updateRounds, buyItem, equipOwned } from './rounds.js';
import { initAudio, setMuted, isMuted, sfx } from './audio.js';
import { initHud, updateHud, showPhase, showBanner, addKillFeed, showHitmarker, showDamage, renderBuy } from './hud.js';
import { initEffects, spawnTracer, muzzleFlash, spawnSparks, explode, updateEffects } from './effects.js';
import { makeFighter } from './state.js';

const SIM_DT = 1 / 60;
const canvas = document.getElementById('view');

const g = createGame();
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 300);
camera.rotation.order = 'YXZ';
scene.add(camera);

const world = buildWorld(scene);
const fx = initEffects(scene);
const viewmodel = buildViewmodel();
camera.add(viewmodel);
const flashLight = new THREE.PointLight(0xffc46b, 0, 6, 1.5);
camera.add(flashLight);
flashLight.position.set(0.28, -0.2, -0.8);

// Fighters: the player + 2 Ember allies vs 4 Ash bots.
const ALLY_NAMES = ['Vex', 'Kip'];
const ENEMY_NAMES = ['Rook', 'Mira', 'Sable', 'Dusk'];
for (const name of ALLY_NAMES) {
  const b = makeFighter('b' + name, name, 'ember', false);
  g.bots.push(b);
}
for (const name of ENEMY_NAMES) {
  const b = makeFighter('b' + name, name, 'ash', false);
  g.bots.push(b);
}
for (const f of [g.player, ...g.bots]) {
  f.mesh = buildFighterMesh(f.team);
  f.headMesh = f.mesh.userData.head;
  f.bodyMesh = f.mesh.userData.body;
  f.gunMesh = f.mesh.userData.gun;
  scene.add(f.mesh);
}
g.player.mesh.visible = false; // first person: no own body in view

// Debug hooks from the URL (?freelook=1, ?demo=buy|win|lose, ?autotest=1).
const params = new URLSearchParams(location.search);
g.debug.freelook = params.has('freelook');
g.debug.autotest = params.has('autotest');
g.debug.demo = params.get('demo');
window.__ember = { g, world, step: (n) => { for (let i = 0; i < n; i++) simStep(SIM_DT); } };
window.__emberBuy = (id) => buyItem(g, id);
window.__emberSpread = () => crosshairSpreadPx(g, g.player);

// ------------------------------------------------------------------ flow

function startMatch() {
  initAudio();
  resetMatch(g);
  startBuyPhase(g);
  setupBots(g, world.lanes);
  showPhase(g);
}

function startRoundNow() {
  if (g.phase !== 'buy') return;
  startRound(g, world.spawns);
  setupBots(g, world.lanes);
  showPhase(g);
  lockPointer();
  sfx.roundStart();
}

function restartMatch() {
  startMatch();
}

function togglePause() {
  if (g.phase === 'title' || g.phase === 'matchEnd') return;
  g.paused = !g.paused;
  if (g.paused) document.exitPointerLock?.();
  else if (g.phase === 'round') lockPointer();
  showPhase(g);
}

function lockPointer() {
  if (g.debug.freelook || g.debug.autotest) return;
  try { canvas.requestPointerLock(); } catch (e) { /* headless or denied */ }
}

// ------------------------------------------------------------------ input

const keys = {};
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys[e.code] = true;
  const p = g.player;
  switch (e.code) {
    case 'KeyW': g.input.fwd = 1; break;
    case 'KeyS': g.input.fwd = -1; break;
    case 'KeyA': g.input.strafe = -1; break;
    case 'KeyD': g.input.strafe = 1; break;
    case 'Space':
      e.preventDefault();
      if (g.phase === 'buy') startRoundNow();
      else g.input.jump = true;
      break;
    case 'ShiftLeft': case 'ShiftRight': g.input.steady = true; break;
    case 'KeyC': g.input.crouch = !g.input.crouch; break;
    case 'KeyR':
      if (g.phase === 'round') g.input.reload = true;
      break;
    case 'KeyG':
      if (g.phase === 'round') g.input.grenade = true;
      break;
    case 'KeyB':
      if (g.phase === 'buy') { /* buy menu is already open */ }
      break;
    case 'KeyM': setMuted(!isMuted()); g.settings.muted = isMuted(); break;
    case 'KeyP': case 'Escape': togglePause(); break;
    case 'Digit1': case 'Digit2': case 'Digit3':
      if (g.phase === 'buy') buyItem(g, ['smg', 'rifle', 'sniper'][+e.code.slice(-1) - 1]);
      else if (g.phase === 'round') equipOwned(g, +e.code.slice(-1));
      break;
    case 'Digit4': if (g.phase === 'buy') buyItem(g, 'armor'); break;
    case 'Digit5': if (g.phase === 'buy') buyItem(g, 'grenade'); break;
    case 'Digit6': if (g.phase === 'buy') buyItem(g, 'ammo'); break;
  }
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  switch (e.code) {
    case 'KeyW': g.input.fwd = keys.KeyS ? -1 : 0; break;
    case 'KeyS': g.input.fwd = keys.KeyW ? 1 : 0; break;
    case 'KeyA': g.input.strafe = keys.KeyD ? 1 : 0; break;
    case 'KeyD': g.input.strafe = keys.KeyA ? -1 : 0; break;
    case 'Space': g.input.jump = false; break;
    case 'ShiftLeft': case 'ShiftRight': g.input.steady = false; break;
  }
});

document.addEventListener('mousemove', (e) => {
  if (g.debug.freelook || document.pointerLockElement === canvas) {
    g.input.lookDX += e.movementX || 0;
    g.input.lookDY += e.movementY || 0;
  }
});
document.addEventListener('pointerlockchange', () => {
  g.input.locked = document.pointerLockElement === canvas;
});
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (g.phase === 'round' && !g.input.locked && !g.debug.freelook && !g.debug.autotest) {
    lockPointer();
    return;
  }
  g.input.fire = true;
  g.input.fireEdge = true;
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) { g.input.fire = false; }
});

initHud({
  onStart: () => { startMatch(); },
  onStartRound: () => startRoundNow(),
  onResume: () => togglePause(),
  onRestart: () => restartMatch(),
});

// ------------------------------------------------------------------ events

function drainEvents() {
  for (const ev of g.events) {
    switch (ev.type) {
      case 'shot': {
        const near = !ev.fighter.isPlayer && distToPlayer(ev.fighter) > 32;
        if (!near) sfx.shot(ev.weapon);
        const from = { x: ev.ox, y: ev.oy, z: ev.oz };
        const to = { x: ev.ex, y: ev.ey, z: ev.ez };
        spawnTracer(fx, from, to, ev.fighter.team === 'ember' ? 0xffc46b : 0x9fd4ff);
        if (ev.fighter.isPlayer) {
          muzzleFlash(fx, from);
          ev.fighter._kick = 1;
        } else if (distToPlayer(ev.fighter) < 20) {
          muzzleFlash(fx, from);
        }
        break;
      }
      case 'hit':
        if (ev.shooter.isPlayer) { showHitmarker(false); sfx.hit(ev.headshot); }
        break;
      case 'kill': {
        addKillFeed(ev.killer ? ev.killer.name : '—', ev.victim.name, ev.weapon, ev.headshot);
        if (ev.killer?.isPlayer) { showHitmarker(true); sfx.kill(); }
        if (ev.victim.isPlayer) { showDamage(); sfx.hurt(); }
        if (ev.victim.mesh) ev.victim._flashT = 0.25;
        break;
      }
      case 'damage':
        if (ev.target.isPlayer && ev.attacker !== ev.target) { showDamage(); sfx.hurt(); }
        if (ev.target.mesh) ev.target._flashT = 0.15;
        break;
      case 'impact':
        spawnSparks(fx, ev, 6, 1.6);
        break;
      case 'explode':
        explode(fx, ev);
        sfx.explosion();
        break;
      case 'reload': if (ev.fighter.isPlayer) sfx.reload(); break;
      case 'dryfire': if (ev.fighter.isPlayer) sfx.dryfire(); break;
      case 'throw': if (ev.fighter.isPlayer) sfx.throw_(); break;
      case 'buy': sfx.buy(); renderBuy(g); break;
      case 'switch': if (ev.fighter.isPlayer) sfx.click(); break;
      case 'roundStart':
        showBanner(`ROUND ${ev.round}`, 'Eliminate the Ash team — first to ' + MATCH_TARGET + ' rounds wins', 'win');
        showPhase(g);
        break;
      case 'roundEnd': {
        if (ev.winner === 'ember') { showBanner('ROUND WON', `Ember ${ev.score.ember} — ${ev.score.ash} Ash`, 'win'); sfx.roundWin(); }
        else if (ev.winner === 'ash') { showBanner('ROUND LOST', `Ember ${ev.score.ember} — ${ev.score.ash} Ash`, 'lose'); sfx.roundLose(); }
        else showBanner('ROUND TIED', 'No point — the round replays', '');
        showPhase(g);
        break;
      }
      case 'matchEnd': {
        if (ev.winner === 'ember') sfx.roundWin(); else sfx.roundLose();
        showPhase(g);
        break;
      }
      case 'buyPhase': showPhase(g); break;
      case 'matchReset': showPhase(g); break;
    }
  }
  g.events.length = 0;
}

function distToPlayer(f) {
  const p = g.player;
  return Math.hypot(f.pos.x - p.pos.x, f.pos.z - p.pos.z);
}

// ------------------------------------------------------------------ autotest driver

function drivePlayer(dt) {
  const p = g.player;
  if (g.phase === 'title') { startMatch(); return; }
  if (g.phase === 'buy') {
    // Spend the buy phase shopping; start the round once the timer runs low
    // (the timer also starts it on its own, so this tests both paths).
    g.input.fwd = 0;
    g.input.strafe = 0;
    g.input.fire = false;
    g.input.fireEdge = false;
    if (g.money >= 2100 && !p.ammo?.rifle) buyItem(g, 'rifle');
    else if (g.money >= 900 && !p.ammo?.smg) buyItem(g, 'smg');
    else if (g.money >= 650 && p.armor < 100) buyItem(g, 'armor');
    else if (g.money >= 200 && p.ammo?.[p.weapon] && p.ammo[p.weapon].reserve < 20) buyItem(g, 'ammo');
    else if (g.money >= 300 && p.grenades < 1) buyItem(g, 'grenade');
    if (g.buyTimer < 1.5) startRoundNow();
    return;
  }
  if (g.phase !== 'round' || !p.alive) return;
  // Nearest alive enemy.
  let target = null, bestD = 1e9;
  for (const b of g.bots) {
    if (b.team === 'ember' || !b.alive) continue;
    const d = Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z);
    if (d < bestD) { bestD = d; target = b; }
  }
  if (!target) return;
  // Turn toward the target through the look deltas (the same path as the mouse:
  // applyLook subtracts the delta, so a positive yaw turn needs a negative dx).
  const wantYaw = Math.atan2(-(target.pos.x - p.pos.x), -(target.pos.z - p.pos.z));
  let dyaw = wantYaw - p.yaw;
  while (dyaw > Math.PI) dyaw -= 2 * Math.PI;
  while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
  g.input.lookDX -= dyaw / 0.0021 * Math.min(1, dt * 8);
  const wantPitch = Math.atan2((target.pos.y + 1.25) - (p.pos.y + p._eyeY), bestD);
  const dpitch = wantPitch - p.pitch;
  g.input.lookDY -= dpitch / 0.0021 * Math.min(1, dt * 8);
  // Advance when far, hold ground and shoot when close.
  g.input.fwd = bestD > 14 ? 1 : 0;
  g.input.strafe = 0;
  if (Math.abs(dyaw) < 0.06 && Math.abs(dpitch) < 0.06) {
    g.input.fire = true;
    g.input.fireEdge = true;
  } else {
    g.input.fire = false;
  }
  if (p.mag === 0) g.input.reload = true;
}

// ------------------------------------------------------------------ sim + loop

let acc = 0;
let lastT = performance.now();
let bobPhase = 0;
let stepCount = 0;
let titleAngle = 0;

function simStep(dt) {
  g.time += dt;
  stepCount += 1;
  // Consume look deltas (mouse or autotest driver).
  if (g.input.lookDX !== 0 || g.input.lookDY !== 0) {
    applyLook(g, g.player, g.input.lookDX, g.input.lookDY);
    g.input.lookDX = 0;
    g.input.lookDY = 0;
  }
  if (g.debug.autotest) drivePlayer(dt);
  if (g.paused) return;
  // Inputs from a finished round must not leak into the next phase: a held
  // trigger would otherwise keep firing through the buy menu.
  if (g.phase !== 'round' && g.phase !== 'buy') {
    g.input.fire = false;
    g.input.fireEdge = false;
    g.input.fwd = 0;
    g.input.strafe = 0;
  }
  if (g.phase === 'round') {
    updatePlayer(g, g.player, dt, world.colliders);
    updateBots(g, dt, world.colliders, world.lanes, world.coverPoints);
    updateGrenades(g, dt, world.colliders);
  } else if (g.phase === 'buy') {
    // Bots stand at spawn during the buy phase; the player can walk the yard.
    updatePlayer(g, g.player, dt, world.colliders);
  }
  updateRounds(g, dt, world.spawns);
  drainEvents();
}

function syncMeshes(dt) {
  for (const f of [g.player, ...g.bots]) {
    if (!f.mesh) continue;
    f.mesh.visible = f.alive && !f.isPlayer;
    if (!f.alive) continue;
    f.mesh.position.set(f.pos.x, f.pos.y, f.pos.z);
    f.mesh.rotation.y = f.yaw + Math.PI;
    const targetScaleY = f.crouched ? 0.72 : 1;
    f.mesh.scale.y += (targetScaleY - f.mesh.scale.y) * Math.min(1, 10 * dt);
    // Hit flash: body glows red briefly.
    if (f._flashT > 0) {
      f._flashT -= dt;
      f.mesh.userData.bodyMat.emissive.setHex(0xaa0000);
      f.mesh.userData.bodyMat.emissiveIntensity = 0.9;
    } else {
      f.mesh.userData.bodyMat.emissive.setHex(0x000000);
      f.mesh.userData.bodyMat.emissiveIntensity = 0;
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dtReal = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  acc += dtReal;
  let n = 0;
  while (acc >= SIM_DT && n < 5) {
    simStep(SIM_DT);
    acc -= SIM_DT;
    n += 1;
  }
  if (n === 5) acc = 0;

  // Title screen: slow orbit around the yard behind the menu.
  if (g.phase === 'title') {
    titleAngle += dtReal * 0.07;
    camera.position.set(Math.sin(titleAngle) * 26, 9 + Math.sin(titleAngle * 0.6) * 2, Math.cos(titleAngle) * 18);
    camera.lookAt(0, 1.5, 0);
  } else {
    const p = g.player;
    const speed = Math.hypot(p.vel.x, p.vel.z);
    if (p.onGround && speed > 0.5) bobPhase += dtReal * speed * 1.6;
    updateCamera(camera, viewmodel, p, dtReal, bobPhase);
  }
  syncMeshes(dtReal);
  updateEffects(fx, dtReal);
  updateHud(g, dtReal);
  // Footsteps for the player.
  if (g.phase === 'round' && g.player.alive && g.player.onGround) {
    const speed = Math.hypot(g.player.vel.x, g.player.vel.z);
    if (speed > 1) {
      g._stepT = (g._stepT || 0) - dtReal;
      if (g._stepT <= 0) { g._stepT = 0.38; sfx.footstep(); }
    }
  }
  renderer.render(scene, camera);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// Demo states for screenshots (?demo=buy|win|lose).
if (g.debug.demo === 'buy') {
  startMatch();
} else if (g.debug.demo === 'win') {
  startMatch();
  g.score.ember = MATCH_TARGET;
  g.score.ash = 3;
  g.round = 8;
  g.phase = 'matchEnd';
  g.matchWinner = 'ember';
  showPhase(g);
} else if (g.debug.demo === 'lose') {
  startMatch();
  g.score.ember = 2;
  g.score.ash = MATCH_TARGET;
  g.round = 7;
  g.phase = 'matchEnd';
  g.matchWinner = 'ash';
  showPhase(g);
}
showPhase(g);
requestAnimationFrame(frame);
