# Power Automate ile Teams Planner bağlantısı

Bu yöntem **Azure uygulama kaydı ve Premium lisans gerektirmez**. Uygulama ile Planner arasındaki alışveriş, OneDrive veya SharePoint ile senkron bir klasördeki küçük JSON dosyalarıyla yapılır:

```
GereksinimTakip/
├─ giden/          ← uygulama görev isteği yazar, Akış 1 okur ve siler
└─ gelen/          ← akışlar sonuç yazar, uygulama okur
   └─ islenen/     ← uygulamanın işlediği dosyalar (arşiv)
```

Aşağıda bağlayıcı ve eylem adları önce Türkçe arayüzdeki, parantez içinde İngilizce arayüzdeki adlarıyla verilmiştir.

## Görev başlığı

Görev başlığı proje kodu ile kayıt kimliğinden oluşur: `1522-REQ-001`. Proje kodu **Özet → Proje kodu** alanından gelir; boşsa proje adının başındaki numara kullanılır. Böylece aynı plan ve aynı klasör birden çok projede kullanılabilir: uygulama yalnızca kendi kodunu taşıyan dosyaları işler, diğerlerini o projeyi açana bırakır. Gereksinim metni görevin denetim listesinde, ayrıntıları açıklamada yer alır.

## 0. Hazırlık

1. OneDrive’ınızda (veya ekibin SharePoint kitaplığında) `GereksinimTakip` klasörü oluşturun ve bilgisayarınızla senkron olduğundan emin olun.
2. Uygulamada **Teams Planner → Power Automate → Klasör seç** ile bu klasörü seçin. `giden` ve `gelen` alt klasörleri otomatik oluşur.
3. Teams’de görevlerin açılacağı planı oluşturun (kanal sekmesi → Planner). Plan için **Tasarım**, **Konfigürasyon**, **İmalat** ve **Genel** adlı dört demet (bucket) oluşturun. Görevler, gereksinimin disiplinine göre bu demetlere düşer.
4. Ekip sekmesindeki kişilerin e-postaları, Teams ekibinin üyeleriyle aynı olmalıdır.

## Akış 1 · GT – Görev oluştur

**Yeni → Otomatik bulut akışı**, tetikleyici:

### 1. OneDrive for Business – Bir dosya oluşturulduğunda (When a file is created)
- Klasör: `/GereksinimTakip/giden`
- SharePoint kullanıyorsanız: **SharePoint – Klasörde bir dosya oluşturulduğunda (When a file is created in a folder)**.

### 2. Veri İşlemleri – JSON’u Ayrıştır (Parse JSON)
- İçerik (ifade): `json(base64ToString(triggerBody()?['$content']))`
  - Hata alırsanız içerik olarak doğrudan dinamik **Dosya içeriği (File content)** alanını seçin.
- Şema:

```json
{
  "type": "object",
  "properties": {
    "kaynak": { "type": "string" },
    "islem": { "type": "string" },
    "kayitId": { "type": "string" },
    "gorevId": { "type": "string" },
    "baslik": { "type": "string" },
    "aciklama": { "type": "string" },
    "kontrolListesi": { "type": "string" },
    "baslangicTarihi": { "type": "string" },
    "bitisTarihi": { "type": "string" },
    "sorumluEposta": { "type": "string" },
    "kova": { "type": "string" },
    "proje": { "type": "string" }
  }
}
```

### 3. Koşul (Condition)
- `islem` **eşittir** `olustur`

### 4a. Evet ise (yeni görev)

1. **Planner – Demetleri listele (List buckets)** · Grup kimliği ve Plan kimliği: planınız.
2. **Veri İşlemleri – Diziyi filtrele (Filter array)**
   - Kaynak: `body('Demetleri_listele')?['value']` (İngilizce arayüzde `body('List_buckets')?['value']`)
   - Koşul: `item()?['name']` **eşittir** `kova` (JSON’u Ayrıştır çıktısı)
