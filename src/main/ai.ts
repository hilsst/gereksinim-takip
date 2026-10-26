// Claude ile gereksinim ve açık konu çıkarma. Kurallar FMEA Studio V4.6 ile aynıdır:
// uydurma yok, eksik bilgi "VERİ YOK – doğrulanmalı", her satırda kaynak, öneriler "AI Proposed".
import Anthropic from '@anthropic-ai/sdk';
import path from 'node:path';
import type { DrawingImage } from '../shared/raster';
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
  document: obj({ number: str, revision: str, title: str, sameAs: str }),
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

/** Süren AI işlemini (tüm aşamalarıyla) iptal eder. */
export function cancel() {
  current?.abort();
}

interface AskOpts {
  system?: string;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
  signal: AbortSignal;
}

async function ask(cfg: AiConfig, content: Anthropic.ContentBlockParam[], schema: Json, o: AskOpts): Promise<Json> {
  let res: Anthropic.Message;
  try {
    // Uzun girdilerde zaman aşımına düşmemek için akışla alınır.
    res = await client(cfg).messages.stream({
      model: MODEL,
      // Düşünme belirteçleri de bu sınıra dahildir; büyük teknik resimlerde 32K yetmedi.
      max_tokens: o.maxTokens ?? 64000,
      system: o.system ?? SYSTEM,
      output_config: { effort: o.effort ?? 'medium', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content }],
    }, { timeout: 15 * 60 * 1000, signal: o.signal }).finalMessage();
  } catch (e) {
    if (o.signal.aborted) throw new Error('İşlem iptal edildi.');
    if (e instanceof Anthropic.APIError) throw new Error(`Claude API hatası (${e.status ?? 'bağlantı'}): ${e.message}`);
    throw e;
  }
  if (res.stop_reason === 'refusal') throw new Error('Claude bu isteği yanıtlamadı (refusal). İçeriği gözden geçirip tekrar deneyin.');
  if (res.stop_reason === 'max_tokens') {
    // Uzun düşünme sınırı doldurduysa bir kez daha düşük çabayla denenir.
    if (o.effort !== 'low') return ask(cfg, content, schema, { ...o, effort: 'low' });
    throw new Error('Yanıt çok uzun olduğu için kesildi. Dokümanı bölümlere ayırıp tekrar deneyin.');
  }
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  return JSON.parse(text) as Json;
}

// --- 1. aşama: bölge dökümü ---
// Küçük model tüm resmi bir kerede yorumlamak yerine her bölgeyi ayrı ayrı yazıya döker; gereksinimler 2. aşamada bu dökümden çıkarılır.

const TRANSCRIBE_SYSTEM = `Sen teknik resim okuyan dikkatli bir kalite kontrol teknisyenisin. Görevin yalnızca sana gösterilen BÖLGE görüntüsünde görünenleri eksiksiz ve aynen yazıya dökmek; yorum yapma, gereksinim yazma.
Kurallar:
- Her ölçüyü toleransı/uyum sınıfıyla (ör. "Ø30 H7", "12 ±0.05", "120 +0.2/-0.1") aynen yaz. Çerçeveli ölçü TED'dir, "TED" diye belirt.
- Tolerans çerçevelerini soldan sağa hücre hücre oku; sembolü GD&T rehberindeki çizimlerle karşılaştırarak adlandır. Ⓜ/Ⓛ gibi daire içindeki harfleri ayrıca belirt. Çok satırlı çerçevenin her satırı ayrı öğedir.
- Çerçevenin üstündeki/yanındaki "4X Ø8.5" gibi yazıyı ve ok/çizgiyle bağlandığı özelliği "neye ait" alanına yaz.
- Referans (datum) işaretlerini, yüzey pürüzlülüğü sembollerini, notları, antet hücrelerini de ayrı öğe olarak yaz.
- Bölge kenarında kesilen öğeyi görünen kadarıyla yaz ve "kesik" işaretle (komşu bölgede tamamı görünür).
- Okuyamadığın ya da emin olmadığın değeri tahmin etme; "okunurluk" alanını "Belirsiz" yap.
- Genel görünüm ve rehber yalnızca bağlam içindir; onlardaki öğeleri yazma, sadece BÖLGE görüntüsünü dök.`;

