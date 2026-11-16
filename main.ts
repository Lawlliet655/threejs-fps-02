// main.ts — the entry program for threejs-fps-02 (Node 22, standard library only).
// Copies game/ and screenshots/ from this repository to /output (or
// MAKEFUN_OUTPUT_DIR outside the grader) and writes /output/dossier.json with
// buildDossier from vendor/makefun-threejs.ts. Deterministic: the same input
// writes the same bytes.

import { buildDossier } from './vendor/makefun-threejs.ts';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoDir = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Start from a clean output directory so a second run writes the same bytes
// as the first (the grader runs this program twice). The output directory
// itself must NEVER be removed: in the grader /output is a mount point
// whose parent filesystem is read-only, so rmSync on it fails with EACCES
// and the whole run fails before it writes anything. Only its contents
// are cleared, never the directory itself.
mkdirSync(outDir, { recursive: true });
for (const entry of readdirSync(outDir)) {
  rmSync(join(outDir, entry), { recursive: true, force: true });
}

for (const name of ['game', 'screenshots']) {
  const src = join(repoDir, name);
  if (existsSync(src)) cpSync(src, join(outDir, name), { recursive: true });
}

const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);

const gameFiles = countFiles(join(outDir, 'game'));
const shotFiles = countFiles(join(outDir, 'screenshots'));
console.log(`Ember Line: ${gameFiles} game files, ${shotFiles} screenshots -> ${outDir}`);
console.log(`dossier.json: ${dossier.length} bytes`);

function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else n++;
    }
  };
  walk(dir);
  return n;
}
