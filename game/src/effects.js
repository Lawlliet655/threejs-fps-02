// effects.js — tracers, muzzle flashes, hit sparks and explosions. Everything is
// pooled and reused: no new three.js objects are made while the game runs.

import * as THREE from 'three';

const MAX_TRACERS = 24;
const MAX_SPARKS = 240;

export function initEffects(scene) {
  const fx = { scene, tracers: [], sparkIdx: 0, flashLight: null, flashT: 0, boom: null, boomT: 0, boomLight: null };
  // Tracer pool: one Line each, faded out in updateEffects.
  for (let i = 0; i < MAX_TRACERS; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0 });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    scene.add(line);
    fx.tracers.push({ line, life: 0 });
  }
  // Spark pool: one Points cloud, dead particles parked far below the map.
  const pos = new Float32Array(MAX_SPARKS * 3);
  for (let i = 0; i < MAX_SPARKS; i++) pos[i * 3 + 1] = -100;
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const sMat = new THREE.PointsMaterial({ color: 0xffc46b, size: 0.09, transparent: true, opacity: 0.95 });
  const points = new THREE.Points(sGeo, sMat);
  points.frustumCulled = false;
  scene.add(points);
  fx.sparks = { points, pos, vel: new Float32Array(MAX_SPARKS * 3), life: new Float32Array(MAX_SPARKS) };
  // Muzzle flash light (reused for every shot).
  fx.flashLight = new THREE.PointLight(0xffc46b, 0, 9, 1.5);
  scene.add(fx.flashLight);
  // Explosion: one expanding sphere + one light, reused.
  fx.boom = new THREE.Mesh(
    new THREE.SphereGeometry(1, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  fx.boom.visible = false;
  scene.add(fx.boom);
  fx.boomLight = new THREE.PointLight(0xff7a1a, 0, 22, 1.5);
  scene.add(fx.boomLight);
  return fx;
}

export function spawnTracer(fx, from, to, color = 0xffc46b) {
  let best = fx.tracers[0];
  for (const t of fx.tracers) if (t.life <= 0) { best = t; break; }
  const p = best.line.geometry.attributes.position.array;
  p[0] = from.x; p[1] = from.y; p[2] = from.z;
  p[3] = to.x; p[4] = to.y; p[5] = to.z;
  best.line.geometry.attributes.position.needsUpdate = true;
  best.line.material.color.setHex(color);
  best.line.material.opacity = 0.9;
  best.life = 0.07;
}

export function muzzleFlash(fx, pos) {
  fx.flashLight.position.set(pos.x, pos.y, pos.z);
  fx.flashLight.intensity = 26;
  fx.flashT = 0.05;
}

export function spawnSparks(fx, pos, n = 10, spread = 2.2) {
  const s = fx.sparks;
  for (let k = 0; k < n; k++) {
    const i = fx.sparkIdx;
    fx.sparkIdx = (fx.sparkIdx + 1) % MAX_SPARKS;
    s.pos[i * 3] = pos.x;
    s.pos[i * 3 + 1] = pos.y;
    s.pos[i * 3 + 2] = pos.z;
    s.vel[i * 3] = (Math.random() - 0.5) * 2 * spread;
    s.vel[i * 3 + 1] = Math.random() * spread;
    s.vel[i * 3 + 2] = (Math.random() - 0.5) * 2 * spread;
    s.life[i] = 0.3 + Math.random() * 0.25;
  }
  s.points.geometry.attributes.position.needsUpdate = true;
}

export function explode(fx, pos) {
  fx.boom.position.set(pos.x, pos.y + 0.4, pos.z);
  fx.boom.visible = true;
  fx.boomT = 0.45;
  fx.boomLight.position.set(pos.x, pos.y + 1, pos.z);
  fx.boomLight.intensity = 120;
  spawnSparks(fx, pos, 60, 6);
}

export function updateEffects(fx, dt) {
  for (const t of fx.tracers) {
    if (t.life > 0) {
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
    }
  }
  if (fx.flashT > 0) {
    fx.flashT -= dt;
    fx.flashLight.intensity = Math.max(0, fx.flashT / 0.05) * 26;
  } else {
    fx.flashLight.intensity = 0;
  }
  if (fx.boomT > 0) {
    fx.boomT -= dt;
    const k = 1 - Math.max(0, fx.boomT) / 0.45;
    const r = 0.5 + k * 5.5;
    fx.boom.scale.set(r, r, r);
    fx.boom.material.opacity = (1 - k) * 0.55;
    fx.boomLight.intensity = (1 - k) * 120;
    if (fx.boomT <= 0) { fx.boom.visible = false; fx.boomLight.intensity = 0; }
  }
  const s = fx.sparks;
  let moved = false;
  for (let i = 0; i < MAX_SPARKS; i++) {
    if (s.life[i] <= 0) continue;
    s.life[i] -= dt;
    if (s.life[i] <= 0) { s.pos[i * 3 + 1] = -100; moved = true; continue; }
    s.vel[i * 3 + 1] -= 9 * dt;
    s.pos[i * 3] += s.vel[i * 3] * dt;
    s.pos[i * 3 + 1] += s.vel[i * 3 + 1] * dt;
    s.pos[i * 3 + 2] += s.vel[i * 3 + 2] * dt;
    if (s.pos[i * 3 + 1] < 0.02) { s.pos[i * 3 + 1] = 0.02; s.vel[i * 3 + 1] *= -0.3; }
    moved = true;
  }
  if (moved) s.points.geometry.attributes.position.needsUpdate = true;
}