const TRANSCRIPT_SCHEMA = obj({
  items: {
    type: 'array',
    items: obj({
      kind: en(['Ölçü', 'Tolerans çerçevesi', 'Referans', 'Yüzey', 'Not', 'Antet', 'Diğer']),
      text: str,
      meaning: str,
      attachedTo: str,
      legibility: en(['Net', 'Belirsiz', 'Kesik']),
    }),
  },
});

interface Transcript {
  label: string;
  items: { kind: string; text: string; meaning: string; attachedTo: string; legibility: string }[];
  error?: string;
}

async function pool<T, R>(list: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i], i);
    }
  }));
  return out;
}

const imageBlock = (img: DrawingImage): Anthropic.ImageBlockParam => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });

async function transcribe(cfg: AiConfig, images: DrawingImage[], signal: AbortSignal, progress: (msg: string) => void): Promise<Transcript[]> {
  const legend = images.find((i) => i.kind === 'legend');
  const tiles = images.filter((i) => i.kind === 'tile');
  let done = 0;
  return pool(tiles, 4, async (tile) => {
    const overview = images.find((i) => i.kind === 'overview' && i.page === tile.page);
    // Rehber + genel görünüm her bölge için aynı önek; önbellekten okunur.
    const content: Anthropic.ContentBlockParam[] = [];
    if (legend) content.push({ type: 'text', text: legend.label }, imageBlock(legend));
    if (overview) content.push({ type: 'text', text: `${overview.label} (yalnızca bağlam için)` }, { ...imageBlock(overview), cache_control: { type: 'ephemeral' } });
    content.push({ type: 'text', text: `BÖLGE: ${tile.label}\nBu bölgede görünen her şeyi döküm listesi olarak yaz.` }, imageBlock(tile));
    try {
      const r = (await ask(cfg, content, TRANSCRIPT_SCHEMA, { system: TRANSCRIBE_SYSTEM, maxTokens: 16000, effort: 'medium', signal })) as unknown as { items: Transcript['items'] };
      return { label: tile.label, items: r.items };
    } catch (e) {
      if (signal.aborted) throw e;
      return { label: tile.label, items: [], error: e instanceof Error ? e.message : String(e) };
    } finally {
      progress(`Resim bölgeleri okunuyor: ${++done}/${tiles.length}`);
    }
  });
}

function transcriptText(ts: Transcript[]): string {
  const out = ['## Bölge dökümleri (1. aşama: her bölge ayrı okundu; bölgeler örtüşür, aynı öğe birden çok bölgede geçebilir)'];
  for (const t of ts) {
    out.push('', `### ${t.label}`);
    if (t.error) out.push(`(okunamadı: ${t.error})`);
    else if (!t.items.length) out.push('(boş)');
    for (const i of t.items) out.push(`- [${i.kind}] ${i.text}${i.meaning ? ` — ${i.meaning}` : ''}${i.attachedTo ? ` (ait: ${i.attachedTo})` : ''}${i.legibility !== 'Net' ? ` [${i.legibility}]` : ''}`);
  }
  return out.join('\n');
}

