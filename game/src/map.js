// map.js — the Ember Line arena: a dusk-lit container yard. Builds the three.js scene
// (ground, walls, containers, crates, lights, sky), the collision boxes, the spawn
// points and the waypoint lanes the bots walk. Collision is 2D (footprints) for
// movement and 3D for rays, so a low crate blocks walking but can be shot over.

import * as THREE from 'three';

// A collision box: x0/z0/x1/z1 footprint, height h from the ground (y=0).
export function box(x0, z0, x1, z1, h) {
  return { x0, z0, x1, z1, h };
}

/** Push a circle (x/z, radius r) out of every overlapping collider footprint. */
export function collideCircle(pos, r, colliders) {
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (pos.x + r <= c.x0 || pos.x - r >= c.x1 || pos.z + r <= c.z0 || pos.z - r >= c.z1) continue;
    const pushL = (pos.x + r) - c.x0;
    const pushR = c.x1 - (pos.x - r);
    const pushN = (pos.z + r) - c.z0;
    const pushS = c.z1 - (pos.z - r);
    const m = Math.min(pushL, pushR, pushN, pushS);
    if (m === pushL) pos.x = c.x0 - r;
    else if (m === pushR) pos.x = c.x1 + r;
    else if (m === pushN) pos.z = c.z0 - r;
    else pos.z = c.z1 + r;
  }
}

/** Ray vs one AABB (slab test). Returns the distance t, or Infinity. */
export function rayBox(ox, oy, oz, dx, dy, dz, b, maxT) {
  let tmin = 0;
  let tmax = maxT;
  // x
  let t1 = (b.x0 - ox) / dx;
  let t2 = (b.x1 - ox) / dx;
  if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
  tmin = Math.max(tmin, t1);
  tmax = Math.min(tmax, t2);
  if (tmin > tmax) return Infinity;
  // z
  t1 = (b.z0 - oz) / dz;
  t2 = (b.z1 - oz) / dz;
  if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
  tmin = Math.max(tmin, t1);
  tmax = Math.min(tmax, t2);
  if (tmin > tmax) return Infinity;
  // y (box spans 0..h)
  t1 = (0 - oy) / dy;
  t2 = (b.h - oy) / dy;
  if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
  tmin = Math.max(tmin, t1);
  tmax = Math.min(tmax, t2);
  if (tmin > tmax) return Infinity;
  return tmin;
}

/** True when the segment from a to b is not blocked by any collider. */
export function losClear(a, b, colliders) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.001) return true;
  const inv = 1 / len;
  for (let i = 0; i < colliders.length; i++) {
    const t = rayBox(a.x, a.y, a.z, dx * inv, dy * inv, dz * inv, colliders[i], len);
    if (t < len - 0.05) return false;
  }
  return true;
}

// ------------------------------------------------------------------ materials

const MAT = {};
function materials() {
  if (MAT.ground) return MAT;
  MAT.ground = new THREE.MeshStandardMaterial({ color: 0x3d3d48, roughness: 0.95, metalness: 0.05 });
  MAT.wall = new THREE.MeshStandardMaterial({ color: 0x3a3f52, roughness: 0.9, metalness: 0.1 });
  MAT.containerA = new THREE.MeshStandardMaterial({ color: 0xb5501f, roughness: 0.75, metalness: 0.35 });
  MAT.containerB = new THREE.MeshStandardMaterial({ color: 0x1f6f8b, roughness: 0.75, metalness: 0.35 });
  MAT.containerC = new THREE.MeshStandardMaterial({ color: 0x8a6d1f, roughness: 0.8, metalness: 0.3 });
  MAT.crate = new THREE.MeshStandardMaterial({ color: 0x6b5a3a, roughness: 0.9, metalness: 0.1 });
  MAT.pillar = new THREE.MeshStandardMaterial({ color: 0x4a4a58, roughness: 0.85, metalness: 0.15 });
  MAT.strip = new THREE.MeshStandardMaterial({ color: 0x332211, emissive: 0xff9a2a, emissiveIntensity: 2.2 });
  MAT.stripTeal = new THREE.MeshStandardMaterial({ color: 0x0a2a33, emissive: 0x2ad4c4, emissiveIntensity: 1.8 });
  MAT.lamp = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffb347, emissiveIntensity: 3 });
  MAT.skyline = new THREE.MeshStandardMaterial({ color: 0x141828, roughness: 1 });
  MAT.sun = new THREE.MeshBasicMaterial({ color: 0xff8c2a, fog: false });
  return MAT;
}

