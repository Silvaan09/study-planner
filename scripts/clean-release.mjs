// Runs after a successful `npm run dist`: removes installers (and their blockmaps) of other
// versions from release/, so only the installer for the current package.json version remains.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const releaseDir = path.join(root, 'release');
const current = `Setup ${version}.exe`;

if (!fs.existsSync(path.join(releaseDir, `Study Planner ${current}`))) {
  console.error(`clean-release: installer for ${version} not found — leaving release/ untouched.`);
  process.exit(1);
}

for (const name of fs.readdirSync(releaseDir)) {
  const isInstaller = /Setup .+\.exe(\.blockmap)?$/.test(name);
  if (isInstaller && !name.includes(current)) {
    fs.rmSync(path.join(releaseDir, name), { force: true });
    console.log(`clean-release: removed old installer ${name}`);
  }
}
