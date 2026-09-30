import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { backupTo, NewerDatabaseError, openDatabase, type OpenedDatabase } from './db/database';
import { StudyService, UserError } from './service';
import type { ApiMethod, ApiResponse, AppInfo } from '../shared/types';

const APP_FOLDER = 'StudyPlanner';

/**
 * User data lives in %APPDATA%\StudyPlanner — outside the install and build folders,
 * so rebuilding or reinstalling the app always finds the same database.
 * Development runs (`npm run dev`) use a separate folder so experiments never touch real data.
 * STUDY_PLANNER_DATA_DIR overrides both.
 */
function resolveDataDir(): string {
  if (process.env.STUDY_PLANNER_DATA_DIR) return path.resolve(process.env.STUDY_PLANNER_DATA_DIR);
  return path.join(app.getPath('appData'), app.isPackaged ? APP_FOLDER : `${APP_FOLDER}-dev`);
}

const dataDir = resolveDataDir();
app.setPath('userData', path.join(dataDir, 'app-state'));
app.setAppUserModelId('ch.silvanmeier.studyplanner');
// en-GB: date pickers use day/month order, Monday-first calendars and 24-hour time.
app.commandLine.appendSwitch('lang', 'en-GB');

let opened: OpenedDatabase | null = null;
let service: StudyService | null = null;
let mainWindow: BrowserWindow | null = null;

function iconPath(): string | undefined {
  const candidates = [path.join(process.resourcesPath ?? '', 'icon.png'), path.join(__dirname, '../../build/icon.png')];
  return candidates.find((p) => fs.existsSync(p));
}

function appInfo(): AppInfo {
  return {
    version: app.getVersion(),
    dataDir,
    dbPath: opened!.dbPath,
    backupDir: opened!.backupDir,
    schemaVersion: opened!.schemaVersion,
    isDev: !app.isPackaged,
  };
}

// Methods implemented outside the service (need Electron APIs).
const appMethods: Partial<Record<ApiMethod, (...args: any[]) => unknown>> = {
  appInfo,
  createBackup: () => backupTo(opened!.db, opened!.backupDir, 'manual'),
  openDataFolder: () => void shell.openPath(dataDir),
};

// Service methods callable from the UI. Anything not listed here is rejected.
const serviceMethods: ApiMethod[] = [
  'listSemesters', 'createSemester', 'updateSemester', 'deleteSemester',
  'listSubjects', 'subjectOverview', 'createSubject', 'updateSubject', 'deleteSubject',
  'createLecture', 'updateLecture', 'getLecture', 'deleteLecture', 'setLectureCompleted',
  'getExercise', 'getSeries', 'createExercise', 'updateExercise', 'setExerciseStatus', 'setExerciseHandedIn', 'moveExercise',
  'deleteExercise', 'extendSeries', 'setChecklistItemDone',
  'getExam', 'createExam', 'updateExam', 'deleteExam',
  'getWeek', 'getOutstanding', 'getSemesterProgress', 'getToday',
  'listTrash', 'restoreTrash', 'purgeTrash', 'emptyTrash',
];

function registerIpc(): void {
  ipcMain.handle('api', (_event, method: ApiMethod, args: unknown[]): ApiResponse<unknown> => {
    try {
      let value: unknown;
      if (method in appMethods) value = appMethods[method]!(...args);
      else if (serviceMethods.includes(method)) value = (service as any)[method](...args);
      else throw new Error(`Unknown API method: ${String(method)}`);
      return { ok: true, value };
    } catch (err) {
      const userError = err instanceof UserError;
      if (!userError) console.error(`[api] ${method} failed:`, err);
      return { ok: false, error: err instanceof Error ? err.message : String(err), userError };
    }
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Study Planner',
    icon: iconPath(),
    backgroundColor: '#12141b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

function openDb(): boolean {
  try {
    opened = openDatabase(dataDir, { dailyBackup: true });
    service = new StudyService(opened.db);
    if (opened.integrityProblem) {
      dialog.showMessageBoxSync({
        type: 'warning',
        title: 'Study Planner',
        message: 'The database integrity check reported a problem.',
        detail: `${opened.integrityProblem}\n\nYour data was not changed. Backups are in:\n${opened.backupDir}`,
      });
    }
    return true;
  } catch (err) {
    const detail =
      err instanceof NewerDatabaseError
        ? err.message
        : `${err instanceof Error ? err.message : String(err)}\n\nYour existing data was not modified. Database folder:\n${dataDir}`;
    dialog.showErrorBox('Study Planner could not open its database', detail);
    return false;
  }
}

if (!app.requestSingleInstanceLock()) {
  // Only one instance may write to the database.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    // Dark title bar, dropdowns and scrollbars to match the app's dark theme.
    nativeTheme.themeSource = 'dark';
    if (!openDb()) {
      app.quit();
      return;
    }
    registerIpc();
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());

  app.on('will-quit', () => {
    try {
      opened?.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      opened?.db.close();
    } catch {
      // Closing is best-effort; SQLite's WAL keeps committed data safe regardless.
    }
  });
}