// ------------------------------------------------------------------ world

export function buildWorld(scene) {
  const M = materials();
  scene.background = new THREE.Color(0x1a2340);
  scene.fog = new THREE.Fog(0x1a2340, 35, 110);

  const colliders = [];
  const addBox = (x0, z0, x1, z1, h, mat, y0 = 0) => {
    const w = x1 - x0, d = z1 - z0;
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    colliders.push(box(x0, z0, x1, z1, y0 + h));
    return mesh;
  };

  // ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 110), M.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  // painted yard markings: two amber lane strips and a mid line
  const stripeGeo = new THREE.PlaneGeometry(56, 0.35);
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0x8a6d1f });
  for (const z of [-12, 12]) {
    const s = new THREE.Mesh(stripeGeo, stripeMat);
    s.rotation.x = -Math.PI / 2;
    s.position.set(0, 0.02, z);
    scene.add(s);
  }

  // perimeter walls (4m high)
  addBox(-31, -21, 31, -20, 4, M.wall);
  addBox(-31, 20, 31, 21, 4, M.wall);
  addBox(-31, -20, -30, 20, 4, M.wall);
  addBox(30, -20, 31, 20, 4, M.wall);

  // central structure: two containers + one on top (the Vault)
  addBox(-7, -4, -1, 4, 2.6, M.containerA);
  addBox(1, -4, 7, 4, 2.6, M.containerB);
  addBox(-4, -3.5, 4, 3.5, 2.6, M.containerC, 2.6);
  // emissive strips on the central structure
  const stripGeo = new THREE.BoxGeometry(0.15, 0.15, 8);
  for (const [x, z, mat] of [[-7.05, 0, M.strip], [7.05, 0, M.stripTeal]]) {
    const s = new THREE.Mesh(stripGeo, mat);
    s.position.set(x, 2.4, z);
    scene.add(s);
  }

  // lane obstacles (kept off the lane centrelines z=-12, 0, 12)
  addBox(-18, -16, -14, -13, 1.2, M.crate);          // low crate, north-west
  addBox(-8, -16, -4, -14, 3, M.wall);               // wall, north-mid
  addBox(10, -17, 16, -13, 2.6, M.containerB);       // container, north-east
  addBox(-16, 13, -10, 17, 2.6, M.containerA);       // container, south-west
  addBox(0, 13, 4, 16, 1.2, M.crate);                // low crates, south-mid
  addBox(8, 14, 12, 16, 3, M.wall);                  // wall, south-east
  addBox(-20, -2, -18, 2, 3, M.pillar);              // pillar, mid-west
  addBox(18, -2, 20, 2, 3, M.pillar);                // pillar, mid-east
  addBox(-24, -6, -21, -3, 1.2, M.crate);            // low crates, ember side
  addBox(21, 3, 24, 6, 1.2, M.crate);                // low crates, ash side
  addBox(-4, -9, 0, -7, 1.2, M.crate);               // low crate, north-mid
  addBox(2, 8, 6, 10, 1.2, M.crate);                 // low crate, south-mid

  // lamps on poles (visual + 2 point lights)
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 5, 6);
  const lampGeo = new THREE.SphereGeometry(0.22, 10, 8);
  for (const [x, z] of [[-12, -6], [12, 6]]) {
    const pole = new THREE.Mesh(poleGeo, M.pillar);
    pole.position.set(x, 2.5, z);
    scene.add(pole);
    const lamp = new THREE.Mesh(lampGeo, M.lamp);
    lamp.position.set(x, 5.1, z);
    scene.add(lamp);
  }
  const pl1 = new THREE.PointLight(0xffb347, 60, 30, 1.8);
  pl1.position.set(-12, 5, -6);
  scene.add(pl1);
  const pl2 = new THREE.PointLight(0xffb347, 60, 30, 1.8);
  pl2.position.set(12, 5, 6);
  scene.add(pl2);

  // low sun disc on the horizon + distant skyline silhouettes
  const sun = new THREE.Mesh(new THREE.CircleGeometry(6, 32), M.sun);
  sun.position.set(-60, 10, -45);
  sun.lookAt(0, 8, 0);
  scene.add(sun);
  const skyGeo = new THREE.BoxGeometry(8, 22, 8);
  for (const [x, z, h] of [[-45, -35, 22], [-20, -48, 30], [15, -45, 18], [45, -30, 26], [-48, 25, 20], [40, 35, 24]]) {
    const b = new THREE.Mesh(skyGeo, M.skyline);
    b.position.set(x, h / 2, z);
    b.scale.y = h / 22;
    scene.add(b);
  }

  // lights
  const hemi = new THREE.HemisphereLight(0x5a6aaa, 0x2e2418, 1.5);
  scene.add(hemi);
  const sunLight = new THREE.DirectionalLight(0xff9a4d, 2.9);
  sunLight.position.set(-35, 22, -18);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  sunLight.shadow.camera.left = -40;
  sunLight.shadow.camera.right = 40;
  sunLight.shadow.camera.top = 30;
  sunLight.shadow.camera.bottom = -30;
  sunLight.shadow.camera.far = 120;
  scene.add(sunLight);
  scene.add(sunLight.target);

  // waypoints: 3 lanes west->east, plus cover points for retreats
  const lanes = [
    [[-26, -12], [-18, -12], [-10, -12], [-2, -12], [6, -12], [14, -12], [22, -12], [26, -12]],
    [[-26, 0], [-22, 4], [-14, 5], [-10, 5], [10, 5], [14, 5], [22, 4], [26, 0]],
    [[-26, 12], [-18, 12], [-10, 12], [-2, 12], [6, 12], [14, 12], [22, 12], [26, 12]],
  ];
  const coverPoints = [
    [-12, -9], [12, -9], [-12, 9], [12, 9],
    [-22, -8], [22, -8], [-22, 6], [22, 8],
  ];
  const spawns = {
    ember: [{ x: -26, z: -8 }, { x: -26, z: 0 }, { x: -26, z: 8 }],
    ash: [{ x: 26, z: -12 }, { x: 26, z: -4 }, { x: 26, z: 4 }, { x: 26, z: 12 }],
  };
  return { colliders, lanes, coverPoints, spawns };
}

