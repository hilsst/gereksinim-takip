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

await nav('Teams Planner');
await win.waitForSelector('text=İlk kurulum');
await shot('09-planner');

await nav('Özet');
await win.waitForSelector('.people');
await shot('10-ozet-kisiler');

await win.click('text=⚙ Ayarlar');
await win.waitForSelector('.modal');
await shot('11-ayarlar');

await app.evaluate(({ app }) => app.exit(0));
const result = { assigned, errors };
console.log(JSON.stringify(result, null, 2));
if (assigned !== 'Atandı' || errors.length) process.exit(1);
