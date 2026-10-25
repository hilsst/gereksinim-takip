// Claude ile gereksinim ve açık konu çıkarma. Kurallar FMEA Studio V4.6 ile aynıdır:
// uydurma yok, eksik bilgi "VERİ YOK – doğrulanmalı", her satırda kaynak, öneriler "AI Proposed".
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MAX_PDF_WITH_IMAGES, type DrawingImage } from '../shared/raster';
import { fileBlocks } from './sources';

// Haiku: yüksek hacimli çıkarma işi için hızlı ve düşük maliyetli. Haiku'da sunucu tarafı yedek model (fallbacks) yoktur.
const MODEL = 'claude-haiku-5-5';

const SYSTEM = `Sen deneyimli bir sistem / tasarım / kalite mühendisisin (havacılık, savunma, otomotiv, raylı sistemler; kompozit ve mekanik ürünler). Görevin müşteri dokümanlarından doğrulanabilir bir gereksinim listesi çıkarmak.
Kesin kurallar:
- Hiçbir teknik bilgiyi uydurma: değer, tolerans, malzeme, proses parametresi, standart, müşteri gereksinimi veya kabul kriteri yazma; dokümanda yoksa "VERİ YOK – doğrulanmalı" yaz.
- Varsayım yapmak zorundaysan metne "AI VARSAYIMI – mühendislik doğrulaması gerekli" ekle; öneriler "AI RECOMMENDATION" olarak işaretlenir.
- Her gereksinim tek, doğrulanabilir bir ifade olsun ("shall / -malıdır"). Birleşik cümleleri ayrı gereksinimlere böl.
- Her satıra kaynak ver (doküman ID/no, sayfa, bölüm, ölçü/balon no, e-posta tarihi/göndereni). Kaynak yoksa boş bırak.
- Her gereksinim için kanıt yöntemini belirt: evidenceType listeden seçilir; evidence alanına kanıtın somut biçimini yaz (ör. "CMM ölçüm raporu, balon 12–15", "Tuz sisi test raporu ISO 9227", "CATIA model ölçüsü ekran görüntüsü", "Malzeme sertifikası EN 10204 3.1"). Doküman bir doğrulama yöntemi belirtiyorsa onu kullan; belirtmiyorsa öneri yap ve sonuna "(AI RECOMMENDATION)" ekle.
- Gereksinimi yerine getirecek disiplini öner: Tasarım (geometri, malzeme, performans, arayüz), Konfigürasyon (parça no, revizyon, varyant, doküman/etiketleme, teslimat içeriği), İmalat (proses, yüzey işlem, muayene, ambalaj).
- Güven (confidence) değerini dürüst ver: dokümandan doğrudan çıkmayanlar Medium/Low.
- Dokümandan çıkarılamayan ama kritik olabilecek konuları, çelişkileri (iki kaynak farklı değer veriyor), belirsiz ifadeleri ("uygun", "yeterli", "mümkün olduğunca") ve eksik kabul kriterlerini gereksinim gibi yazma; "issues" listesine açık mühendislik konusu olarak ekle (Critical / Important / Optional).
- Metinleri Türkçe yaz; teknik terimler İngilizce kalabilir.`;

export interface AiConfig {
  apiKey: string;
}

function client(cfg: AiConfig) {
  if (!cfg.apiKey && !process.env.ANTHROPIC_API_KEY) throw new Error('Claude API anahtarı tanımlı değil. Ayarlar → AI bölümünden girin.');
  return new Anthropic(cfg.apiKey ? { apiKey: cfg.apiKey } : {});
}

type Json = Record<string, unknown>;
const str = { type: 'string' };
const en = (values: string[]) => ({ type: 'string', enum: values });
function obj(props: Record<string, unknown>): Json {
  return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false };
}

export const REQ_SCHEMA = obj({
  requirements: {
    type: 'array',
    items: obj({
      text: str,
      reqType: str,
      acceptance: str,
      evidenceType: en(['Ölçüm', 'Test', 'Analiz', 'Muayene', 'Model kontrolü', 'Doküman incelemesi', 'Benzerlik', 'Sertifika']),
      evidence: str,
      discipline: en(['Tasarım', 'Konfigürasyon', 'İmalat']),
      source: str,
      confidence: en(['High', 'Medium', 'Low']),
    }),
  },
  issues: {
    type: 'array',
    items: obj({ description: str, priority: en(['Critical', 'Important', 'Optional']), source: str, risk: str, recommendedAction: str, relatedReq: str }),
  },
});

let current: AbortController | null = null;

/** Süren AI isteğini iptal eder. */
export function cancel() {
  current?.abort();
}

