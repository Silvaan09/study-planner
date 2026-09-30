// Fills an EMPTY data folder with the demo semester (src/main/demoData.ts) for manual testing and screenshots:
//   npm run seed-demo -- <folder> [--today=YYYY-MM-DD]
// then launch with STUDY_PLANNER_DATA_DIR=<folder>. Refuses the real/dev data folders and any folder that already has a database.
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const todayArg = args.find((a) => a.startsWith('--today='))?.slice('--today='.length);

function fail(msg) {
  console.error(`seed-demo: ${msg}`);
  process.exit(1);
}

if (!target) fail('usage: npm run seed-demo -- <empty folder> [--today=YYYY-MM-DD]');
const dir = path.resolve(target);
const appData = process.env.APPDATA ? path.resolve(process.env.APPDATA) : null;
const protectedDirs = appData ? ['StudyPlanner', 'StudyPlanner-dev'].map((f) => path.join(appData, f).toLowerCase()) : [];
if (protectedDirs.includes(dir.toLowerCase())) fail(`refusing to write into the app's own data folder (${dir}).`);
if (fs.existsSync(path.join(dir, 'study-planner.db'))) fail(`${dir} already contains a database; use an empty folder.`);
if (todayArg && !/^\d{4}-\d{2}-\d{2}$/.test(todayArg)) fail('--today must be YYYY-MM-DD.');

// Bundle the TypeScript sources (service + demo data) into a temporary CommonJS file and load it.
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sp-seed-')), 'seed.cjs');
await build({
  stdin: {
    contents: `export { openDatabase } from './src/main/db/database';
export { StudyService } from './src/main/service';
export { seedDemo } from './src/main/demoData';
export { todayISO } from './src/shared/dates';`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  outfile: out,
  logLevel: 'warning',
});
const { openDatabase, StudyService, seedDemo, todayISO } = createRequire(import.meta.url)(out);

const opened = openDatabase(dir);
try {
  const today = todayArg ?? todayISO();
  const summary = seedDemo(new StudyService(opened.db), today);
  console.log(
    `Seeded ${opened.dbPath} (as of ${today}): ${summary.subjects} subjects, ${summary.lectures} weekly lectures, ${summary.exercises} exercises, ${summary.exams} exams.`,
  );
} finally {
  opened.db.close();
  fs.rmSync(path.dirname(out), { recursive: true, force: true });
}
