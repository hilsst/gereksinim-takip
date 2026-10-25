// Faz 1 uçtan uca testi: silindi işareti ve gerekçe, kalıcı numara, değişiklik geçmişi, şema 1 dosyasının yedeklenmesi.
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const out = process.argv[2] || path.join(os.tmpdir(), 'gt-shots');
fs.mkdirSync(out, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ud-'));
const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`, '--no-sandbox'], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(String(e)));
win.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await win.setViewportSize({ width: 1500, height: 900 });
const shot = (n) => win.screenshot({ path: path.join(out, `${n}.png`) });
const nav = (label) => win.click(`.side .nav:has-text("${label}")`);

await win.waitForSelector('.welcome');
await win.click('text=Örnek proje');
await win.waitForSelector('.tiles');
await nav('Gereksinimler');
await win.waitForSelector('[data-row="REQ-001"]');

// Alan değişikliği
const acc = win.locator('[data-row="REQ-001"] td.c-acceptance textarea');
await acc.fill('≤ 2.2 kg');
await acc.blur();

// Gerekçeli silme
await win.locator('[data-row="REQ-005"] td.sticky-col.sel input').check();
await win.click('.grid-toolbar >> text=Sil (1)');
await win.waitForSelector('.modal');
const disabledBefore = await win.locator('.modal-foot button:has-text("Sil")').isDisabled();
await win.locator('.modal textarea').fill('Müşteri e-postası ile kapsamdan çıkarıldı');
await shot('f1-01-silme');
await win.click('.modal-foot button:has-text("Sil")');
await win.waitForSelector('.modal', { state: 'detached' });
const hiddenAfterDelete = (await win.locator('[data-row="REQ-005"]').count()) === 0;

// Yeni satır silinen numarayı almaz
await win.click('.grid-toolbar >> text=+ Satır');
await win.waitForSelector('[data-row="REQ-006"]');

// Silinenler görünümü
await win.locator('label.check:has-text("Silinenler") input').check();
await win.waitForSelector('[data-row="REQ-005"].deleted');
await shot('f1-02-silinenler');
await win.locator('label.check:has-text("Silinenler") input').uncheck();

// Kayıt geçmişi
await win.locator('[data-row="REQ-001"] td.sticky-col.sel input').check();
await win.click('.grid-toolbar >> text=Geçmiş');
await win.waitForSelector('.modal .history');
const rowHistory = await win.locator('.modal .history tbody tr').allInnerTexts();
await shot('f1-03-kayit-gecmisi');
await win.click('.modal .x');

await nav('Geçmiş');
await win.waitForSelector('.history');
const allHistory = await win.locator('.history tbody tr').count();
await shot('f1-04-gecmis');

// Şema 1 dosyası açılınca yanında yedek oluşur
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-v1-'));
const v1 = path.join(dir, 'eski.greq');
fs.writeFileSync(v1, JSON.stringify({ schema: 'gereksinim-takip/1', meta: { name: 'Eski' }, requirements: [{ id: 'REQ-001', text: 'x', source: 'DOC-001 / s.2' }], issues: [], documents: [], people: [] }));
const opened = await win.evaluate((f) => window.api.openProject(f), v1);
const backupExists = !!opened?.backup && fs.existsSync(opened.backup);

await app.evaluate(({ app }) => app.exit(0));
const result = { disabledBefore, hiddenAfterDelete, rowHistory, allHistory, backup: opened?.backup, backupExists, errors };
console.log(JSON.stringify(result, null, 2));
const ok = disabledBefore && hiddenAfterDelete && rowHistory.some((t) => t.includes('2.2 kg')) && allHistory >= 3 && backupExists && !errors.length;
if (!ok) process.exit(1);
