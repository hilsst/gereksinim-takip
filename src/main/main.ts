import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } from 'electron';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildWorkbook } from '../shared/excel';
import { applyEvents, buildRequests, DONE_DIR, IN_DIR, OUT_DIR, type FlowEvent } from '../shared/flow';
import { pullCompletions, pushAssignments } from '../shared/planner';
import { SCHEMA, type Member } from '../shared/model';
import type { Project } from '../shared/types';
import * as ai from './ai';
import { Graph } from './graph';
import { SUPPORTED } from './sources';
import { checkForUpdates, initUpdater, installNow, type UpdateStatus } from './updater';

const APP = 'Gereksinim Takip';
const EXT = 'greq';
let win: BrowserWindow | null = null;
let dirty = false;
let forceClose = false;

const userFile = (name: string) => path.join(app.getPath('userData'), name);
const RECOVERY = () => userFile('recovery.greq.json');
const CONFIG = () => userFile('config.json');

interface Config {
  apiKeyEnc?: string;
  recent?: string[];
  lastFlowFolder?: string;
  /** Projeler arası kayıtlı ekip (e-postaya göre tekil). */
  team?: Member[];
}

function readConfig(): Config {
  try {
    return JSON.parse(fssync.readFileSync(CONFIG(), 'utf8')) as Config;
  } catch {
    return {};
  }
}
function writeConfig(c: Config) {
  fssync.mkdirSync(path.dirname(CONFIG()), { recursive: true });
  fssync.writeFileSync(CONFIG(), JSON.stringify(c, null, 2));
}
function apiKey(): string {
  const c = readConfig();
  if (!c.apiKeyEnc) return '';
  try {
    const buf = Buffer.from(c.apiKeyEnc, 'base64');
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
  } catch {
    return '';
  }
}
function addRecent(file: string) {
  const c = readConfig();
  c.recent = [file, ...(c.recent ?? []).filter((f) => f !== file)].slice(0, 8);
  writeConfig(c);
}

