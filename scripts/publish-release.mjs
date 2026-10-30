// `npm run release`: publishes the installer built by `npm run dist` as a GitHub release (tag v<version>), with
// the files the auto-updater needs (latest.yml + blockmap) and the version's CHANGELOG.md entry as release notes.
// Needs the GitHub CLI, signed in (`gh auth login`). Run `npm run dist` first.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const release = path.join(root, 'release');
const installer = path.join(release, `Study-Planner-Setup-${version}.exe`);
const files = [installer, `${installer}.blockmap`, path.join(release, 'latest.yml')];

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

for (const f of files) if (!fs.existsSync(f)) fail(`${path.basename(f)} is missing. Run \`npm run dist\` first.`);
const latest = fs.readFileSync(files[2], 'utf8');
if (!latest.includes(`version: ${version}`)) fail(`release/latest.yml is not for ${version}. Run \`npm run dist\` again.`);

// The CHANGELOG entry "## <version> — <date>" up to the next "## ".
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const start = changelog.search(new RegExp(`^## ${version.replace(/\./g, '\\.')}\\b.*$`, 'm'));
if (start < 0) fail(`CHANGELOG.md has no entry for ${version}.`);
const body = changelog.slice(start).split('\n').slice(1);
const end = body.findIndex((l) => l.startsWith('## '));
// Without the points about the project ("Tests: …", "README: …"): the text is also the app's "What's new" dialog.
// Same rule as userFacingChangelog in src/shared/releaseNotes.ts.
const PROJECT_NOTE = /^- (Development|Tests|README|Docs|Claude config)\b[^:]*:/;
let skipping = false;
const notes = body
  .slice(0, end < 0 ? undefined : end)
  .filter((line) => {
    if (line.startsWith('- ')) skipping = PROJECT_NOTE.test(line);
    else if (!/^\s/.test(line)) skipping = false;
    return !skipping;
  })
  .join('\n')
  .trim();
const notesFile = path.join(os.tmpdir(), `study-planner-notes-${version}.md`);
fs.writeFileSync(notesFile, notes);

try {
  execFileSync('gh', ['release', 'create', `v${version}`, ...files, '--title', `Study Planner ${version}`, '--notes-file', notesFile], {
    cwd: root,
    stdio: 'inherit',
  });
} catch {
  fail('gh release create failed (see above). Is the GitHub CLI signed in (`gh auth login`)?');
} finally {
  fs.rmSync(notesFile, { force: true });
}
console.log(`release: published v${version}. Installed apps will pick it up within a few hours (or via Settings → Check for updates).`);
