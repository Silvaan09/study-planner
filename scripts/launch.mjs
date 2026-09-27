// Starts Electron with a clean environment. Some hosts (e.g. VS Code tooling) set
// ELECTRON_RUN_AS_NODE, which would make Electron behave like plain Node.
import { spawn } from 'node:child_process';
import electron from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const args = process.argv.slice(2);
const child = spawn(electron, args.length ? args : ['.'], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