3. **Planner – Görev oluştur (Create a task)**
   - Grup kimliği, Plan kimliği: planınız
   - Başlık: `baslik`
   - Demet kimliği (özel değer girin, ifade): `first(body('Diziyi_filtrele'))?['id']`
   - Başlangıç Tarihi: `baslangicTarihi` (atama günü)
   - Bitiş Tarihi: `bitisTarihi`
   - Atanan kullanıcı kimlikleri: `sorumluEposta`
4. **Planner – Görev ayrıntılarını güncelleştir (Update task details)**
   - Görev kimliği: *Görev oluştur → Kimlik (Id)*
   - Açıklama: `aciklama`
   - Kontrol listesi öğeleri → **Yeni öğe ekle**: Kimlik `1`, Başlık `kontrolListesi` (gereksinim metni, en çok 100 karakter), İşaretli `Hayır`
   - Önizleme türü: `Kontrol listesi` (kartta gereksinim görünür)
5. **Veri İşlemleri – Oluştur (Compose)**, giriş:

```json
{
  "olay": "olusturuldu",
  "kayitId": "@{body('JSON’u_Ayrıştır')?['kayitId']}",
  "gorevId": "@{outputs('Görev_oluştur')?['body/id']}"
}
```

   Not: Tırnak içindeki ifadeleri yazmak yerine dinamik içerikten **kayitId** ve **Görev oluştur → Kimlik** seçebilirsiniz.

6. **OneDrive for Business – Dosya oluştur (Create file)**
   - Klasör yolu: `/GereksinimTakip/gelen`
   - Dosya adı (ifade): `concat('olusturuldu_', body('JSON’u_Ayrıştır')?['kayitId'], '_', utcNow('yyyyMMddHHmmss'), '.json')`
   - Dosya içeriği: *Oluştur → Çıkışlar (Outputs)*

### 4b. Hayır ise (mevcut görevi güncelle)

1. **Planner – Görevi güncelleştir (Update a task)**
   - Görev kimliği: `gorevId`
   - Başlık: `baslik`
   - Bitiş Tarihi: `bitisTarihi`
   - Eylemde “Atanan kullanıcı kimlikleri” alanı varsa `sorumluEposta` ekleyin. Eski sorumluyu Planner’dan elle çıkarın.

### 5. OneDrive for Business – Dosyayı sil (Delete file)
- Koşulun dışında, en sonda. Dosya: tetikleyicinin **Dosya tanımlayıcısı (File identifier)**.

### (İsteğe bağlı) Hata bildirimi
Koşul eyleminin **…→ Çalıştırma sonrasını yapılandır (Configure run after)** ayarında “başarısız oldu” seçili bir **Dosya oluştur** ekleyin:

- Klasör: `/GereksinimTakip/gelen`, dosya adı: `concat('hata_', utcNow('yyyyMMddHHmmss'), '.json')`
- İçerik: `{"olay":"hata","kayitId":"@{body('JSON’u_Ayrıştır')?['kayitId']}","mesaj":"Görev oluşturulamadı"}`

Uygulama bu dosyayı görünce satırdaki “Kuyrukta” işaretini kaldırır ve hatayı günlüğe yazar. Böylece satırı tekrar gönderebilirsiniz.

## Akış 2 · GT – Görev tamamlandı

**Yeni → Otomatik bulut akışı**, tetikleyici:

### 1. Planner – Bir görev tamamlandığında (When a task is completed)
- Grup kimliği, Plan kimliği: planınız

### 2. Koşul (Condition)
- İfade: `or(contains(triggerOutputs()?['body/title'], 'REQ-'), contains(triggerOutputs()?['body/title'], 'ISS-'))` **eşittir** `true`
- Hayır dalı boş kalır. Böylece plandaki başka görevler uygulamaya gelmez.

