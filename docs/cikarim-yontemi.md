# Gereksinim ve açık konu çıkarma yöntemi

Bu belge, Gereksinim Takip uygulamasının şartname, teknik resim, müşteri e-postası, Word ve Excel gibi kaynaklardan **gereksinim** ve **açık konu** çıkarma yöntemini anlatır. Amaç, aynı yöntemi başka bir uygulamada kurabilmektir. Belge kendi içinde yeterlidir: akış, veri şeması, prompt'ların tam metni, doğrulama kuralları ve uygulama kontrol listesi buradadır.

Belge sürüm 0.6.13'teki kodu anlatır. Kaynak dosyalar parantez içinde verilmiştir (ör. `src/main/ai.ts`). Kod değişirse belge de güncellenmelidir; prompt'ların asıl kaynağı her zaman koddur.

---

## İçindekiler

1. [Yöntemin özü](#1-yöntemin-özü)
2. [Genel akış](#2-genel-akış)
3. [Kaynak türüne göre adımlar](#3-kaynak-türüne-göre-adımlar)
4. [Gereksinim ve açık konu tanımları](#4-gereksinim-ve-açık-konu-tanımları)
5. [Veri şeması](#5-veri-şeması)
6. [Prompt'lar ve sistem talimatları](#6-promptlar-ve-sistem-talimatları)
7. [Kaynak izleme, güven, tekilleştirme ve doğrulama](#7-kaynak-izleme-güven-tekilleştirme-ve-doğrulama)
8. [Bilinen sınırlamalar ve dersler](#8-bilinen-sınırlamalar-ve-dersler)
9. [Başka bir uygulamada kurmak için kontrol listesi](#9-başka-bir-uygulamada-kurmak-için-kontrol-listesi)

---

## 1. Yöntemin özü

Yöntem beş ilkeye dayanır. Bunlar FMEA Studio V4.6 ile aynıdır, iki uygulama ileride REQ / ISS kimlikleri üzerinden bağlanacaktır.

1. **Uydurma yok.** Dokümanda olmayan değer, tolerans, malzeme, standart veya kabul kriteri yazılmaz. Yerine `VERİ YOK – doğrulanmalı` yazılır.
2. **Her satırın kaynağı vardır.** Hangi doküman, hangi sayfa, bölüm, ölçü/balon no veya e-posta tarihi ve göndereni.
3. **Gereksinim ile açık konu ayrıdır.** Doğrulanabilir bir "-malıdır" ifadesi gereksinimdir. Eksik bilgi, çelişki, belirsiz ifade ve eksik kabul kriteri açık konudur (issue); gereksinim gibi yazılmaz.
4. **AI önerir, mühendis karar verir.** Çıkarılan her kayıt `AI Proposed` onay durumuyla bir önizleme ekranına gelir. Kullanıcı istemediklerinin işaretini kaldırır, kalanlar projeye eklenir.
5. **Model ne kadar küçükse, okuma o kadar parçalanır.** Uygulama maliyet nedeniyle küçük bir model (Claude Haiku) kullanır. Doğruluk, modele daha fazla yük bindirerek değil; girdiyi temizleyerek (dosyadan doğrudan okunan metin), görüntüyü bölgelere ayırarak ve iki aşamalı okuma yaparak sağlanır.

---

## 2. Genel akış

```
 Dosya / yapıştırılan metin
          │
          ▼
 ┌────────────────────────┐   docType tahmini (uzantıdan), kullanıcı değiştirebilir
 │ 1. Doküman kaydı (DOC) │   DOC-001, DOC-002 …
 └──────────┬─────────────┘
            ▼
 ┌────────────────────────────────────────────────────────────┐
 │ 2. Kaynak hazırlama (kaynak türüne göre, §3)                │
 │   • Metin kaynakları → düz metin (tablolar " | " ile)        │
 │   • E-posta → başlık + gövde + ekler (ekler aynı kurallarla) │
 │   • DXF/DWG → dosyadan okunan ölçü/çerçeve/datum/antet metni │
 │              + SVG'den çizilmiş görüntü                     │
 │   • PDF → metin katmanı; yazı dolu sayfa metin olarak,       │
 │           resim sayfası görüntü olarak                      │
 │   • Görüntüler → genel görünüm + %25 örtüşen bölgeler        │
 │              + GD&T sembol rehberi görseli                   │
 └──────────┬─────────────────────────────────────────────────┘
            ▼
 ┌────────────────────────────────────────────────────────────┐
 │ 3. Aşama 1 – bölge dökümü (yalnızca bölgeli görüntülerde)   │
 │   Her bölge ayrı istekte, 4 paralel, JSON şemalı döküm       │
 └──────────┬─────────────────────────────────────────────────┘
            ▼
 ┌────────────────────────────────────────────────────────────┐
 │ 4. Aşama 2 – gereksinim + açık konu çıkarma                  │
 │   Girdi: dosya metni + bölge dökümleri + genel görünümler    │
 │          + (teknik resimse) teknik resim kuralları           │
 │          + bağlam: projedeki dokümanlar, gereksinimler,      │
 │            açık konular (tekrar etmemesi için)               │
 │   Çıktı: JSON şema ile zorlanmış {document, requirements,    │
 │          issues}                                             │
 └──────────┬─────────────────────────────────────────────────┘
            ▼
 ┌────────────────────────────────────────────────────────────┐
 │ 5. Son işlem                                                │
 │   • Metin başındaki "REQ-01:" gibi model numaraları silinir  │
 │   • Doküman no/rev dokümana yazılır, "aynı resim" eşleşmesi  │
 │   • dataStatus: kabul kriterinde "VERİ YOK" varsa NO_DATA    │
 └──────────┬─────────────────────────────────────────────────┘
            ▼
 ┌────────────────────────────────────────────────────────────┐
 │ 6. İnsan onayı (önizleme)                                    │
 │   Seçilenler REQ-xxx / ISS-xxx kalıcı numarasıyla,           │
 │   approval = "AI Proposed", status = "Open" eklenir          │
 └────────────────────────────────────────────────────────────┘
```

Birden çok dosya seçildiğinde dosyalar **sırayla** işlenir. Bir dosyadan çıkan gereksinim ve açık konular `(yeni) …` önekiyle bağlam listesine eklenir; sonraki dosya bunları tekrar etmez (`src/renderer/components/Ai.tsx`, `run`).

### Model ve çağrı ayarları (`src/main/ai.ts`)

| Ayar | Değer | Neden |
|---|---|---|
| Model | `claude-haiku-5-5` | Yüksek hacim, düşük maliyet. Doğruluk yöntemle sağlanır. |
| Yapılandırılmış çıktı | `output_config.format = json_schema` | Çıktı her zaman şemaya uyan JSON. Ayrıştırma hatası yok. |
| `effort` (2. aşama) | Yalnızca metin: `high`; görüntü varsa: `medium` | Görüntülü isteklerde düşünme bütçesi çıktıyı kesmesin. |
| `effort` (1. aşama) | `medium` | |
| `max_tokens` | 2. aşama 64 000, 1. aşama 16 000 | Düşünme belirteçleri de bu sınıra dahil. 32K büyük resimlerde yetmedi. |
| Akış (stream) | Açık, zaman aşımı 15 dk | Uzun girdilerde HTTP zaman aşımına düşmemek için. |
| `stop_reason = max_tokens` | Bir kez `effort: low` ile yeniden denenir, yine olursa hata | |
| `stop_reason = refusal` | Kullanıcıya hata | |
| Paralellik (1. aşama) | 4 bölge aynı anda | |
| Önbellek | Genel görünüm görüntüsüne `cache_control: ephemeral` | Rehber + genel görünüm her bölge isteğinde aynı önektir. |
| İptal | Tek `AbortController` tüm aşamaları durdurur | |

---

## 3. Kaynak türüne göre adımlar

Uzantıya göre varsayılan doküman tipi (`DOC_TYPE`, `Ai.tsx`):

| Uzantı | Varsayılan docType |
|---|---|
| pdf, dwg, dxf, png, jpg, jpeg, tif, tiff, bmp | Teknik resim |
| docx | Teknik şartname |
| xlsx, xlsm, csv | Excel listesi |
| eml, msg | E-posta |
| txt, md | Diğer |
| Yapıştırılan metin | E-posta |

Doküman tipi listesi: Teknik resim, Teknik şartname, Müşteri gereksinimi, E-posta, Toplantı notu, Excel listesi, Malzeme datasheet, Proses spesifikasyonu, Test raporu, CAD (STEP/IGES), Diğer. Kullanıcı tipi değiştirip çıkarmayı yeniden çalıştırabilir; PDF ve Word'de tip, teknik resim yolunun seçilmesini etkiler.

### 3.1 Word (.docx) – şartname

`src/main/sources.ts` → `toBlocks`, `htmlToText`, `docxMedia`

1. `mammoth` ile HTML'e çevrilir.
2. HTML düz metne çevrilir, **tablolar korunur**: hücre sonu ` | `, satır sonu yeni satır. Hücre içindeki paragraflar ` / ` ile birleştirilir (satır bölünmesin). Başlıklar `#`, liste öğeleri `- ` olur.
3. Metin `Word dosyası: <ad>` başlığıyla gönderilir.
4. Gömülü görseller (`word/media/`) ayrıca çıkarılır:
   - Uzun kenarı 700 pikselden küçük görseller (logo, imza) atlanır, en fazla 6 görsel.
   - **Az yazılı** (gövde < 1500 karakter) ve en fazla 3 büyük görselli Word ya da tipi "Teknik resim" olan Word → her görsel teknik resim sayfası gibi bölgelere ayrılır (§3.5).
   - Yazı ağırlıklı şartnamede görseller yalnızca küçültülmüş genel görünüm olarak eklenir.
   - EMF/WMF vektör görseller okunamaz; kullanıcı uyarılır.
   - Uzun kenarı 2000 pikselden küçük teknik resim görseli için "çözünürlük düşük" uyarısı verilir.
5. Eski `.doc` desteklenmez; `.docx` olarak kaydedilmesi istenir.

### 3.2 Excel (.xlsx / .xlsm / .csv)

`excelText`

- Her sayfa `### Sayfa: <ad>` başlığıyla, her satır `R<n>: hücre | hücre | …` biçiminde metne çevrilir.
- Zengin metin birleştirilir, formüllerin **sonucu** alınır, tarihler `YYYY-AA-GG` olur.
- CSV düz metin olarak gider. Eski `.xls` desteklenmez.

### 3.3 Müşteri e-postası (.eml / .msg / yapıştırılan metin)

- `.eml` `mailparser`, `.msg` `@kenjiuno/msgreader` ile okunur.
- Gönderilen metin:
  ```
  E-posta: <dosya adı>
  Konu: …
  Gönderen: Ad <adres>
  Alıcı: …            (yalnızca .eml)
  Tarih: …

  <gövde: düz metin; yoksa HTML → düz metin>
  ```
- **Ekler** aynı `toBlocks` kurallarıyla işlenir ve `--- E-posta eki: <ad> ---` ile ayrılır. Yani ekteki Word, Excel, PDF, DXF de okunur.
  - 20 KB'tan küçük satır içi (inline) görseller imza logosu sayılıp atlanır.
  - Gizli ekler (`attachmentHidden`) atlanır.
  - E-posta içindeki e-posta en fazla 2 düzey açılır.
  - Desteklenmeyen ek `(Ek atlandı: …)`, okunamayan ek `(Ek okunamadı: … – hata)` olarak metne yazılır; işlem durmaz.
  - E-posta eki olarak TIFF/BMP okunamaz; ayrıca yüklenmesi istenir.
- Yapıştırılan metin (e-posta, toplantı notu, şartname bölümü) bir doküman kaydı olarak saklanır (ilk 2000 karakter `notes` alanında) ve aynı yoldan çıkarılır.
- Kaynak biçimi e-postada `DOC-xxx / <tarih> / <gönderen>` olarak istenir.

### 3.4 PDF

`src/renderer/drawing.ts` → `fromPdf`

PDF'ler varsayılan olarak "Teknik resim" tipindedir ve önce **metin katmanı** sayfa sayfa okunur (`pdf.js`):

1. Her sayfanın metin parçaları konumlarıyla alınır, aynı satırdakiler birleştirilir (yukarıdan aşağıya, soldan sağa).
2. **Yazı dolu sayfa** (metin ≥ 1500 karakter): şartname/rapor sayfası sayılır, görüntüye çevrilmez. Metni `### Sayfa i/N (metin)` başlığıyla eksiksiz gönderilir.
3. **Resim sayfası**: metni konumuyla gönderilir (`- Sayfa 2 (yatay %34, dikey %71): Ø30 H7`) ve sayfa görüntüye çevrilip bölgelere ayrılır (§3.5).
4. Sayfaların en az yarısı yazı doluysa belge **yazı ağırlıklı** sayılır (`textHeavy`). Doküman tipi "Teknik resim" kalsa bile teknik resim bayrağı kapanır. Ancak belgede bölgelere ayrılmış bir resim sayfası varsa teknik resim kuralları (§6.3) yine eklenir, çünkü kurallar bölge varlığında her zaman eklenir.
5. Görüntü sınırına (80) takılan sayfaların da metni gönderilir.
6. Metin sınırı istek başına 150 000 karakterdir. Yalnızca tam sayfalar gönderilir; kesilen ilk sayfa kullanıcıya bildirilir ("belgeyi bölümlere ayırıp ayrı yükleyin").
7. Görüntü hazırlama başarısız olursa PDF, API'ye doğrudan `document` bloğu olarak gönderilir.
8. Tipi "Teknik resim" olmayan PDF görüntüye çevrilmez, API'ye doğrudan `document` bloğu olarak gider.

> "Microsoft Print to PDF" ile basılmış resimlerde **metin katmanı yoktur**. Bu durumda tüm bilgi görüntüden okunur; PDF vektörlerinden kutu/çerçeve tespiti yapılamaz.

### 3.5 Teknik resim görüntüleri (PDF sayfası, PNG/JPG, TIFF, Word görseli, DXF çizimi)

`src/shared/raster.ts`, `src/renderer/drawing.ts`

Sorun: Model görüntüleri uzun kenarı ~1568 piksele küçültür. A3–A0 bir resimde ölçü yazıları bu boyutta okunamaz.

Çözüm: Her sayfa **bir genel görünüm + örtüşen yüksek çözünürlüklü bölgeler** olarak gönderilir.

| Sabit | Değer | Anlamı |
|---|---|---|
| `TILE` | 1568 px | Bölge kenarı (modelin küçültmediği boyut) |
| `OVERLAP` | %25 | Bölge kenarına denk gelen tolerans çerçevesi en az bir bölgede bütün görünsün |
| `PX_PER_MM` | 10 | Hedef çözünürlük; 3.5 mm yazı ≈ 35 px. Daha yükseği okumayı iyileştirmez, bölge sayısını ve kesilen çerçeve sayısını artırır |
| `MIN_PAGE_EDGE` | 4200 px | A4'e küçültülerek basılmış A3 resim de en az A3 çözünürlükte işlenir |
| `MAX_EDGE` | 6400 px | Bir sayfanın en büyük uzun kenarı |
| `MAX_IMAGES` | 80 | İstek başına görüntü (API sınırı 100) |
| `MAX_IMAGE_BYTES` | 16 MB | Görüntülerin base64 toplamı |
| PDF ölçeği üst sınırı | 400 dpi | |

Adımlar:

1. Sayfa kağıt boyutuna göre ~10 px/mm (en az 4200 px, en çok 6400 px veya bölge bütçesine sığacak kadar) çizilir.
2. Bölge bütçesi: `floor(80 / sayfa sayısı) − 1` (genel görünüm hariç). Bütçe aşılırsa uzun kenar %10'luk adımlarla küçültülür.
3. Görüntü `TILE` boyutunda, %25 örtüşen ızgaraya bölünür. Bölgeler pafta düzeni gibi adlandırılır: `bölge B3 (satır 2/3, sütun 3/4; yatay %48–100, dikey %33–80)`.
4. Tamamen boş (beyaz) bölgeler atlanır (mürekkep oranı < 0.00005).
5. Genel görünüm uzun kenarı 1568 px'e küçültülür. Sayfa zaten küçükse bölge yoktur, tek "tam görüntü" gider.
6. PNG data URL'si 1,5 milyon karakteri aşarsa görüntü JPEG (kalite 0.88) olarak kodlanır.
7. Bölge varsa listenin başına **GD&T sembol rehberi** görseli eklenir (`src/shared/gdtLegend.ts`): ISO 1101 / ISO 5459'daki 14 sembol, Ⓜ Ⓛ Ⓟ Ⓔ Ø değiştiricileri, örnek bir tolerans çerçevesi ve okunuşu, datum işareti ve TED kutusu. Küçük model sembolleri ezberden değil bu rehberle karşılaştırarak tanır.
8. TIFF: en fazla 20 sayfa. DXF: SVG çizimi ortanca yazı yüksekliği ~35 px olacak kadar büyütülür.

### 3.6 DXF / DWG

`src/main/dxf.ts`

DXF, **en güvenilir formattır**, çünkü değerler görüntüden değil dosyadan okunur. Aynı resmin birden çok formatı varsa önce DXF yüklenmesi önerilir.

- **DWG** doğrudan okunmaz. Ücretsiz ODA File Converter ile DXF'e (ACAD2018) çevrilir. Program bilinen kurulum yerlerinde aranır veya `ODA_FILE_CONVERTER` ortam değişkeniyle verilir. Yoksa kullanıcıdan DXF veya PDF istenir.
- Karakter kodlaması: `$DWGCODEPAGE` (varsayılan Windows-1254), AC1021+ için UTF-8.
- Biçim kodları temizlenir: `%%c → Ø`, `%%d → °`, `%%p → ±`, `\U+XXXX`, yığılmış toleranslar `+0.1/-0.1`.
- Dosyadan okunanlar:
  - **Antet ve blok öznitelikleri** (`TAG: değer`).
  - **TOLERANCE nesneleri**: GDT yazı tipi harfleri sembol adına çevrilir: `Konum | Ø0.2 (M) | A | B | C`.
  - **Çizgiyle çizilmiş tolerans çerçeveleri**: kutu içindeki bitişik yazılar bir satırdır. İlk hücre tolerans değeri, diğerleri referans harfleridir. Solda yazısız kare hücre varsa `[sembol]` yazılır (adı görüntüden alınır). Üst üste yığılmış çok satırlı çerçeveler aynı numarayı alır, üstündeki yazı (ör. `4X Ø8.5`) etiket olur.
  - **Datum işaretleri**: tek başına kutulu tek harf.
  - **Ölçüler**: görünen metin (tolerans dahil), tür, gerçek ölçü, konum, katman. Yazısı kutu içindeyse **[TED]**.
  - **Yazılar ve notlar**: yukarıdan aşağıya, konumlu.
- Model alanı ayrıca SVG'ye çizilir (gizli/eksen çizgileri kesikli, oklar ve datum üçgenleri dolu) ve §3.5'teki gibi görüntü olarak gönderilir.
- Metin özeti modele şu başlıklarla gider: `## Antet ve blok öznitelikleri`, `## Geometrik toleranslar`, `## Tolerans çerçeveleri – çizgiyle çizilmiş kutulardan okundu`, `## Referans (datum) işaretleri`, `## Ölçüler … [TED] = kutu içinde`, `## Yazılar ve notlar`.

### 3.7 Diğer

- `.txt`, `.md`, `.csv`: `Dosya: <ad>` başlığıyla düz metin. `.htm/.html`: HTML → düz metin.
- PNG/JPG/GIF/WEBP e-posta eki olarak tek görüntü gider (5 MB base64 sınırı). Doküman olarak yüklendiğinde §3.5 uygulanır.

---

## 4. Gereksinim ve açık konu tanımları

### 4.1 Gereksinim (REQ)

Doğrulanabilir, tek bir "-malıdır / shall" ifadesi.

- Birleşik cümleler ayrı gereksinimlere bölünür.
- Her gereksinimde: tip, kabul kriteri, kanıt türü, kanıt, önerilen disiplin, kaynak, güven.
- Kabul kriteri dokümanda yoksa `VERİ YOK – doğrulanmalı`.
- Varsayım zorunluysa metne `AI VARSAYIMI – mühendislik doğrulaması gerekli` eklenir.
- Doküman kanıt yöntemi belirtmiyorsa öneri yapılır ve sonuna `(AI RECOMMENDATION)` eklenir.

**Gereksinim tipleri:** Functional, Performance, Dimensional, Material, Structural, Environmental, Safety, Reliability, Interface, Manufacturing, Inspection, Regulatory, Customer-specific, Configuration.

**Kanıt türleri:** Ölçüm, Test, Analiz, Muayene, Model kontrolü, Doküman incelemesi, Benzerlik, Sertifika. "Kanıt" alanı kanıtın somut biçimidir: "CMM ölçüm raporu, balon 12–15", "Tuz sisi test raporu ISO 9227", "CATIA model ölçüsü ekran görüntüsü", "Malzeme sertifikası EN 10204 3.1".

**Disiplin önerisi:**

| Disiplin | Kapsar |
|---|---|
| Tasarım | geometri, malzeme, performans, arayüz |
| Konfigürasyon | parça no, revizyon, varyant, doküman/etiketleme, teslimat içeriği |
| İmalat | proses, yüzey işlem, muayene, ambalaj |

### 4.2 Açık konu (ISS)

Dokümandan çıkarılamayan ama kritik olabilecek konu. Gereksinim gibi yazılmaz.

- **Eksik bilgi** (ör. delik derinliği, kaplama kapsamı, taşıma kapasitesi).
- **Çelişki**: iki kaynak aynı şey için farklı değer veriyor.
- **Belirsiz ifade**: "uygun", "yeterli", "mümkün olduğunca".
- **Eksik kabul kriteri**.
- Teknik resimde **okunamayan değer** (tek bir issue).

Öncelik: **Critical / Important / Optional**. Her açık konuda: açıklama, risk, önerilen aksiyon, kaynak ve varsa ilgili gereksinimin projedeki ID'si (`relatedReq`).

### 4.3 Ayrım kuralları

| Durum | Gereksinim mi, açık konu mu? |
|---|---|
| Dokümanda açıkça yazan, doğrulanabilir değer | Gereksinim, kaynaklı, güven High |
| Değer var ama kabul kriteri yok | Gereksinim, kabul kriteri `VERİ YOK – doğrulanmalı`. Gerekirse eksik kabul kriteri için açık konu |
| Değer hiç yok ama ürün için kritik | Açık konu (gereksinim uydurulmaz) |
| İki kaynak farklı değer veriyor | Açık konu (çelişki); ilgili gereksinim ID'si `relatedReq` |
| Belirsiz ifade ("yeterli dayanım") | Açık konu |
| Projede zaten olan gereksinim | Yazılmaz. Çelişiyorsa açık konu |
| Projede zaten açık olan konu | Tekrar açılmaz |
| Antet: çizen, tarih, onay, ölçek, izdüşüm, birim notu | Hiçbiri (yalnızca parça no, revizyon, malzeme konfigürasyon gereksinimidir) |
| Dokümanda yazmayan hesap/yorum (ör. MMC bonus tolerans hesabı) | Hiçbiri |
| "Datumlar tanımlı olmalı" gibi genel ifade | Hiçbiri |
| Teknik resimde bölgeler arası okuma farkı | **Asla açık konu değildir** (okuma hatası, resmin kusuru değil) |

Teknik resme özgü ayrım kuralları §6.3'te prompt metninin içindedir.

---

## 5. Veri şeması

### 5.1 Modelin döndürdüğü JSON (2. aşama, `REQ_SCHEMA`)

Tüm nesnelerde tüm alanlar zorunludur ve `additionalProperties: false`. Bilinmeyen değer boş dize olarak döner.

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["document", "requirements", "issues"],
  "properties": {
    "document": {
      "type": "object", "additionalProperties": false,
      "required": ["number", "revision", "title", "sameAs"],
      "properties": {
        "number":   { "type": "string" },
        "revision": { "type": "string" },
        "title":    { "type": "string" },
        "sameAs":   { "type": "string" }
      }
    },
    "requirements": {
      "type": "array",
      "items": {
        "type": "object", "additionalProperties": false,
        "required": ["text","reqType","acceptance","evidenceType","evidence","discipline","source","confidence"],
        "properties": {
          "text":         { "type": "string" },
          "reqType":      { "type": "string" },
          "acceptance":   { "type": "string" },
          "evidenceType": { "type": "string", "enum": ["Ölçüm","Test","Analiz","Muayene","Model kontrolü","Doküman incelemesi","Benzerlik","Sertifika"] },
          "evidence":     { "type": "string" },
          "discipline":   { "type": "string", "enum": ["Tasarım","Konfigürasyon","İmalat"] },
          "source":       { "type": "string" },
          "confidence":   { "type": "string", "enum": ["High","Medium","Low"] }
        }
      }
    },
    "issues": {
      "type": "array",
      "items": {
        "type": "object", "additionalProperties": false,
        "required": ["description","priority","source","risk","recommendedAction","relatedReq"],
        "properties": {
          "description":       { "type": "string" },
          "priority":          { "type": "string", "enum": ["Critical","Important","Optional"] },
          "source":            { "type": "string" },
          "risk":              { "type": "string" },
          "recommendedAction": { "type": "string" },
          "relatedReq":        { "type": "string" }
        }
      }
    }
  }
}
```

`reqType` şemada serbest dizedir; izin verilen değerler prompt'ta listelenir (§6.4).

### 5.2 Bölge dökümü JSON'u (1. aşama, `TRANSCRIPT_SCHEMA`)

```json
{
  "items": [
    {
      "kind": "Tolerans çerçevesi",
      "text": "⌖ | Ø0.05 | A | B | C",
      "meaning": "Konum toleransı Ø0.05, referans A, B, C",
      "attachedTo": "Ø30 H7 delik",
      "legibility": "Net"
    }
  ]
}
```

- `kind` ∈ Ölçü, Tolerans çerçevesi, Referans, Yüzey, Not, Antet, Diğer
- `legibility` ∈ Net, Belirsiz, Kesik

Dökümler 2. aşamaya Markdown olarak gider:

```
## Bölge dökümleri (1. aşama: her bölge ayrı okundu; bölgeler örtüşür, aynı öğe birden çok bölgede geçebilir)

### Sayfa 1/1 – bölge A2 (satır 1/3, sütun 2/4; yatay %24–62, dikey %0–40)
- [Ölçü] Ø30 H7 — delik çapı, H7 uyum (ait: merkez delik)
- [Tolerans çerçevesi] Ø0.05 | A | B (ait: Ø30 H7) [Kesik]
```

### 5.3 Proje veri modeli (`src/shared/types.ts`)

Model çıktısı, önizlemede onaylanınca şu kayıtlara dönüşür. Ortak alanlar: kalıcı `id` (sayaçla verilir, silinen numara tekrar kullanılmaz) ve yumuşak silme (`deletedAt`, `deletedBy`, `deleteReason`).

**Doküman (`DOC-001`)**

| Alan | Açıklama |
|---|---|
| name, docType | Dosya adı, doküman tipi |
| docNumber, revision | Modelin antetten / başlıktan okuduğu numara ve revizyon (boşsa yazılır) |
| date, source, notes | Yükleme tarihi, kaynak, not ("DOC-001 ile aynı resim (farklı format)") |
| filePath, extractedAt | Dosya yolu, son çıkarma zamanı |

**Gereksinim (`REQ-001`)**

| Alan | Model alanı | Not |
|---|---|---|
| text | text | Baştaki `REQ-01:` gibi numara silinir |
| reqType | reqType | |
| acceptance | acceptance | |
| evidenceType, evidence | aynı | |
| discipline | discipline | Öneri; atamada değişebilir |
| sourceDocId | — | İşlenen dokümanın ID'si (koddan) |
| sourceRef | source | Doküman içi yer |
| confidence | confidence | High / Medium / Low |
| dataStatus | — | Kabul kriterinde `VERİ YOK` varsa `VERİ YOK – doğrulanmalı`, yoksa `Dokümandan (kaynaklı)` |
| approval | — | Her zaman `AI Proposed` ile başlar → Engineer Reviewed → Approved / Rejected |
| notes | — | |
| Atama alanları | — | assignee, dueDate, workStatus, Planner alanları, kapanış |

**Açık konu (`ISS-001`)**

| Alan | Model alanı | Not |
|---|---|---|
| description | description | Baştaki `ISS-01:` silinir |
| priority | priority | |
| sourceDocId, sourceRef | — / source | |
| risk, recommendedAction, relatedReq | aynı | |
| status | — | `Open` ile başlar → Under Review, Waiting Customer, Resolved, Closed |
| answer | — | Müşteri / mühendis cevabı |

### 5.4 Örnek: bir e-postadan çıkan kayıtlar

Girdi:

```
E-posta: boya.eml
Konu: Boya rengi
Gönderen: Ali Yilmaz <ali@musteri.com>
Tarih: 2026-10-20T07:00:00.000Z

Renk RAL 7035 olmali. Kaplama dayanımı yeterli olmalı.
--- E-posta eki: not.txt ---
Dosya: not.txt
Kalinlik 60-90 um
```

Beklenen model çıktısı (örnek):

```json
{
  "document": { "number": "", "revision": "", "title": "Boya rengi", "sameAs": "" },
  "requirements": [
    {
      "text": "Parça RAL 7035 renginde boyanmalıdır.",
      "reqType": "Customer-specific",
      "acceptance": "Renk RAL 7035",
      "evidenceType": "Muayene",
      "evidence": "Renk kartı ile görsel kontrol kaydı (AI RECOMMENDATION)",
      "discipline": "İmalat",
      "source": "DOC-004 / 2026-10-20 / Ali Yilmaz",
      "confidence": "High"
    },
    {
      "text": "Boya kalınlığı 60–90 µm olmalıdır.",
      "reqType": "Manufacturing",
      "acceptance": "60–90 µm",
      "evidenceType": "Ölçüm",
      "evidence": "Kaplama kalınlığı ölçüm raporu (AI RECOMMENDATION)",
      "discipline": "İmalat",
      "source": "DOC-004 / 2026-10-20 / Ali Yilmaz / ek not.txt",
      "confidence": "High"
    }
  ],
  "issues": [
    {
      "description": "\"Kaplama dayanımı yeterli olmalı\" ifadesi belirsiz; test yöntemi ve kabul kriteri yok.",
      "priority": "Important",
      "source": "DOC-004 / 2026-10-20 / Ali Yilmaz",
      "risk": "Kabul aşamasında müşteriyle anlaşmazlık",
      "recommendedAction": "Müşteriden test standardı (ör. tuz sisi süresi) ve kabul kriterini isteyin",
      "relatedReq": ""
    }
  ]
}
```

Proje kaydı olarak (onaydan sonra):

```json
{
  "id": "REQ-012",
  "text": "Boya kalınlığı 60–90 µm olmalıdır.",
  "reqType": "Manufacturing",
  "acceptance": "60–90 µm",
  "evidenceType": "Ölçüm",
  "evidence": "Kaplama kalınlığı ölçüm raporu (AI RECOMMENDATION)",
  "discipline": "İmalat",
  "sourceDocId": "DOC-004",
  "sourceRef": "DOC-004 / 2026-10-20 / Ali Yilmaz / ek not.txt",
  "confidence": "High",
  "dataStatus": "Dokümandan (kaynaklı)",
  "approval": "AI Proposed",
  "workStatus": "Atanmadı",
  "deletedAt": ""
}
```

---

## 6. Prompt'lar ve sistem talimatları

Aşağıdaki metinler `src/main/ai.ts` dosyasından **olduğu gibi** alınmıştır. Başka bir dile veya modele taşırken önce olduğu gibi deneyin; kuralların çoğu gerçek yanlış alarmlardan sonra eklendi (§8).

### 6.1 Sistem talimatı – gereksinim çıkarma (`SYSTEM`)

Her 2. aşama isteğinde sistem mesajıdır.

```text
Sen deneyimli bir sistem / tasarım / kalite mühendisisin (havacılık, savunma, otomotiv, raylı sistemler; kompozit ve mekanik ürünler). Görevin müşteri dokümanlarından doğrulanabilir bir gereksinim listesi çıkarmak.
Kesin kurallar:
- Hiçbir teknik bilgiyi uydurma: değer, tolerans, malzeme, proses parametresi, standart, müşteri gereksinimi veya kabul kriteri yazma; dokümanda yoksa "VERİ YOK – doğrulanmalı" yaz.
- Varsayım yapmak zorundaysan metne "AI VARSAYIMI – mühendislik doğrulaması gerekli" ekle; öneriler "AI RECOMMENDATION" olarak işaretlenir.
- Her gereksinim tek, doğrulanabilir bir ifade olsun ("shall / -malıdır"). Birleşik cümleleri ayrı gereksinimlere böl.
- Her satıra kaynak ver (doküman ID/no, sayfa, bölüm, ölçü/balon no, e-posta tarihi/göndereni). Kaynak yoksa boş bırak.
- Her gereksinim için kanıt yöntemini belirt: evidenceType listeden seçilir; evidence alanına kanıtın somut biçimini yaz (ör. "CMM ölçüm raporu, balon 12–15", "Tuz sisi test raporu ISO 9227", "CATIA model ölçüsü ekran görüntüsü", "Malzeme sertifikası EN 10204 3.1"). Doküman bir doğrulama yöntemi belirtiyorsa onu kullan; belirtmiyorsa öneri yap ve sonuna "(AI RECOMMENDATION)" ekle.
- Gereksinimi yerine getirecek disiplini öner: Tasarım (geometri, malzeme, performans, arayüz), Konfigürasyon (parça no, revizyon, varyant, doküman/etiketleme, teslimat içeriği), İmalat (proses, yüzey işlem, muayene, ambalaj).
- Güven (confidence) değerini dürüst ver: dokümandan doğrudan çıkmayanlar Medium/Low.
- Dokümandan çıkarılamayan ama kritik olabilecek konuları, çelişkileri (iki kaynak farklı değer veriyor), belirsiz ifadeleri ("uygun", "yeterli", "mümkün olduğunca") ve eksik kabul kriterlerini gereksinim gibi yazma; "issues" listesine açık mühendislik konusu olarak ekle (Critical / Important / Optional).
- Metinleri Türkçe yaz; teknik terimler İngilizce kalabilir.
```

### 6.2 Sistem talimatı – bölge dökümü (`TRANSCRIBE_SYSTEM`)

1. aşamada her bölge isteğinin sistem mesajıdır. Kullanıcı mesajının yapısı:

```
[metin] GD&T sembol rehberi (çizimin parçası değildir; yalnızca sembolleri tanımak için)
[görüntü] rehber
[metin] Sayfa 1/1 – genel görünüm (küçültülmüş; ayrıntılar bölge görüntülerinde) (yalnızca bağlam için)
[görüntü] genel görünüm          ← cache_control: ephemeral
[metin] BÖLGE: Sayfa 1/1 – bölge B3 (satır 2/3, sütun 3/4; yatay %48–100, dikey %33–80)
        Bu bölgede görünen her şeyi döküm listesi olarak yaz.
[görüntü] bölge
```

```text
Sen teknik resim okuyan dikkatli bir kalite kontrol teknisyenisin. Görevin yalnızca sana gösterilen BÖLGE görüntüsünde görünenleri eksiksiz ve aynen yazıya dökmek; yorum yapma, gereksinim yazma.
Kurallar:
- Her ölçüyü toleransı/uyum sınıfıyla (ör. "Ø30 H7", "12 ±0.05", "120 +0.2/-0.1") aynen yaz. Çerçeveli ölçü TED'dir, "TED" diye belirt.
- Tolerans çerçevelerini soldan sağa hücre hücre oku; sembolü GD&T rehberindeki çizimlerle karşılaştırarak adlandır. Ⓜ/Ⓛ gibi daire içindeki harfleri ayrıca belirt. Çok satırlı çerçevenin her satırı ayrı öğedir.
- Çerçevenin üstündeki/yanındaki "4X Ø8.5" gibi yazıyı ve ok/çizgiyle bağlandığı özelliği "neye ait" alanına yaz.
- Referans (datum) işaretlerini, yüzey pürüzlülüğü sembollerini, notları, antet hücrelerini de ayrı öğe olarak yaz.
- Bölge kenarında kesilen öğeyi görünen kadarıyla yaz ve "kesik" işaretle (komşu bölgede tamamı görünür).
- Okuyamadığın ya da emin olmadığın değeri tahmin etme; "okunurluk" alanını "Belirsiz" yap.
- Genel görünüm ve rehber yalnızca bağlam içindir; onlardaki öğeleri yazma, sadece BÖLGE görüntüsünü dök.
```

Bir bölge isteği hata verirse diğerleri durmaz; o bölge dökümde `(okunamadı: <hata>)` olarak geçer.

### 6.3 Teknik resim kuralları (`DRAWING`)

Doküman tipi "Teknik resim" ise (ve PDF yazı ağırlıklı değilse) ya da bölgeli görüntü varsa, 2. aşama kullanıcı mesajına eklenir.

```text
Bu bir teknik resim. Sana sayfaların genel görünümü, her bölgenin ayrı ayrı yapılmış dökümü ve varsa dosyadan doğrudan okunmuş metinler (DXF/DWG ölçü-not-antet listesi, PDF metin katmanı) verilir. Değerler için önce dosyadan okunan metinlere, sonra bölge dökümlerine güven; genel görünümü hangi görünüş/detay olduğunu anlamak için kullan. Bölgeler örtüştüğü için aynı öğe birden çok dökümde geçebilir: birleştir, aynı gereksinimi iki kez yazma. "Belirsiz" işaretli değerleri kesin değer gibi yazma.
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
Çerçeveli ölçüler (TED) her biri ayrı gereksinimdir; kabul kriterine "TED – tolerans ilgili GD&T çerçevesinde" yaz, "VERİ YOK" yazma.
```

### 6.4 2. aşama kullanıcı mesajı

İçerik blokları bu sırayla eklenir:

1. Dosyanın kendisi: metin kaynaklarında §3'teki düz metin; PDF teknik resimde yalnızca `PDF teknik resim: <ad>` ya da `PDF doküman (metin katmanı): <ad>` başlığı; görselde `Görsel dosya: <ad>`.
2. Varsa PDF metin katmanı: `## PDF metin katmanı (dosyadan okunan yazılar; yazı dolu sayfalar düz metin, resim sayfaları sayfadaki konumuyla)` + metin (en çok 150 000 karakter).
3. Bölge varsa: bölge dökümleri (§5.2) + her sayfanın **yalnızca genel görünümü** (ayrıntı dökümlerdedir). Bölge yoksa tüm görüntüler (rehber hariç).
4. Yapıştırılan metin.
5. Teknik resimse `DRAWING` kuralları.
6. Son talimat (`${…}` yerleri koddan doldurulur):

```text
Bu doküman ${docId} (${docLabel}) olarak kayıtlı. Dokümanı analiz et ve gereksinim listesi çıkar.
Her gereksinimin kaynağını "${docId} / Sayfa x / Bölüm y / Ölçü z" biçiminde ver (e-postada: "${docId} / <tarih> / <gönderen>").
Tip listesi: Functional, Performance, Dimensional, Material, Structural, Environmental, Safety, Reliability, Interface, Manufacturing, Inspection, Regulatory, Customer-specific, Configuration.
Kabul kriteri dokümanda yoksa "VERİ YOK – doğrulanmalı" yaz. Çelişkileri, belirsizlikleri ve eksikleri issues listesine ekle; ilgili gereksinim varsa relatedReq alanına projedeki ID'sini yaz.
Alanları kısa ve öz yaz. Metinlere kendi sıra numaranı (REQ-01 gibi) yazma; relatedReq'e yalnızca projedeki mevcut bir ID yaz, yeni gereksinimler için boş bırak.
document alanına dokümanın kendi numarasını, revizyonunu ve adını yaz (teknik resimde antetten; yoksa boş bırak).
Projedeki dokümanlar:
${existingDocs satır satır | "(yok)"}
AYNI RESİM KURALI: Bu doküman listedeki bir dokümanla aynı numara ve revizyona sahipse aynı resmin başka bir formatıdır (PDF / DXF / PNG / DWG). O zaman sameAs alanına o dokümanın ID'sini yaz ve yalnızca farkları bildir: mevcut listede HİÇ karşılığı olmayan bir değer ya da not varsa gereksinim ekle; iki format aynı öğe için farklı değer gösteriyorsa issue aç. Mevcut bir gereksinimi yeniden ifade eden, birleştiren, bölen ya da ondan türetilen madde yazma. Fark yoksa iki liste de boş olmalıdır. Aynı resim değilse sameAs boş kalır.
Projede zaten bulunan gereksinimler (tekrar etme; çelişki varsa issue aç):
${existing ilk 300 satır | "(yok)"}
Projede zaten açık olan konular (aynı konuyu tekrar açma; yeni bilgi varsa yeni bir konu olarak değil, yalnızca gerçekten farklıysa ekle):
${existingIssues ilk 200 satır | "(yok)"}
```

Bağlam listelerinin satır biçimleri:

```
existingDocs:   DOC-001 · no FLN-3010 · rev A · FLN-3010_A (pdf)
existing:       REQ-004 [Dimensional] Ø30 H7 delik … | Kabul: Ø30 +0.021/0
existingIssues: ISS-002 [Important] Kaplama kapsamı belirtilmemiş …
```

`existing` silinmemiş tüm gereksinimleri, `existingIssues` silinmemiş ve `Resolved` / `Closed` olmayan açık konuları içerir.

---

## 7. Kaynak izleme, güven, tekilleştirme ve doğrulama

### 7.1 Kaynak izleme

- İki katmanlıdır: **`sourceDocId`** (hangi doküman, koddan atanır, model değiştiremez) ve **`sourceRef`** (doküman içi yer, modelden gelir).
- Biçimler: `DOC-001 / Sayfa 1 / Bölge B3 / Not 4`, `DOC-001 / Antet`, e-postada `DOC-004 / <tarih> / <gönderen>`.
- Çok sayfalı resimde her sayfanın kendi antetindeki parça no kaynağa yazılır; `document.number` ilk (ana) sayfanınkidir.
- Kaynak yoksa boş bırakılır, uydurulmaz.
- Değişiklik günlüğü (`history`) her alan değişikliğini kim/ne zaman/eski/yeni olarak tutar; böylece AI önerisinin sonradan nasıl düzeltildiği izlenir.

### 7.2 Güven ve veri durumu

- **Sayısal puan yoktur.** Model `confidence` olarak High / Medium / Low verir. Kural: dokümandan doğrudan çıkmayan her şey Medium veya Low; bölgeler arasında okuma farkı varsa ve emin değilse Low.
- **`dataStatus`** kodla belirlenir: kabul kriterinde `VERİ YOK` geçiyorsa `VERİ YOK – doğrulanmalı`, yoksa `Dokümandan (kaynaklı)`. Diğer iki durum (`AI VARSAYIMI …`, `AI RECOMMENDATION`) listede vardır ama yalnızca elle seçilir; model bunları metnin içine yazar.
- 1. aşamada her öğenin okunurluğu (`Net / Belirsiz / Kesik`) dökümde işaretlenir; 2. aşama "Belirsiz" değeri kesin değer gibi yazmaz.
- Değerlerin güven sırası: **dosyadan okunan metin (DXF, PDF metin katmanı) > bölge dökümü > genel görünüm**.

### 7.3 Tekilleştirme

Kodda metin karşılaştırmalı bir tekilleştirme yoktur. Tekrarı önleyen mekanizmalar:

1. **Bağlam listeleri** (§6.4): Projedeki gereksinimler (en çok 300) ve açık konular (en çok 200) her istekte modele verilir; "tekrar etme" kuralı vardır.
2. **Toplu yüklemede birikim:** Aynı seferde önceki dosyadan çıkanlar `(yeni) …` önekiyle listeye eklenir.
3. **Örtüşen bölgeler:** `DRAWING` kuralı, aynı öğenin birden çok dökümde geçtiğini ve birleştirilmesi gerektiğini söyler.
4. **Aynı resim, farklı format** (`Ai.tsx`):
   - Model `document.number / revision` döndürür; kod bunu projedeki dokümanlarla **normalize ederek** karşılaştırır (boşluk, `_`, `.`, `-` atılır, büyük harf). Eşleşme yoksa modelin `sameAs` cevabı, yalnızca projede gerçekten olan bir ID ise kabul edilir.
   - Eşleşen ("ikiz") dokümandan gelen öneriler önizlemede **varsayılan olarak seçili gelmez**; kullanıcı gerçekten eksikse işaretler.
   - Dokümanın notuna `DOC-001 ile aynı resim (farklı format).` yazılır.
5. **Tek issue kuralları:** Okunamayan değerler için tek issue; tekrarlı öğelerde adet eksikliği için tüm resimde tek Optional issue; antet düzeni için en fazla bir Optional issue.
6. **Numara temizliği:** Model metnin başına kendi numarasını yazarsa (`REQ-01: …`, `ISS 3 - …`) silinir: `/^\s*(REQ|ISS)-?\d+\s*[:.–-]\s*/i`.

### 7.4 Doğrulama

| Katman | Ne yapılır |
|---|---|
| Biçim | JSON şemalı yapılandırılmış çıktı: enum alanları dışında değer gelemez, eksik alan olamaz. |
| Kesilme | `max_tokens` ile kesilirse bir kez düşük çabayla yeniden; yine kesilirse "dokümanı bölümlere ayırın" hatası. Yarım JSON asla kaydedilmez. |
| Ret | `refusal` kullanıcıya bildirilir. |
| Kaynak hataları | Okunamayan ek, atlanan sayfa, kesilen metin, düşük çözünürlük, EMF/WMF → kullanıcıya not (önizlemede "Okunamayan dosyalar"). İşlem durmaz. |
| ID geçerliliği | `relatedReq` için yalnızca projedeki mevcut ID istenir; `sameAs` kodda doğrulanır. |
| İnsan onayı | Her kayıt `AI Proposed` olarak, önizlemede seçilerek eklenir. Onay akışı: Engineer Reviewed → Approved / Rejected. |
| Doğruluk ölçümü | Gerçek API doğruluğu, kullanıcının Excel raporlarının resmin gerçek içeriğiyle elle karşılaştırılmasıyla ölçülür (`ornek-resim/kontrol-*.md`). Otomatik testler (`tests/`, `tests/e2e/teknik-resim.mjs`) dönüştürme hattını sahte bir Claude sunucusuyla sınar, model doğruluğunu değil. |

---

## 8. Bilinen sınırlamalar ve dersler

### 8.1 Sınırlamalar

- **Uzun şartnameler:** İstek başına 150 000 karakter metin. ~120 sayfalık bir şartname tek seferde okunamaz; bölümlere ayrılıp ayrı yüklenmelidir. Parçalı (chunked) çıkarma henüz yok.
- **Görüntü sınırı:** İstek başına 80 görüntü, 16 MB. Çok sayfalı resimlerde sayfa başına bölge bütçesi düşer, çözünürlük azalır; sınırı aşan sayfalar yalnızca metin olarak gider.
- **Metin katmanı olmayan PDF** ("Microsoft Print to PDF"): her şey görüntüden okunur, kutu/çerçeve vektörden tanınamaz.
- **DWG:** ODA File Converter kurulu değilse okunamaz.
- **Word içindeki EMF/WMF çizimler** okunamaz. Yapıştırılmış düşük çözünürlüklü resimler büyütülemez.
- **Eski Office biçimleri** (`.doc`, `.xls`) desteklenmez.
- **Bağlam listesi sınırı:** 300 gereksinim ve 200 açık konudan sonrası modele gösterilmez; büyük projelerde tekrar riski artar.
- **Tekilleştirme modele bağlıdır:** Kodda benzer metin karşılaştırması yoktur.
- **Güven kategoriktir**, sayısal ve kalibre edilmiş değildir.
- **Karışık PDF'ler** (şartname + birkaç resim sayfası): resim sayfası bölgelere ayrılırsa teknik resim kuralları tüm belgeye uygulanır; şartname metnine de bu kurallar gider.
- **`dataStatus`** yalnızca "VERİ YOK" metnine bakar; `AI VARSAYIMI` / `AI RECOMMENDATION` durumları otomatik atanmaz.
- **STEP/CAD modeli karşılaştırması** bu yöntemin parçası değildir (yol haritasında).

### 8.2 Dersler (gerçek denemelerden)

FLN-3010 örnek resmi (PDF, DXF, PNG) ve 10062310 (CES, iki sayfa) denemeleri:

1. **Yanlış alarmların ana kaynağı bölge kenarında kesilen öğelerdir.** Bir bölgede yarım görünen `A|B` çerçevesi ile komşu bölgedeki `A|B|C` "çelişki" diye raporlandı. Çözüm: kağıt boyutuna göre ~10 px/mm (A3'te 24 yerine 12 bölge, yarı maliyet), %25 örtüşme ve "kesik/belirsiz okuma ile tam okuma arasındaki fark çelişki değildir" kuralı.
2. **Bölgeler arası okuma farkı asla issue değildir.** Bu, resmin kusuru değil okuma hatasıdır. En net okuma ya da dosya metni karar verir.
3. **Dosyadan okunan metin görüntüden üstündür.** DXF'te kutulu ölçüler (TED), çerçeveler ve datumlar dosyadan doğrudan tanındığında PDF'te kaçan 5 TED ölçüsü yakalandı.
4. **Aynı konu her formatta yeniden açılıyordu.** Projedeki açık konuları bağlam olarak vermek ve ikiz formatın önerilerini seçili getirmemek bunu çözdü.
5. **Genel tolerans tablosu varken "tolerans yok / VERİ YOK" yazılmamalı.** Toleranssız her ölçüye tablodan aralık seçilip tek değer yazılır (ör. 125 → 120-400 → ±2.5; Ø18 → 6-30 → ±1.0).
6. **Şablon/form revizyonu resim revizyonu değildir.** Çerçeve altındaki "F25.09, REVISION NO 03" formun kendisine aittir.
7. **Kesit işaretleri (A … A, "A-A") datum değildir.** Datum yalnızca dolu üçgene bağlı kutulu harftir.
8. **Resimde izi olmayan proses için issue açılmaz** (kaynak sembolü yokken kaynak). Tasarımcının tolerans sınıfı seçiminin yeterliliğine görüş bildirilmez; yalnızca hesaplanabilen somut uyumsuzluk (delik–cıvata çapı) issue olur.
9. **Ama kritik eksikler atlanmamalı:** kaldırma aparatında SWL ve güvenlik katsayısı, korumasız karbon çeliğinde yüzey koruması, bağlantı elemanlarında sıkma momenti ve kalite sınıfı.
10. **Parça listesi satırı tek gereksinimdir** (parça no + malzeme + adet). Aynı parça için ayrı malzeme veya "standarda uygun olmalı" maddesi yazılmamalı.
11. **Bilgi amaçlı antet alanları gereksinim değildir** (kütle, tarih, çizen); yalnızca parça no, revizyon ve malzeme konfigürasyon gereksinimidir.
12. **Küçük modelde iki aşama şarttır.** Haiku tüm resmi bir kerede yorumlarken çok şey kaçırdı; önce dökme, sonra çıkarma ve GD&T rehber görseli sembol tanımayı belirgin iyileştirdi.
13. **Yazı dolu PDF'yi görüntüye çevirmek hatadır.** 38 sayfalık şartname görüntü sınırına takıldı; ≥1500 karakterli sayfaları metin olarak göndermek çözdü.
14. **Model kendi numarasını yazar** ("REQ-01: …"); projedeki ID ile karışmaması için temizlenmeli ve prompt'ta yasaklanmalı.

---

## 9. Başka bir uygulamada kurmak için kontrol listesi

### A. Veri modeli
- [ ] Doküman, gereksinim, açık konu tablolarını §5.3'teki alanlarla kurun.
- [ ] Kalıcı ID sayacı: `DOC-001`, `REQ-001`, `ISS-001`; silinen numara tekrar verilmez.
- [ ] Yumuşak silme (gerekçeli) ve alan bazında değişiklik günlüğü.
- [ ] `sourceDocId` (koddan) ve `sourceRef` (modelden) ayrı alanlar.
- [ ] Onay durumu (`AI Proposed` → `Engineer Reviewed` → `Approved` / `Rejected`) ve açık konu durumu (`Open` … `Closed`).

### B. Kaynak hazırlama
- [ ] Word → HTML → düz metin, **tablolar ` | ` ayraçlı** (§3.1). Gömülü görselleri ayrıca çıkarın.
- [ ] Excel → `R<n>: a | b | c`, formül sonuçlarıyla (§3.2).
- [ ] E-posta → başlık (konu, gönderen, alıcı, tarih) + gövde + ekleri aynı dönüştürücüyle, iç içe en çok 2 düzey; imza logolarını atın (§3.3).
- [ ] PDF → önce metin katmanı; ≥1500 karakterli sayfaları metin, diğerlerini görüntü olarak (§3.4).
- [ ] Teknik resim görüntüleri → ~10 px/mm, 1568 px bölgeler, %25 örtüşme, genel görünüm, boş bölgeleri atma, istek başına ≤80 görüntü (§3.5).
- [ ] GD&T sembol rehberi görselini her bölgeli isteğe ekleyin.
- [ ] DXF varsa: ölçüleri (TED dahil), tolerans çerçevelerini, datumları ve anteti dosyadan okuyup metin olarak verin; DWG için ODA File Converter (§3.6).
- [ ] Her kaynak hatasını kullanıcıya not olarak gösterin, işlemi durdurmayın.

### C. Model çağrıları
- [ ] Yapılandırılmış çıktı (JSON şema, `additionalProperties: false`, tüm alanlar zorunlu, enum'lar) (§5.1, §5.2).
- [ ] Bölgeli görüntüde iki aşama: önce her bölgeyi `TRANSCRIBE_SYSTEM` ile dökün (paralel, ortak önek önbellekli), sonra dökümler + genel görünümler + dosya metni ile çıkarın.
- [ ] Sistem talimatı `SYSTEM` (§6.1), teknik resimse `DRAWING` kuralları (§6.3), son talimat (§6.4).
- [ ] Bağlam: projedeki dokümanlar (no/rev), mevcut gereksinimler, açık konular.
- [ ] Uzun çıktıyı akışla alın; `max_tokens` kesilmesinde bir kez düşük çabayla yeniden deneyin; ret ve kesilmede yarım veri kaydetmeyin.
- [ ] İptal düğmesi.

### D. Son işlem ve onay
- [ ] Metin başındaki `REQ-xx:` / `ISS-xx:` numaralarını silin.
- [ ] Doküman no/rev'i kayda yazın; normalize karşılaştırmayla "aynı resim, farklı format" tespiti; ikiz önerileri seçili getirmeyin.
- [ ] `dataStatus` = kabul kriterinde "VERİ YOK" varsa `VERİ YOK – doğrulanmalı`.
- [ ] Önizleme ekranı: tüm öneriler işaretli tablo (ikizler hariç), okunamayan dosya notları; yalnızca seçilenler eklenir.
- [ ] Toplu yüklemede her dosyadan çıkanları bir sonrakinin bağlamına ekleyin.

### E. Doğruluk
- [ ] En az bir örnek resim ve bir şartname ile "altın" bir gereksinim/issue listesi hazırlayın.
- [ ] Her denemede çıktıyı bu listeyle karşılaştırın; doğru / hatalı / eksik gereksinim ve geçerli / yanlış alarm issue sayın (`ornek-resim/kontrol-*.md` biçimi).
- [ ] Yanlış alarmları prompt'a **genel kural** olarak ekleyin (tek örneğe özel değil), §8.2'deki dersleri baştan uygulayın.
- [ ] Hattı (dönüştürme, bölgeleme, şema) sahte model sunucusuyla otomatik test edin; model doğruluğunu ayrı ölçün.

### F. Güvenlik ve işletme
- [ ] API anahtarı ortam değişkeninde veya işletim sisteminin şifreli deposunda; dokümanlara gömülmez.
- [ ] Kullanıcıyı dokümanların model sağlayıcısına gönderildiği konusunda bilgilendirin (gizlilik sınıfı).
- [ ] Uzun dokümanlar için bölümlere ayırma yolunu belgeleyin.
