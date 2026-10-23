import { app } from 'electron';
import { autoUpdater } from 'electron-updater';

/**
 * Artımlı otomatik güncelleme (GitHub Releases + NSIS blockmap).
 * Yalnızca değişen bloklar indirilir; kurulum uygulama kapanırken yapılır.
 * Taşınabilir (portable) sürüm ve geliştirme modu güncellenmez.
 */
export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'none'; manual: boolean }
  | { state: 'available'; version: string }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string; manual: boolean }
  | { state: 'unsupported'; manual: boolean };

export function updatesSupported(): boolean {
  return app.isPackaged && process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_DIR;
}

let manual = false;
let busy = false;

export function initUpdater(send: (s: UpdateStatus) => void) {
  if (!updatesSupported()) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (i) => send({ state: 'available', version: i.version }));
  autoUpdater.on('update-not-available', () => {
    busy = false;
    send({ state: 'none', manual });
  });
  autoUpdater.on('update-downloaded', (i) => {
    busy = false;
    send({ state: 'downloaded', version: i.version });
  });
  autoUpdater.on('error', (e) => {
    busy = false;
    send({ state: 'error', message: e?.message ?? String(e), manual });
  });
  // Açılışta sessiz denetim; ağ yoksa yalnızca elle denetimde hata gösterilir
  setTimeout(() => checkForUpdates(false, send), 5000);
}

export function checkForUpdates(isManual: boolean, send: (s: UpdateStatus) => void) {
  if (!updatesSupported()) {
    send({ state: 'unsupported', manual: isManual });
    return;
  }
  if (busy) return;
  busy = true;
  manual = isManual;
  if (isManual) send({ state: 'checking' });
  autoUpdater.checkForUpdates().catch(() => undefined);
}

export function installNow() {
  if (updatesSupported()) autoUpdater.quitAndInstall();
}
