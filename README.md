# Ember Line

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Lawlliet655/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Lawlliet655/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A tactical FPS in a dusk container yard, built for make.fun's
**threejs-fps-02** bounty ("Make the best three.js tactical FPS").

You and two Ember bots against four Ash bots. First team to **5 rounds**
takes the match. Win rounds, earn money, buy better guns — and watch the
corners: the bots walk lanes, hold angles and shoot back.

## Play it

No build step, no network. Serve the `game/` folder with any static
server and open it in a desktop browser with WebGL 2:

```sh
python3 -m http.server --directory game 8080
# then open http://localhost:8080
```

Or with Node:

```sh
npx --yes serve game
```

## Controls

- **Mouse**: aim · **Click**: shoot (hold for auto weapons)
- **W A S D**: move · **Space**: jump · **Shift**: aim steady
- **C**: crouch · **R**: reload · **G**: throw grenade
- **1 / 2 / 3**: switch weapon · **B**: buy menu (between rounds)
- **P**: pause · **M**: sound on/off

## The game

- **4 weapons**: P210 Sidearm (free), Spark SMG ($900), Ember Rifle ($2,100),
  Longshot sniper ($3,800) — plus Kevlar Armor ($650), frag grenades ($300)
  and ammo resupply ($200).
- **Economy**: $800 to start, $300 per round, $300 per kill, $800 per round
  win. Dying drops your bought primary weapon.
- **Bots**: one AI on both teams — they walk lanes, take cover when hurt,
  strafe while firing, reload, and shoot with a reaction delay and distance
  falloff, so they are dangerous but beatable.
- **Gunplay**: hitscan with headshots (2x damage), recoil and spread that
  punish firing on the move, crouching and standing still to tighten aim.
- **Rounds**: 100 seconds each; elimination wins, or the team with more
  fighters alive when the timer ends. First to 5 rounds takes the match.
- **Procedural everything**: the map is built from three.js geometry, all
  sounds are synthesized with WebAudio. No image, font or sound files.

## Files

- `game/index.html` — the page (import map for three.js 0.187.0); `game/style.css` — the HUD;
  `game/src/` — one file per job: `main.js` (boot + fixed-step loop), `state.js`
  (the one game state), `map.js` (arena + collision + waypoints), `player.js`
  (movement + camera), `bots.js` (bot AI), `weapons.js` (shooting + grenades),
  `rounds.js` (round flow + economy + buy), `audio.js` (procedural sounds),
  `hud.js` (HUD + menus), `effects.js` (tracers + flashes + particles).
- `game/vendor/three/` — three.js 0.187.0, byte for byte from the kit.
- `main.ts` — the entry program: copies `game/` and `screenshots/` to the
  output directory and writes `dossier.json` with the kit's `buildDossier`.
  Run it with `MAKEFUN_OUTPUT_DIR=out node main.ts`.
- `screenshots/` — real renders of the game running in a browser.
- `vendor/makefun-threejs.ts` — the kit's dossier library, unchanged.

<sub>Entered on [make.fun](https://make.fun/?ref=nzzqwttj&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
