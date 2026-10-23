// Electron uçtan uca duman testi: örnek proje, ekranlar, toplu atama, Excel raporu.
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const out = process.argv[2] || path.join(os.tmpdir(), 'gt-shots');
fs.mkdirSync(out, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ud-'));
const exe = process.env.GT_EXE;
const app = await electron.launch({ ...(exe ? { executablePath: exe } : {}), args: [...(exe ? [] : ['.']), `--user-data-dir=${userData}`, '--no-sandbox'], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(String(e)));
win.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await win.setViewportSize({ width: 1500, height: 900 });
const shot = (n) => win.screenshot({ path: path.join(out, `${n}.png`) });

await win.waitForSelector('.welcome');
await shot('01-karsilama');
await win.click('text=Örnek proje');
await win.waitForSelector('.tiles');
await shot('02-ozet');

const nav = (label) => win.click(`.side .nav:has-text("${label}")`);
await nav('Dokümanlar');
await win.waitForSelector('[data-row="DOC-001"]');
await shot('03-dokumanlar');

await nav('Gereksinimler');
await win.waitForSelector('[data-row="REQ-001"]');
await shot('04-gereksinimler');

// REQ-004 ve REQ-005'i toplu ata
for (const id of ['REQ-004', 'REQ-005']) await win.locator(`[data-row="${id}"] td.sticky-col.sel input`).check();
await win.click('.grid-toolbar >> text=Ata (2)');
await win.waitForSelector('.modal');
await win.locator('.modal select').first().selectOption('İmalat');
await win.locator('.modal input[type=date]').fill('2026-11-15');
await win.locator('.modal select').nth(1).selectOption('P-003');
await shot('05-atama');
await win.click('.modal-foot >> text=Ata');
await win.waitForSelector('.modal', { state: 'detached' });
const assigned = await win.locator('[data-row="REQ-005"] td.c-workStatus select').inputValue();
await shot('06-atandi');

await nav('Açık Konular');
await win.waitForSelector('[data-row="ISS-001"]');
await shot('07-acik-konular');

await nav('Ekip');
await win.waitForSelector('[data-row="P-001"]');
await shot('08-ekip');

// Power Automate modu: klasör seç → istek dosyası → akış sonucu → satır kapanır
const flowDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-flow-'));
await app.evaluate(({ dialog }, dir) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
}, flowDir);
await nav('Teams Planner');
await win.waitForSelector('text=Power Automate akışları');
await win.click('button:has-text("Klasör seç")');
await win.locator(".badge.b-mint", { hasText: flowDir }).waitFor();
await shot('09-planner-flow');
await nav('Gereksinimler');
await win.locator('[data-row="REQ-001"] td.sticky-col.sel input').check();
await win.click(".grid-toolbar >> text=Planner'a gönder");
await win.waitForSelector('[data-row="REQ-001"] td.c-planner >> text=Kuyrukta');
const outFiles = fs.readdirSync(path.join(flowDir, 'giden'));
const request = JSON.parse(fs.readFileSync(path.join(flowDir, 'giden', outFiles[0]), 'utf8'));
fs.writeFileSync(path.join(flowDir, 'gelen', 'olusturuldu_REQ-001.json'), JSON.stringify({ olay: 'olusturuldu', kayitId: 'REQ-001', gorevId: 'T-1' }));
fs.writeFileSync(path.join(flowDir, 'gelen', 'tamamlandi_T-1.json'), '\uFEFF' + JSON.stringify({ olay: 'tamamlandi', gorevId: 'T-1', baslik: request.baslik, aciklama: request.aciklama + 'Kütle 2.31 kg ölçüldü.', tamamlanmaTarihi: '2026-11-01T08:00:00Z' }));
await nav('Teams Planner');
await win.click('button:has-text("Şimdi kontrol et")');
await win.waitForSelector('.log >> text=kapatıldı');
await shot('09b-planner-log');
await nav('Gereksinimler');
await win.waitForSelector('[data-row="REQ-001"] td.c-workStatus');
const closedStatus = await win.locator('[data-row="REQ-001"] td.c-workStatus select').inputValue();
const closureNote = await win.locator('[data-row="REQ-001"] td.c-closureNote').innerText();
const processed = fs.readdirSync(path.join(flowDir, 'gelen', 'islenen')).length;
await shot('09c-kapandi');

await nav('Özet');
await win.waitForSelector('.people');
await shot('10-ozet-kisiler');

await win.click('text=⚙ Ayarlar');
await win.waitForSelector('.modal');
await shot('11-ayarlar');

await app.evaluate(({ app }) => app.exit(0));
const result = { assigned, outFiles, closedStatus, closureNote, processed, errors };
console.log(JSON.stringify(result, null, 2));
if (assigned !== 'Atandı' || outFiles.length !== 1 || closedStatus !== 'Kapandı' || !closureNote.includes('2.31') || processed !== 2 || errors.length) process.exit(1);
