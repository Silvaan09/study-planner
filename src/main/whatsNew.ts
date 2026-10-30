import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { changelogEntry, userFacingChangelog, type ReleaseNotes } from '../shared/releaseNotes';
// Bundled as text by esbuild (scripts/build-main.mjs), so the app always has its own changelog.
import CHANGELOG from '../../CHANGELOG.md';

/**
 * "What's new": the GitHub release text of the running version, shown once after it was installed. The text is fetched
 * when an update finishes downloading (so it is there offline on the next start) or on the first start of a version;
 * without either, the version's CHANGELOG.md entry is used. State in <dataDir>/app-state/whats-new.json.
 */
const REPO = 'Silvaan09/study-planner'; // same as build.publish in package.json
const RELEASES_URL = `https://github.com/${REPO}/releases`;
const KEEP_NOTES = 5;

interface Stored {
  /** The last version whose notes were shown (or skipped, on a fresh start without data). */
  seenVersion?: string;
  /** GitHub release texts by version. */
  notes?: Record<string, string>;
}

const stateFile = () => path.join(app.getPath('userData'), 'whats-new.json');

function read(): Stored {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
}

function write(s: Stored): void {
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(s));
  } catch (err) {
    console.error('[whats-new] could not save:', err);
  }
}

/** The release text (Markdown) of `version` on GitHub, or null (no release, no text, offline). */
async function fetchFromGitHub(version: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/v${version}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Study-Planner' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const body = (await res.json())?.body;
    return typeof body === 'string' && body.trim() ? body : null;
  } catch {
    return null;
  }
}

function store(version: string, notes: string): void {
  const s = read();
  const entries = Object.entries({ ...s.notes, [version]: notes }).slice(-KEEP_NOTES);
  write({ ...s, notes: Object.fromEntries(entries) });
}

/** Called when an update has been downloaded: keep its release text for the first start of that version. */
export async function rememberReleaseNotes(version: string): Promise<void> {
  const notes = await fetchFromGitHub(version);
  if (notes) store(version, notes);
}

/** The notes of the running version: stored or fetched GitHub text, else its CHANGELOG.md entry. */
export async function getReleaseNotes(): Promise<ReleaseNotes> {
  const version = app.getVersion();
  const url = `${RELEASES_URL}/tag/v${version}`;
  let notes = read().notes?.[version] ?? null;
  if (!notes) {
    notes = await fetchFromGitHub(version);
    if (notes) store(version, notes);
  }
  if (notes) return { version, notes, source: 'github', url };
  return { version, notes: userFacingChangelog(changelogEntry(CHANGELOG, version) ?? ''), source: 'changelog', url };
}

/** The running version's notes if they haven't been shown yet, else null. */
export async function getWhatsNew(): Promise<ReleaseNotes | null> {
  return read().seenVersion === app.getVersion() ? null : getReleaseNotes();
}

export function markWhatsNewSeen(): void {
  write({ ...read(), seenVersion: app.getVersion() });
}