### 3. Evet ise
1. **Planner – Görev ayrıntılarını al (Get task details)** · Görev kimliği: tetikleyicinin **Kimlik (Id)** alanı.
2. **Veri İşlemleri – Oluştur (Compose)**, giriş:

```json
{
  "olay": "tamamlandi",
  "gorevId": "@{triggerOutputs()?['body/id']}",
  "baslik": "@{triggerOutputs()?['body/title']}",
  "aciklama": "@{outputs('Görev_ayrıntılarını_al')?['body/description']}",
  "tamamlanmaTarihi": "@{triggerOutputs()?['body/completedDateTime']}"
}
```

   Compose girişini **nesne** olarak bırakın (tırnaklı metin değil). Böylece açıklamadaki satır sonları ve tırnaklar JSON içinde doğru kaçışlanır.

3. **OneDrive for Business – Dosya oluştur (Create file)**
   - Klasör yolu: `/GereksinimTakip/gelen`
   - Dosya adı (ifade): `concat('tamamlandi_', triggerOutputs()?['body/id'], '.json')`
   - Dosya içeriği: *Oluştur → Çıkışlar*

## Akış 3 · GT – Ekip üyeleri (isteğe bağlı)

Teams ekibinin üyelerini uygulamanın **Ekip** listesine getirir. Kişiler bir kez gelince bilgisayarda saklanır ve yeni projelere otomatik eklenir; disiplin unvandan tahmin edilir (Tasarım / Konfigürasyon / İmalat), gerekirse elle düzeltilir.

1. **Oluştur → Zamanlanmış bulut akışı (Scheduled cloud flow)**, ad `GT – Ekip üyeleri`, her 1 günde bir. Gerektiğinde akış sayfasındaki **Çalıştır** ile elle de çalışır.
2. **Office 365 Grupları – Grup üyelerini listele (List group members)**, adı `Uyeler`. Grup kimliği: planın bağlı olduğu Teams ekibi (ör. Savunma/Havacılık).
3. **Veri İşlemleri – Seç (Select)**, adı `Sec`.
   - Kaynak: ifade `body('Uyeler')?['value']`
   - Eşle (metin modu kapalıyken üç satır): `ad` → ifade `item()?['displayName']`, `eposta` → `item()?['mail']`, `unvan` → `item()?['jobTitle']`
4. **Veri İşlemleri – Oluştur (Compose)**, adı `Liste`, giriş:

```json
{"olay":"uyeler","uyeler":"@body('Sec')"}
```

5. **OneDrive for Business – Dosya oluştur**: klasör `/GereksinimTakip/gelen`, dosya adı ifade `concat('uyeler_', utcNow('yyyyMMddHHmmss'), '.json')`, içerik *Liste → Çıkışlar*.

## Deneme

1. Uygulamada bir gereksinime sorumlu ve miat verin, **Planner’a gönder** deyin. Satırın Planner kolonunda **Kuyrukta** yazar.
2. Bir dakika içinde görev Planner’da açılmalı, `giden` klasörü boşalmalıdır. Uygulama bir sonraki kontrolde satırı **Gönderildi** yapar.
3. Planner’da görev açıklamasındaki “Kapanış açıklamasını bu çizginin altına yazın” satırının altına bir not yazın ve görevi **tamamlandı** işaretleyin.
4. Uygulamada **Şimdi kontrol et** deyin. Satır **Kapandı** olur ve not **Kapanış Açıklaması** alanında görünür.

## Sınırlar

- Görevler akışı kuran kişinin bağlantısıyla açılır. Planner’da “oluşturan” bu kişidir.
- Planner’da elle değiştirilen miat veya sorumlu uygulamaya geri gelmez. Bu değişiklikler için Graph modunu kullanın.
- Akışların gecikmesi OneDrive senkronu dahil genellikle 1–5 dakikadır.
- Görev yeniden açılırsa (tamamlandı işareti kaldırılırsa) bu bilgi akışla gelmez. Satırı uygulamada elle açın.