const DRAWING = `Bu bir teknik resim. Sana sayfaların genel görünümü, her bölgenin ayrı ayrı yapılmış dökümü ve varsa dosyadan doğrudan okunmuş metinler (DXF/DWG ölçü-not-antet listesi, PDF metin katmanı) verilir. Değerler için önce dosyadan okunan metinlere, sonra bölge dökümlerine güven; genel görünümü hangi görünüş/detay olduğunu anlamak için kullan. Bölgeler örtüştüğü için aynı öğe birden çok dökümde geçebilir: birleştir, aynı gereksinimi iki kez yazma. "Belirsiz" işaretli değerleri kesin değer gibi yazma.
Teknik resimden şunları gereksinim olarak çıkar:
- Toleranslı ve kritik ölçüler (tolerans, uyum sınıfı ör. H7, ± değerleri ile birlikte), temel ölçüler, kritik/özel karakteristik işaretli ölçüler.
- Geometrik toleranslar (GD&T çerçeveleri ve referans düzlemleri/datumlar).
- Yüzey pürüzlülüğü, kenar kırma, çapak, genel tolerans standardı (ör. ISO 2768-mK).
- Malzeme, ısıl işlem, yüzey işlem/kaplama/boya, sertlik.
- Genel ve özel notlar (her not maddesi ayrı gereksinim), işaretleme/etiketleme, kaynak/perçin sembolleri.
- Antet bilgileri: parça no, revizyon, malzeme, kütle, ölçek, standartlar — konfigürasyon gereksinimi olarak.
- Genel tolerans tablosu (ör. DIN / ISO 2768 sınıfları M, C, V veya f, m, c, v): dolu daire, çarpı ya da işaretle seçilmiş sınıf geçerli sınıftır. Seçili sınıfı ve tablodaki değerlerini tek bir gereksinim olarak yaz (ör. "<resimdeki standart adı> V: 3-6 mm ±0.5, 6-30 mm ±1.0 …"); standart adını resimde yazdığı gibi yaz (DIN 2768 ise DIN 2768); toleranssız ölçülerin kabul kriterinde bu sınıfa atıf yap.
- Toleransı yazılmamış her ölçüye (çap ve yarıçap dahil) genel tolerans uygulanır: ölçünün girdiği aralığı tablodan seç ve kabul kriterine tek değer yaz (ör. 125 → 120-400 aralığı → "125 ±2.5"). Genel tolerans tablosu ya da notu varken "tolerans yazılı değil", "VERİ YOK" yazma ve bunun için issue açma.
- Malzeme / parça listesi (Poz, parça no, ad, malzeme, adet): her satır ayrı bir konfigürasyon gereksinimidir (parça no, malzeme ve adet birlikte). Bir satırı başka maddelerde tekrar etme: aynı parçanın malzemesi için ayrı madde, "DIN580-M16 standardına uygun olmalı", "montaj şu parçaları içermeli" gibi maddeler yazma.
- Birden çok sayfa / pafta varsa (ör. montaj resmi ve parça resmi) her sayfanın kendi antetindeki parça no'yu kaynağa yaz; document alanına ilk sayfanın (ana resmin) numarasını yaz.
Kaynağa sayfa ve bölgeyi yaz (ör. "Sayfa 1 / Bölge B3 / Not 4" veya "Antet"). Bulanık ya da okunamayan değeri tahmin etme; "VERİ YOK – doğrulanmalı" yaz ve issues listesine "okunamayan ölçü" olarak ekle.
Çelişki kuralları (yanlış alarm vermemek için):
- Bölgeler örtüşür; bölge kenarında kesilen öğe [Kesik] işaretlidir ve tam hali komşu bölgededir. [Kesik] ya da [Belirsiz] bir okuma ile tam okuma arasındaki fark çelişki DEĞİLDİR: tam okumayı kullan, issue açma. Çerçevenin bir bölgede "A|B", diğerinde "A|B|C" görünmesi kesilmedendir.
- Dosyadan okunan tolerans çerçeveleri, TED işaretleri ve referans (datum) listesi kesindir; bölge dökümüyle farklıysa dosyadakini kullan. Bölge dökümünden yalnızca dosyada olmayan bilgiyi (ör. [sembol] hücresinin adı) al.
- Bir referans harfi (A, B, C) resimde bir kez tanımlanır (dolu üçgenli kutu); aynı harfin birçok çerçevede kullanılması çelişki değildir. Aynı ölçü değerinin (ör. iki ayrı 80) farklı özelliklere ait olması da çelişki değildir.
- Bölge dökümleri arasındaki okuma farkları ASLA issue değildir; bunlar okuma hatasıdır, resmin kusuru değil. Hangi okumanın doğru olduğuna dosya metni, yoksa en net okuma karar verir; emin değilsen gereksinimin güvenini Low yap. Issue yalnızca resmin kendisindeki eksik bilgi (ör. derinlik, kaplama kapsamı) ya da resimde açıkça görülen gerçek bir çelişki içindir.
- Dosyadan okunan bir ölçüde [TED] yoksa o ölçü TED değildir; bölge dökümü aksini söylese de issue açma (resimde aynı değerde başka bir TED ölçü olabilir).
- Referans (datum) yüzeyini yalnızca dolu üçgenli referans işaretinin bağlandığı yüzey belirler. Bir çerçevede "A" yazması, o çerçevenin bağlandığı yüzeyin A olduğu anlamına gelmez; bu bir çelişki değildir.
- Resim çerçevesinin altındaki ya da dışındaki form numarası, form yayın tarihi, form revizyon no/tarihi (ör. "F25.09", "RELEASE DATE", "REVISION NO: 03") resim şablonuna aittir. Resmin revizyonu revizyon tablosundaki (REV.NO) ve antetteki değerdir; ikisi arasındaki fark çelişki değildir, issue açma.
- Kesit / görünüş işaretleri referans (datum) DEĞİLDİR: kalın kısa çizgi ucu ve okla gösterilen harf (A … A) ve "A-A" başlıklı görünüş bir kesittir. Datum yalnızca dolu üçgene bağlı kutulu harftir; resimde datum yoksa GD&T çerçevesi de beklenmez, bunun için issue açma.
- Resimde hiç izi olmayan prosesler (ör. kaynak sembolü yokken kaynak; ısıl işlem, sertlik) için "belirtilmemiş" issue'su açma. Tasarımcının seçtiği tolerans sınıfının yeterliliği hakkında görüş bildirme; yalnızca resimden hesaplanabilen somut bir uyumsuzluk (ör. delik ile cıvata çapı) varsa issue aç.
- Antet hücreleri ayrıdır: yan yana duran ölçek (ör. 1/3) ve sayfa (ör. 1/2) hücreleri çelişki ya da belirsizlik değildir. Antetin düzeni ve boş bırakılmış bilgi alanları (ağırlık, hacim) için en fazla bir Optional issue aç.
- Montaj resminde standart parçaların (cıvata, somun, mapa) yeri parça resmindeki deliklerle tanımlıdır; bunlar için ayrı konum ölçüsü isteme.
- Açılması gereken issue'lar resmin amacına göre kritik eksiklerdir; bunları atlama. Örnekler: kaldırma / taşıma aparatında taşıma kapasitesi (SWL) ve güvenlik katsayısı; korumasız karbon çeliğinde yüzey koruması (Astar / Boya "-"); bağlantı elemanlarında sıkma momenti ve kalite sınıfı; ölçüsü tek bir öğede gösterilen tekrarlı öğelerde adet ("4X") belirtilmemesi (Optional).
- Ölçüsü tek bir öğede gösterilen tekrarlı öğeler (aynı çizilmiş delikler, köşe yarıçapları) için gereksinimi tüm öğeler için yaz (ör. "4 adet Ø18 delik"); adet eksikliği için tüm resimde TEK bir Optional issue aç, delik ve köşe için ayrı ayrı açma.
- Poz balonunun lider çizgisi parçaya dolu bir nokta ile biter; bu nokta kaynak, temas ya da işaret değildir, issue açma.
- Hiçbir bölgede tam okunamayan öğe için tek bir "okunamayan değer" issue'su yeter; dosya metninde değeri varsa issue açma.
Gereksinim olmayanlar: çizen, tarih, onay, ölçek, birim notu (ör. "ölçüler mm, açılar derece"), izdüşüm gibi antet bilgileri (yalnızca parça no, revizyon ve malzeme konfigürasyon gereksinimidir); dokümanda yazmayan hesaplar ve yorumlar (ör. MMC bonus tolerans hesabı); "datumlar tanımlı olmalı" gibi genel ifadeler.
Çerçeveli ölçüler (TED) her biri ayrı gereksinimdir; kabul kriterine "TED – tolerans ilgili GD&T çerçevesinde" yaz, "VERİ YOK" yazma.`;

