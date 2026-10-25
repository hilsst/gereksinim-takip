// Teknik resim uçtan uca testi: PDF / DXF / TIFF / PNG yüklenir, Claude API yerine yerel sahte sunucu
// kullanılır ve gönderilen içerik (görüntü bölgeleri, DXF metni) denetlenir.
// Kullanım: node tests/e2e/teknik-resim.mjs <çıktı klasörü> <dosya1> [dosya2 ...]
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const [outArg, ...files] = process.argv.slice(2);
const out = outArg || path.join(os.tmpdir(), 'gt-shots');
fs.mkdirSync(out, { recursive: true });
if (!files.length) throw new Error('Test edilecek dosya verin.');

const requests = [];
const reply = { requirements: [{ text: 'Plaka boyu 120 +0.2/-0.1 mm olmalıdır.', reqType: 'Dimensional', acceptance: '119.9–120.2 mm', evidenceType: 'Ölçüm', evidence: 'CMM raporu', discipline: 'Tasarım', source: 'test', confidence: 'High' }], issues: [] };
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    requests.push(JSON.parse(body));
    const text = JSON.stringify(reply);
    const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(
      ev('message_start', { message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'test', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }) +
        ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) +
        ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } }) +
        ev('content_block_stop', { index: 0 }) +
        ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } }) +
        ev('message_stop', {}),
    );
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ud-'));
const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`, '--no-sandbox'], env: { ...process.env, ANTHROPIC_API_KEY: 'test', ANTHROPIC_BASE_URL: base, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(String(e)));
win.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await win.setViewportSize({ width: 1500, height: 900 });

await win.waitForSelector('.welcome');
await win.click('text=Örnek proje');
await win.waitForSelector('.tiles');
await win.click('.side .nav:has-text("Dokümanlar")');

const results = [];
for (const f of files) {
  const abs = path.resolve(f);
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, abs);
  const before = requests.length;
  await win.click('button:has-text("Doküman yükle")');
  const done = await Promise.race([
    win.waitForSelector('.modal:has-text("Çıkarılan gereksinimleri")', { timeout: 120_000 }).then(() => 'öneri'),
    win.waitForSelector('.toast.err, .toast.warn', { timeout: 120_000 }).then(async (t) => `toast: ${await t.innerText()}`),
  ]);
  await win.screenshot({ path: path.join(out, `tr-${path.basename(f)}.png`) });
  const req = requests[before];
  const content = req?.messages?.[0]?.content ?? [];
  const imgs = content.filter((b) => b.type === 'image');
  const dir = path.join(out, path.basename(f));
  fs.mkdirSync(dir, { recursive: true });
  let label = '';
  let n = 0;
  for (const b of content) {
    if (b.type === 'text') label = b.text;
    if (b.type === 'image') fs.writeFileSync(path.join(dir, `${String(++n).padStart(2, '0')}-${label.replace(/[^\wğüşıöçĞÜŞİÖÇ%–-]+/g, '_').slice(0, 90)}.${b.source.media_type === 'image/png' ? 'png' : 'jpg'}`), Buffer.from(b.source.data, 'base64'));
  }
  const texts = content.filter((b) => b.type === 'text').map((b) => b.text);
  fs.writeFileSync(path.join(dir, 'metin.txt'), texts.join('\n\n----\n\n'));
  results.push({ file: path.basename(f), done, images: imgs.length, documents: content.filter((b) => b.type === 'document').length, bytes: JSON.stringify(req ?? {}).length, drawingPrompt: texts.some((t) => t.startsWith('Bu bir teknik resim')) });
  if (done === 'öneri') await win.click('.modal-foot button:has-text("Vazgeç")');
  await win.waitForSelector('.toast.err, .toast.warn', { state: 'detached', timeout: 15_000 }).catch(() => undefined);
}

console.log(JSON.stringify({ results, errors }, null, 2));
await app.evaluate(({ app }) => app.exit(0));
server.close();
if (errors.length || results.some((r) => r.done !== 'öneri' || !r.drawingPrompt)) process.exit(1);
