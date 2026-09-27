// Claude Code Stop hook: keeps CLAUDE.md and CHANGELOG.md in step with the code.
// If source/config files changed after either doc was last updated, it blocks the stop once
// and asks Claude to update them (and bump the version). Prints nothing when docs are current.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.CLAUDE_PROJECT_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let input = {};
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
} catch {
  /* no stdin */
}
// Already continuing because of this hook: don't block again (prevents loops).
if (input.stop_hook_active) process.exit(0);

const WATCHED_DIRS = ['src', 'scripts', 'tests'];
const WATCHED_FILES = ['package.json', 'tsconfig.json', 'vite.config.mts', 'vitest.config.ts'];

function newest(p) {
  let st;
  try {
    st = fs.statSync(p);
  } catch {
    return { time: 0, file: null };
  }
  if (!st.isDirectory()) return { time: st.mtimeMs, file: p };
  let best = { time: 0, file: null };
  for (const name of fs.readdirSync(p)) {
    const r = newest(path.join(p, name));
    if (r.time > best.time) best = r;
  }
  return best;
}

let latest = { time: 0, file: null };
for (const rel of [...WATCHED_DIRS, ...WATCHED_FILES]) {
  const r = newest(path.join(root, rel));
  if (r.time > latest.time) latest = r;
}

const stale = ['CLAUDE.md', 'CHANGELOG.md'].filter((doc) => newest(path.join(root, doc)).time < latest.time);
if (stale.length === 0) process.exit(0);

const changed = path.relative(root, latest.file);
process.stdout.write(
  JSON.stringify({
    decision: 'block',
    reason:
      `Project files changed (latest: ${changed}) after ${stale.join(' and ')} was last updated. Before finishing: ` +
      'update CLAUDE.md so its overview (structure, data model, commands, rules) matches the code; ' +
      'bump the version in package.json per the versioning policy in CLAUDE.md (npm version <x.y.z> --no-git-tag-version) ' +
      'and add a matching CHANGELOG.md entry. If a doc is already accurate, say so briefly.',
  }),
);