// ------------------------------------------------------------------ fighters

const TEAM_COLOR = { ember: 0xff7a1a, ash: 0x7fb3d5 };
const TEAM_DARK = { ember: 0x7a3a08, ash: 0x2a4a5a };

/** Build a fighter's visible body: capsule torso, head sphere, gun box. */
export function buildFighterMesh(team) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: TEAM_COLOR[team], roughness: 0.6, metalness: 0.2 });
  const darkMat = new THREE.MeshStandardMaterial({ color: TEAM_DARK[team], roughness: 0.7, metalness: 0.2 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.7, 6, 12), bodyMat);
  body.position.y = 0.95;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), darkMat);
  head.position.y = 1.58;
  head.castShadow = true;
  g.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.1), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: team === 'ember' ? 0xff7a1a : 0x7fb3d5, emissiveIntensity: 1.2 }));
  visor.position.set(0, 1.6, 0.18);
  g.add(visor);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.6), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.7 }));
  gun.position.set(0.28, 1.05, 0.35);
  g.add(gun);
  g.userData = { body, head, gun, bodyMat, darkMat };
  return g;
}

/** A first-person viewmodel gun, attached to the camera. */
export function buildViewmodel() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.35, metalness: 0.8 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xb3540f, roughness: 0.5, metalness: 0.4, emissive: 0xff7a1a, emissiveIntensity: 0.15 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.5), dark);
  g.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.38);
  g.add(barrel);
  // A thin ember accent strip along the top, not a full-width slab.
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.24), accent);
  strip.position.set(0, 0.08, -0.05);
  g.add(strip);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.02), accent);
  sight.position.set(0, 0.09, -0.32);
  g.add(sight);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.1), dark);
  grip.position.set(0, -0.15, 0.16);
  grip.rotation.x = 0.35;
  g.add(grip);
  g.position.set(0.26, -0.3, -0.55);
  g.rotation.y = -0.06;
  return g;
}