async function ask(cfg: AiConfig, content: Anthropic.ContentBlockParam[], schema: Json): Promise<Json> {
  const ctrl = new AbortController();
  current = ctrl;
  let res: Anthropic.Message;
  try {
    // Uzun girdilerde (çok sayıda resim bölgesi) zaman aşımına düşmemek için akışla alınır.
    res = await client(cfg).messages.stream({
      model: MODEL,
      max_tokens: 32000,
      system: SYSTEM,
      output_config: { effort: 'high', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content }],
    }, { timeout: 15 * 60 * 1000, signal: ctrl.signal }).finalMessage();
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error('İşlem iptal edildi.');
    if (e instanceof Anthropic.APIError) throw new Error(`Claude API hatası (${e.status ?? 'bağlantı'}): ${e.message}`);
    throw e;
  } finally {
    if (current === ctrl) current = null;
  }
  if (res.stop_reason === 'refusal') throw new Error('Claude bu isteği yanıtlamadı (refusal). İçeriği gözden geçirip tekrar deneyin.');
  if (res.stop_reason === 'max_tokens') throw new Error('Yanıt çok uzun olduğu için kesildi. Dokümanı bölümlere ayırıp tekrar deneyin.');
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  return JSON.parse(text) as Json;
}

const DRAWING = `Bu bir teknik resim. Görüntüler her sayfanın önce küçültülmüş genel görünümünü, ardından okunabilir çözünürlükte örtüşen bölgelerini içerir (bölge adı ve sayfadaki yüzde konumu görüntünün önünde yazar). Bölgeler örtüştüğü için aynı ölçüyü iki kez yazma. DXF/DWG çizimlerde ayrıca dosyadan okunmuş ölçü ve yazı listesi verilir; değerler için öncelikle bu listeye güven, görüntüyü bağlam (hangi görünüş, hangi detay) için kullan.
Teknik resimden şunları gereksinim olarak çıkar:
- Toleranslı ve kritik ölçüler (tolerans, uyum sınıfı ör. H7, ± değerleri ile birlikte), temel ölçüler, kritik/özel karakteristik işaretli ölçüler.
- Geometrik toleranslar (GD&T çerçeveleri ve referans düzlemleri/datumlar).
- Yüzey pürüzlülüğü, kenar kırma, çapak, genel tolerans standardı (ör. ISO 2768-mK).
- Malzeme, ısıl işlem, yüzey işlem/kaplama/boya, sertlik.
- Genel ve özel notlar (her not maddesi ayrı gereksinim), işaretleme/etiketleme, kaynak/perçin sembolleri.
- Antet bilgileri: parça no, revizyon, malzeme, kütle, ölçek, standartlar — konfigürasyon gereksinimi olarak.
Kaynağa sayfa ve bölgeyi yaz (ör. "Sayfa 1 / Bölge B3 / Not 4" veya "Antet"). Bulanık ya da okunamayan değeri tahmin etme; "VERİ YOK – doğrulanmalı" yaz ve issues listesine "okunamayan ölçü" olarak ekle.`;

const RASTER_ONLY = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff'];

export async function extractRequirements(cfg: AiConfig, input: { filePath?: string; text?: string; images?: DrawingImage[]; drawing?: boolean; docId: string; docLabel: string; existing: string[] }) {
  const content: Anthropic.ContentBlockParam[] = [];
  const images = input.images ?? [];
  if (input.filePath) {
    const ext = path.extname(input.filePath).toLowerCase();
    const name = path.basename(input.filePath);
    if (images.length && RASTER_ONLY.includes(ext)) content.push({ type: 'text', text: `Görsel dosya: ${name}` });
    else if (images.length && ext === '.pdf' && (await fs.stat(input.filePath)).size > MAX_PDF_WITH_IMAGES) content.push({ type: 'text', text: `PDF dosyası: ${name} (dosya büyük olduğu için yalnızca sayfa görüntüleri gönderildi)` });
    else content.push(...(await fileBlocks(input.filePath)));
  }
  for (const img of images) {
    content.push({ type: 'text', text: img.label });
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
  }
  if (input.text) content.push({ type: 'text', text: input.text });
  if (input.drawing || images.length) content.push({ type: 'text', text: DRAWING });
  content.push({
    type: 'text',
    text: `Bu doküman ${input.docId} (${input.docLabel}) olarak kayıtlı. Dokümanı analiz et ve gereksinim listesi çıkar.
Her gereksinimin kaynağını "${input.docId} / Sayfa x / Bölüm y / Ölçü z" biçiminde ver (e-postada: "${input.docId} / <tarih> / <gönderen>").
Tip listesi: Functional, Performance, Dimensional, Material, Structural, Environmental, Safety, Reliability, Interface, Manufacturing, Inspection, Regulatory, Customer-specific, Configuration.
Kabul kriteri dokümanda yoksa "VERİ YOK – doğrulanmalı" yaz. Çelişkileri, belirsizlikleri ve eksikleri issues listesine ekle; ilgili gereksinim varsa relatedReq alanına projedeki ID'sini yaz.
Projede zaten bulunan gereksinimler (tekrar etme; çelişki varsa issue aç):\n${input.existing.slice(0, 300).join('\n') || '(yok)'}`,
  });
  return ask(cfg, content, REQ_SCHEMA);
}