const RASTER_ONLY = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff'];

export interface ExtractInput {
  filePath?: string;
  text?: string;
  images?: DrawingImage[];
  pdfText?: string;
  drawing?: boolean;
  docId: string;
  docLabel: string;
  existing: string[];
  existingIssues?: string[];
  existingDocs?: string[];
}

export async function extractRequirements(cfg: AiConfig, input: ExtractInput, progress: (msg: string) => void = () => undefined) {
  const ctrl = new AbortController();
  current = ctrl;
  try {
    const content: Anthropic.ContentBlockParam[] = [];
    const images = input.images ?? [];
    const tiles = images.filter((i) => i.kind === 'tile');
    if (input.filePath) {
      const ext = path.extname(input.filePath).toLowerCase();
      const name = path.basename(input.filePath);
      if (images.length && RASTER_ONLY.includes(ext)) content.push({ type: 'text', text: `Görsel dosya: ${name}` });
      else if (images.length && ext === '.pdf') content.push({ type: 'text', text: `PDF teknik resim: ${name}` });
      else content.push(...(await fileBlocks(input.filePath)));
    }
    if (input.pdfText) content.push({ type: 'text', text: `## PDF metin katmanı (dosyadan okunan yazılar, sayfadaki konumuyla)\n${input.pdfText.slice(0, 60000)}` });
    if (tiles.length) {
      progress(`Resim bölgeleri okunuyor: 0/${tiles.length}`);
      const ts = await transcribe(cfg, images, ctrl.signal, progress);
      content.push({ type: 'text', text: transcriptText(ts) });
      // 2. aşamaya yalnızca genel görünümler gider; ayrıntı dökümlerde.
      for (const img of images.filter((i) => i.kind === 'overview')) content.push({ type: 'text', text: img.label }, imageBlock(img));
      progress('Gereksinimler çıkarılıyor…');
    } else {
      for (const img of images.filter((i) => i.kind !== 'legend')) content.push({ type: 'text', text: img.label }, imageBlock(img));
    }
    if (input.text) content.push({ type: 'text', text: input.text });
    if (input.drawing || images.length) content.push({ type: 'text', text: DRAWING });
    content.push({
      type: 'text',
      text: `Bu doküman ${input.docId} (${input.docLabel}) olarak kayıtlı. Dokümanı analiz et ve gereksinim listesi çıkar.
Her gereksinimin kaynağını "${input.docId} / Sayfa x / Bölüm y / Ölçü z" biçiminde ver (e-postada: "${input.docId} / <tarih> / <gönderen>").
Tip listesi: Functional, Performance, Dimensional, Material, Structural, Environmental, Safety, Reliability, Interface, Manufacturing, Inspection, Regulatory, Customer-specific, Configuration.
Kabul kriteri dokümanda yoksa "VERİ YOK – doğrulanmalı" yaz. Çelişkileri, belirsizlikleri ve eksikleri issues listesine ekle; ilgili gereksinim varsa relatedReq alanına projedeki ID'sini yaz.
Alanları kısa ve öz yaz. Metinlere kendi sıra numaranı (REQ-01 gibi) yazma; relatedReq'e yalnızca projedeki mevcut bir ID yaz, yeni gereksinimler için boş bırak.
document alanına dokümanın kendi numarasını, revizyonunu ve adını yaz (teknik resimde antetten; yoksa boş bırak).
Projedeki dokümanlar:\n${(input.existingDocs ?? []).join('\n') || '(yok)'}
AYNI RESİM KURALI: Bu doküman listedeki bir dokümanla aynı numara ve revizyona sahipse aynı resmin başka bir formatıdır (PDF / DXF / PNG / DWG). O zaman sameAs alanına o dokümanın ID'sini yaz ve yalnızca farkları bildir: mevcut listede HİÇ karşılığı olmayan bir değer ya da not varsa gereksinim ekle; iki format aynı öğe için farklı değer gösteriyorsa issue aç. Mevcut bir gereksinimi yeniden ifade eden, birleştiren, bölen ya da ondan türetilen madde yazma. Fark yoksa iki liste de boş olmalıdır. Aynı resim değilse sameAs boş kalır.
Projede zaten bulunan gereksinimler (tekrar etme; çelişki varsa issue aç):\n${input.existing.slice(0, 300).join('\n') || '(yok)'}
Projede zaten açık olan konular (aynı konuyu tekrar açma; yeni bilgi varsa yeni bir konu olarak değil, yalnızca gerçekten farklıysa ekle):\n${(input.existingIssues ?? []).slice(0, 200).join('\n') || '(yok)'}`,
    });
    return await ask(cfg, content, REQ_SCHEMA, { signal: ctrl.signal, effort: images.length ? 'medium' : 'high' });
  } finally {
    if (current === ctrl) current = null;
  }
}
