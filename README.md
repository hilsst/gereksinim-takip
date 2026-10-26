# Gereksinim Takip

Müşteri dokümanlarından (Word, Excel, PDF / DXF / DWG teknik resim, görsel, Outlook e-postası) gereksinim listesi ve açık konular çıkaran, her gereksinime kanıt yöntemi yazan, gereksinimleri tasarım / konfigürasyon / imalat mühendislerine miatla atayan ve atamaları **Teams Planner** ile senkron tutan masaüstü uygulaması.

Gereksinim ve açık konu mantığı FMEA Studio V4.6 ile aynıdır (REQ / ISS kimlikleri, "VERİ YOK – doğrulanmalı", kaynak gösterme, "AI Proposed" onay akışı); iki uygulama ileride bu kimlikler üzerinden bağlanacaktır.

![Özet](docs/02-ozet.png)

## Kurulum (Windows)

1. GitHub’da **Releases** sayfasından son sürümün `Gereksinim-Takip-Kurulum-….exe` dosyasını indirin (ara derlemeler için **Actions → Build → Gereksinim-Takip-Windows**).
2. `Gereksinim-Takip-Kurulum-….exe` kurulum sihirbazıdır, `Gereksinim-Takip-Tasinabilir-….exe` kurulum gerektirmeden çalışır.
3. Uygulama kod imzalı olmadığı için SmartScreen “Bilinmeyen yayımcı” uyarısı gösterebilir: **Ek bilgi → Yine de çalıştır**.

### Güncellemeler

Kurulu sürüm, FMEA Studio’daki gibi kendini günceller: açılışta GitHub Releases’ta yeni sürüm olup olmadığına bakar, yalnızca değişen blokları indirir (blockmap) ve uygulama kapanırken kurar. İndirme bitince sağ altta **Şimdi yeniden başlat** düğmesi çıkar. Elle denetim: **Yardım → Güncellemeleri Denetle**.

- Güncelleyiciyi içeren ilk sürüm (0.2.0) bir kez tam kurulmalıdır; sonraki sürümler otomatik gelir.
- Taşınabilir sürüm kendini güncellemez.
- Yeni sürüm yayınlamak için `package.json` sürümünü artırıp main'e gönderin (veya `v<sürüm>` etiketi gönderin). CI o sürüm henüz yoksa `v<sürüm>` sürümünü açar ve kurulum dosyasını, `.blockmap` ve `latest.yml` dosyalarını yükler.
- Güncelleyici sürümleri anahtarsız okur; bu yüzden depo (veya sürümlerin yayınlandığı depo) herkese açık olmalıdır.

## Akış

| # | Ekran | Ne yapılır |
|---|---|---|
| 1 | Dokümanlar | Dosyaları yükleyin (çoklu seçim) veya e-posta metnini yapıştırın. Claude gereksinimleri, kanıt yöntemini, önerilen disiplini ve açık konuları çıkarır; önizlemede seçtikleriniz eklenir. |
| 2 | Gereksinimler | Kabul kriteri, **kanıt türü** (ölçüm, test, analiz, muayene, model kontrolü…) ve **kanıt** (beklenen rapor/kayıt). Satırları seçip **Ata** ile disiplin, sorumlu ve miat verin. |
| 3 | Açık Konular | Eksik bilgi, çelişki ve belirsizlikler (Critical / Important / Optional). Bunlar da atanabilir ve Planner’a gönderilebilir. |
| 4 | Ekip | Mühendisler ve Microsoft 365 e-posta adresleri. |
| 5 | Teams Planner | Bağlantı, plan seçimi, otomatik kontrol aralığı ve senkron günlüğü. |
| 6 | Geçmiş | Değişiklik günlüğü: kim (Windows kullanıcı adı), ne zaman, hangi kaydın hangi alanı, eski ve yeni değer. Planner kapanışları “Teams Planner” adıyla yazılır. |
| – | Özet | Sayaçlar ve kişi bazında açık / gecikmiş / zamanında kapanan oranı. |

Desteklenen dosyalar: `.docx`, `.xlsx`/`.xlsm`, `.pdf`, `.dxf`, `.dwg`, `.png`/`.jpg`/`.tif`/`.bmp`, `.msg`, `.eml` (e-posta ekleri de okunur), `.txt`/`.csv`/`.md`/`.html`. Eski `.doc` / `.xls` biçimlerini önce yeni biçimde kaydedin.