function send(channel: string, ...args: unknown[]) {
  win?.webContents.send(channel, ...args);
}
const sendUpdate = (s: UpdateStatus) => send('update', s);

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1080,
    minHeight: 660,
    title: APP,
    backgroundColor: '#f6f4fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  win.on('close', (e) => {
    if (!dirty || forceClose) return;
    const r = dialog.showMessageBoxSync(win!, {
      type: 'warning',
      buttons: ['Kaydet ve çık', 'Kaydetmeden çık', 'Vazgeç'],
      defaultId: 0,
      cancelId: 2,
      title: 'Kaydedilmemiş değişiklikler',
      message: 'Projede kaydedilmemiş değişiklikler var.',
      detail: 'Çıkmadan önce kaydetmek ister misiniz?',
    });
    if (r === 2) e.preventDefault();
    else if (r === 0) {
      e.preventDefault();
      send('menu', 'save-and-quit');
    } else {
      fssync.rmSync(RECOVERY(), { force: true });
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function buildMenu() {
  const m = (id: string) => () => send('menu', id);
  const tpl: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Dosya',
      submenu: [
        { label: 'Yeni Proje', accelerator: 'CmdOrCtrl+N', click: m('new') },
        { label: 'Aç…', accelerator: 'CmdOrCtrl+O', click: m('open') },
        { label: 'Kaydet', accelerator: 'CmdOrCtrl+S', click: m('save') },
        { label: 'Farklı Kaydet…', accelerator: 'CmdOrCtrl+Shift+S', click: m('saveAs') },
        { type: 'separator' },
        { label: 'Excel Raporu…', accelerator: 'CmdOrCtrl+E', click: m('export') },
        { label: 'Örnek Proje Yükle', click: m('sample') },
        { type: 'separator' },
        { role: 'quit', label: 'Çıkış' },
      ],
    },
    {
      label: 'Düzen',
      submenu: [
        { label: 'Geri Al', accelerator: 'CmdOrCtrl+Z', click: m('undo') },
        { label: 'Yinele', accelerator: 'CmdOrCtrl+Y', click: m('redo') },
        { type: 'separator' },
        { role: 'cut', label: 'Kes' },
        { role: 'copy', label: 'Kopyala' },
        { role: 'paste', label: 'Yapıştır' },
        { role: 'selectAll', label: 'Tümünü Seç' },
      ],
    },
    {
      label: 'Görünüm',
      submenu: [
        { role: 'reload', label: 'Yenile' },
        { role: 'toggleDevTools', label: 'Geliştirici Araçları' },
        { type: 'separator' },
        { role: 'zoomIn', label: 'Yakınlaştır' },
        { role: 'zoomOut', label: 'Uzaklaştır' },
        { role: 'resetZoom', label: 'Gerçek Boyut' },
        { role: 'togglefullscreen', label: 'Tam Ekran' },
      ],
    },
    {
      label: 'Yardım',
      submenu: [
        { label: 'Güncellemeleri Denetle', click: () => checkForUpdates(true, sendUpdate) },
        { type: 'separator' },
        { label: 'Hakkında', click: () => dialog.showMessageBox(win!, { title: APP, message: `${APP} ${app.getVersion()}`, detail: 'Dokümanlardan gereksinim listesi, atama ve Teams Planner takibi.' }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

const FILTERS = [{ name: 'Gereksinim Takip Projesi', extensions: [EXT] }, { name: 'JSON', extensions: ['json'] }];

// ---------- Planner: aynı istemci kimliği için tek Graph nesnesi
let graph: Graph | null = null;
function graphFor(cfg: { clientId: string; tenantId: string }): Graph {
  if (!cfg.clientId) throw new Error('Planner ayarlarında Uygulama (client) ID boş.');
  if (!graph || !graph.sameAs(cfg)) graph = new Graph(cfg, userFile('msal-cache.bin'));
  return graph;
}

function registerIpc() {
  ipcMain.handle('project:open', async (_e, file?: string) => {
    let target = file;
    if (!target) {
      const r = await dialog.showOpenDialog(win!, { filters: FILTERS, properties: ['openFile'] });
      if (r.canceled || !r.filePaths[0]) return null;
      target = r.filePaths[0];
    }
    const text = await fs.readFile(target, 'utf8');
    const data = JSON.parse(text) as Project;
    addRecent(target);
    // Eski şemalı dosya ilk kayıtta dönüşür; dönüşmeden önceki hâli yanında yedek olarak kalır
    let backup: string | undefined;
    if ((data.schema as string) !== SCHEMA) {
      backup = target.replace(/\.greq$/i, '') + '.sema1-yedek.greq';
      if (!fssync.existsSync(backup)) await fs.copyFile(target, backup);
    }
    return { path: target, data, backup };
  });
  ipcMain.handle('app:user', () => {
    try {
      return os.userInfo().username;
    } catch {
      return process.env.USERNAME ?? process.env.USER ?? '';
    }
  });
  ipcMain.handle('project:save', async (_e, args: { path?: string; data: Project; saveAs?: boolean }) => {
    let target = args.path;
    if (!target || args.saveAs) {
      const base = args.data.meta.partNumber || args.data.meta.name || 'Gereksinimler';
      const r = await dialog.showSaveDialog(win!, { defaultPath: `${base}.${EXT}`.replace(/\s+/g, '_'), filters: FILTERS });
      if (r.canceled || !r.filePath) return null;
      target = r.filePath;
    }
    // Ortak alanda yarım yazılmış dosya kalmasın: önce geçici dosya, sonra yeniden adlandır.
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(args.data, null, 2), 'utf8');
    await fs.rename(tmp, target);
    addRecent(target);
    await fs.rm(RECOVERY(), { force: true });
    return target;
  });
  ipcMain.handle('project:recent', () => (readConfig().recent ?? []).filter((f) => fssync.existsSync(f)));
  ipcMain.handle('project:recovery', async () => {
    try {
      return JSON.parse(await fs.readFile(RECOVERY(), 'utf8')) as { path?: string; data: Project; at: string };
    } catch {
      return null;
    }
  });
  ipcMain.handle('project:autosave', async (_e, payload: { path?: string; data: Project }) => {
    await fs.mkdir(path.dirname(RECOVERY()), { recursive: true });
    await fs.writeFile(RECOVERY(), JSON.stringify({ ...payload, at: new Date().toISOString() }), 'utf8');
  });
  ipcMain.handle('project:discardRecovery', () => fs.rm(RECOVERY(), { force: true }));
  ipcMain.on('project:dirty', (_e, v: boolean) => {
    dirty = v;
    win?.setTitle(`${APP}${v ? ' •' : ''}`);
  });
  ipcMain.on('update:check', () => checkForUpdates(true, sendUpdate));
  ipcMain.on('update:install', () => installNow());
  ipcMain.on('app:quit', () => {
    forceClose = true;
    win?.close();
  });

  ipcMain.handle('excel:export', async (_e, data: Project) => {
    const base = `${data.meta.partNumber || data.meta.name || 'Gereksinim'}_Rapor_${new Date().toISOString().slice(0, 10)}`.replace(/\s+/g, '_');
    const r = await dialog.showSaveDialog(win!, { defaultPath: `${base}.xlsx`, filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (r.canceled || !r.filePath) return null;
    await fs.writeFile(r.filePath, await buildWorkbook(data));
    return r.filePath;
  });
  ipcMain.handle('file:pick', async (_e, opts?: { multi?: boolean }) => {
    const r = await dialog.showOpenDialog(win!, {
      properties: opts?.multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: 'Dokümanlar', extensions: SUPPORTED }, { name: 'Tüm dosyalar', extensions: ['*'] }],
    });
    if (r.canceled) return [];
    return r.filePaths.map((p) => ({ path: p, name: path.basename(p) }));
  });
  ipcMain.handle('file:open', (_e, p: string) => shell.openPath(p));

  ipcMain.handle('ai:status', () => ({ configured: !!apiKey() || !!process.env.ANTHROPIC_API_KEY, fromEnv: !apiKey() && !!process.env.ANTHROPIC_API_KEY }));
  ipcMain.handle('ai:setKey', (_e, key: string) => {
    const c = readConfig();
    if (!key) delete c.apiKeyEnc;
    else c.apiKeyEnc = (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key) : Buffer.from(key, 'utf8')).toString('base64');
    writeConfig(c);
    return true;
  });

  const wrap = <A,>(fn: (a: A) => Promise<unknown>) => async (_e: unknown, a: A) => {
    try {
      return { ok: true, data: await fn(a) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
  ipcMain.handle('ai:requirements', wrap((a: Parameters<typeof ai.extractRequirements>[1]) => ai.extractRequirements({ apiKey: apiKey() }, a)));

  type Cfg = { clientId: string; tenantId: string };
  ipcMain.handle('planner:status', wrap(async (cfg: Cfg) => {
    if (!cfg.clientId) return { account: null };
    const a = await graphFor(cfg).account();
    return { account: a ? { name: a.name ?? '', username: a.username } : null };
  }));
  ipcMain.handle('planner:signIn', wrap(async (cfg: Cfg) => {
    const a = await graphFor(cfg).signIn();
    return { name: a.name ?? '', username: a.username };
  }));
  ipcMain.handle('planner:signOut', wrap(async (cfg: Cfg) => graphFor(cfg).signOut()));
  ipcMain.handle('planner:plans', wrap(async (cfg: Cfg) => {
    const plans = await graphFor(cfg).list<{ id: string; title: string; owner: string }>('/me/planner/plans');
    return plans.map((p) => ({ id: p.id, title: p.title }));
  }));
  ipcMain.handle('planner:push', wrap(async (a: { project: Project; ids: string[] }) => pushAssignments(graphFor(a.project.planner), a.project, a.ids)));
  ipcMain.handle('planner:pull', wrap(async (a: { project: Project }) => pullCompletions(graphFor(a.project.planner), a.project)));

  // ---------- Power Automate modu (klasör alışverişi)
  const flowDirs = async (root: string) => {
    if (!root) throw new Error('Planner ekranında Power Automate klasörünü seçin.');
    if (!fssync.existsSync(root)) throw new Error(`Klasör bulunamadı: ${root}. OneDrive/SharePoint senkronunun açık olduğunu kontrol edin.`);
    const dirs = { out: path.join(root, OUT_DIR), in: path.join(root, IN_DIR), done: path.join(root, IN_DIR, DONE_DIR) };
    for (const d of Object.values(dirs)) await fs.mkdir(d, { recursive: true });
    return dirs;
  };
  ipcMain.handle('flow:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'OneDrive / SharePoint ile senkron klasör', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    await flowDirs(r.filePaths[0]);
    writeConfig({ ...readConfig(), lastFlowFolder: r.filePaths[0] });
    return r.filePaths[0];
  });
  ipcMain.handle('team:get', () => readConfig().team ?? []);
  ipcMain.handle('team:save', (_e, members: Member[]) => {
    const c = readConfig();
    const team = new Map((c.team ?? []).map((x) => [x.email.toLowerCase(), x]));
    for (const m of members) if (m.email?.trim() && m.name?.trim()) team.set(m.email.trim().toLowerCase(), { name: m.name.trim(), email: m.email.trim(), discipline: m.discipline ?? '' });
    writeConfig({ ...c, team: [...team.values()].sort((a, b) => a.name.localeCompare(b.name, 'tr')) });
  });
  ipcMain.handle('flow:lastFolder', () => {
    const f = readConfig().lastFlowFolder;
    return f && fssync.existsSync(f) ? f : null;
  });
  ipcMain.handle('flow:status', wrap(async (root: string) => {
    const d = await flowDirs(root);
    const count = async (dir: string) => (await fs.readdir(dir)).filter((f) => f.toLowerCase().endsWith('.json')).length;
    return { waitingOut: await count(d.out), waitingIn: await count(d.in) };
  }));
  ipcMain.handle('flow:push', wrap(async (a: { project: Project; ids: string[] }) => {
    const d = await flowDirs(a.project.planner.flowFolder);
    const { files, result } = buildRequests(a.project, a.ids);
    // Doğrudan .json yazılır: OneDrive istemcisi dosyayı kapandıktan sonra yükler, akış tetikleyicisi yeniden adlandırmayı görmez.
    for (const f of files) await fs.writeFile(path.join(d.out, f.name), f.content, 'utf8');
    return result;
  }));
  ipcMain.handle('flow:pull', wrap(async (a: { project: Project }) => {
    const d = await flowDirs(a.project.planner.flowFolder);
    const names = (await fs.readdir(d.in)).filter((f) => f.toLowerCase().endsWith('.json'));
    const events: { name: string; event: FlowEvent | null; error?: string }[] = [];
    for (const name of names) {
      try {
        const text = (await fs.readFile(path.join(d.in, name), 'utf8')).replace(/^\uFEFF/, '');
        events.push({ name, event: JSON.parse(text) as FlowEvent });
      } catch (e) {
        events.push({ name, event: null, error: e instanceof Error ? e.message : String(e) });
      }
    }
    const result = applyEvents(a.project, events);
    const keep = new Set(result.keep);
    for (const name of names.filter((n) => !keep.has(n))) await fs.rename(path.join(d.in, name), path.join(d.done, name)).catch(() => undefined);
    return result;
  }));
}

app.whenReady().then(() => {
  registerIpc();
  buildMenu();
  createWindow();
  win!.webContents.once('did-finish-load', () => initUpdater(sendUpdate));
  const fileArg = process.argv.find((a) => a.endsWith(`.${EXT}`));
  if (fileArg) win!.webContents.once('did-finish-load', () => send('open-file', path.resolve(fileArg)));
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