**Teknik resimler.** Türü "Teknik resim" olan PDF'ler ve tüm görseller (TIFF dahil) yüksek çözünürlükte işlenir ve her sayfa bir genel görünüm + örtüşen bölgeler (A1, A2, B1…) olarak Claude'a gönderilir; böylece A3–A0 resimlerdeki ölçü ve tolerans yazıları okunabilir. DXF dosyalarında ölçüler (görünen tolerans metniyle), notlar ve antet öznitelikleri doğrudan dosyadan okunur, çizim ayrıca görüntü olarak gönderilir. **DWG** için ücretsiz [ODA File Converter](https://www.opendesign.com/guestfiles/oda_file_converter) kurulu olmalıdır (varsayılan yere kurulduğunda uygulama kendisi bulur; farklı yerdeyse `ODA_FILE_CONVERTER` ortam değişkeniyle yolunu verin); kurulu değilse çizimi DXF veya PDF olarak kaydedip yükleyin. İşlem sürerken geçen süre görünür ve İptal edilebilir. Haiku'nun doğruluğu için okuma iki aşamalıdır: önce her bölge, bir GD&T sembol rehberi ve sayfanın genel görünümüyle birlikte ayrı ayrı dökülür (ölçüler, tolerans çerçeveleri, referanslar, notlar); ardından gereksinimler bu dökümlerden ve PDF'in metin katmanından (konumlarıyla) çıkarılır. Sayfalar kağıt boyutuna göre ~10 piksel/mm işlenir (DXF'te yazı yüksekliğine göre); bu, tolerans çerçevelerinin bölge kenarında kesilmesini azaltır. DXF'te çizgiyle çizilmiş tolerans çerçeveleri (hücreleriyle), kutulu referans harfleri ve kutulu ölçüler (TED) dosyadan doğrudan tanınır; gizli/eksen çizgileri kesikli çizilir. Aynı parçanın başka formattaki resmi yüklendiğinde projede açık olan konular tekrar açılmaz.

## Teams Planner senkronu

İki yol vardır, Teams Planner ekranından seçilir:

- **Power Automate (varsayılan)**: Azure kaydı ve Premium lisans gerekmez. OneDrive/SharePoint ile senkron bir klasörde `giden` / `gelen` JSON dosyaları kullanılır. İki akışın kurulum tarifi: [docs/power-automate.md](docs/power-automate.md).
- **Doğrudan bağlantı (Graph)**: Azure uygulama kaydı gerekir. Anlık çalışır; Planner’da değişen miat ve görevin yeniden açılması da uygulamaya gelir. Ayrıntılar aşağıda.

### Graph modu

- **Planner’a gönder**: seçili her atama için plana görev açılır. Görev başlığı `REQ-012 · gereksinim metni`, miat Planner bitiş tarihi, sorumlu kişi görevin atananı olur. Her disiplin için bir kova (Tasarım, Konfigürasyon, İmalat) otomatik oluşturulur. Görev açıklamasına gereksinim, kabul kriteri, kanıt ve kaynak yazılır; sonuna bir ayraç çizgisi eklenir.
- Zaten gönderilmiş bir satırda miat, sorumlu, disiplin veya metin değişirse tekrar **Planner’a gönder** görevi günceller.
- **Kontrol** (uygulama açıkken her N dakikada bir veya “Şimdi kontrol et”):
  - Planner’da **tamamlanan** görev → satır “Kapandı” olur; kapanış tarihi, kapatan kişi ve açıklamadaki **ayraç çizgisinin altındaki metin** “Kapanış Açıklaması” alanına yazılır. Çizgi silinmişse açıklamanın tamamı alınır.
  - %50 → “Devam ediyor”; tamamlanmış görev yeniden açılırsa satır da açılır.
  - Planner’da değiştirilen miat uygulamaya alınır ve günlüğe yazılır.

### Azure uygulama kaydı (bir kez)

1. portal.azure.com → **Microsoft Entra ID → Uygulama kayıtları → Yeni kayıt** (yalnızca bu kuruluş).
2. **Kimlik doğrulama → Platform ekle → Mobil ve masaüstü uygulamaları**, yönlendirme URI’si `http://localhost`.
3. **API izinleri → Microsoft Graph → Temsilci izinleri**: `Tasks.ReadWrite`, `User.ReadBasic.All`. Kuruluş kullanıcı onayına izin vermiyorsa BT’den yönetici onayı isteyin.
4. Uygulama (istemci) ve Dizin (kiracı) kimliklerini Teams Planner ekranına girin, **Microsoft ile giriş yap**.

Giriş kişinin kendi hesabıyla yapılır (delegated); token işletim sisteminin şifreli deposunda saklanır. Yeni “Premium” Planner planları Graph üzerinden erişilemediği için standart (Teams ekibine bağlı) bir plan kullanın.

## Dosyalar

- Proje dosyası: `.greq` (JSON, şema `gereksinim-takip/2`). Kayıt önce geçici dosyaya yazılıp sonra yeniden adlandırılır; ortak ağ klasöründe yarım dosya kalmaz.
- **Kalıcı numara**: REQ / ISS / DOC / P numaraları sayaçla verilir; silinen kaydın numarası başka kayda verilmez.
- **Silme**: kayıt dosyadan çıkmaz, gerekçesiyle “silindi” işaretlenir. Tablodaki **Silinenler** kutusuyla görülür ve geri yüklenir; özet, Planner ve Excel tablolarına girmez.
- **Kaynak**: gereksinim ve açık konuda kaynak doküman (DOC-001) ile doküman içindeki yer (sayfa, madde, ölçü no) ayrı alanlardır.
- **Eski dosyalar** (v0.5 ve öncesi, şema 1) açılırken dönüşür; dönüşmeden önceki hâli yanına `<ad>.sema1-yedek.greq` olarak kopyalanır.
- **Excel raporu**: Özet (kişi bazında), Gereksinimler, Açık Konular, Dokümanlar, Ekip, Planner Günlüğü, Silinenler, Değişiklik Geçmişi.
- AI çıkarma **Claude Haiku** (`claude-haiku-5-5`) modeliyle yapılır ve dokümanları Anthropic API’sine gönderir; anahtar **Ayarlar**’dan girilir veya `ANTHROPIC_API_KEY` ortam değişkeni kullanılır.

## Geliştirme

```bash
npm install
npm run dev          # Vite + Electron
npm test             # Planner senkronu, dosya dönüştürme, özet, Excel testleri
npm run typecheck
npm run build && xvfb-run -a node tests/e2e/smoke.mjs ./shots   # uçtan uca duman testi
xvfb-run -a node tests/e2e/faz1.mjs ./shots                       # silme, kalıcı numara, geçmiş, eski dosya yedeği
xvfb-run -a node tests/e2e/teknik-resim.mjs ./shots resim.pdf plaka.dxf  # teknik resim hazırlama (sahte Claude sunucusuyla)
npm run dist:win     # Windows paketi (Windows veya CI)
```

Kod yapısı:

- `src/main/sources.ts`: Word / Excel / e-posta / PDF / DXF → Claude içerik blokları
- `src/main/dxf.ts`: DXF okuyucu (ölçü, not, antet, SVG çizim), DWG → DXF (ODA File Converter)
- `src/renderer/drawing.ts`, `src/shared/raster.ts`: teknik resimleri sayfa görüntüsü + bölgelere ayırma (pdf.js, UTIF)
- `src/main/ai.ts`: gereksinim + açık konu çıkarma (JSON şema)
- `src/main/graph.ts`: Microsoft Graph istemcisi ve giriş (MSAL)
- `src/shared/planner.ts`: Planner gönderme / kapanış çekme kuralları (ağdan bağımsız, testli)
- `src/shared/summary.ts`: kişi bazında özet (ileride tasarımcı KPI’ları)
- `src/shared/history.ts`: değişiklik günlüğü (önceki / sonraki proje karşılaştırması)
- `src/renderer/`: React arayüzü (pastel tema: `styles.css`)

## Yol haritası

İzlenebilirlik, revizyon ve baseline için dört faz planlandı; Faz 1 (kalıcı kimlik, silindi işareti, kaynak doküman bağı, değişiklik günlüğü) v0.6.0 ile geldi. Sıradakiler: bağlantı tablosu ve doğrulama kayıtları (v0.7), gereksinim revizyonu ve etki analizi (v0.8), baseline ve değişiklik talebi (v0.9).

- ENOVIA’dan indirilen montaj / tek parça STEP dosyasını gereksinim listesiyle karşılaştırma raporu
- Tasarımcı KPI’ları
- FMEA Studio ile REQ / ISS bağlantısı
- Şirket ortak alanında çok kullanıcılı çalışma ve arka planda sürekli Planner senkronu
