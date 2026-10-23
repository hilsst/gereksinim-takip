export type TabKey = 'overview' | 'documents' | 'requirements' | 'issues' | 'people' | 'planner';

export const TABS: { key: TabKey; label: string; icon: string; tone: string; group: string; title: string; hint: string }[] = [
  { key: 'overview', label: 'Özet', icon: '◆', tone: 'lav', group: 'Proje', title: 'Özet', hint: 'Proje bilgileri, atama durumu ve kişi bazında ilerleme.' },
  { key: 'documents', label: 'Dokümanlar', icon: '▤', tone: 'sky', group: 'Girdi', title: 'Kaynak dokümanlar', hint: 'Word, Excel, teknik resim ve müşteri e-postalarını yükleyin; Claude gereksinim ve açık konuları çıkarır.' },
  { key: 'requirements', label: 'Gereksinimler', icon: '✓', tone: 'lav', group: 'Girdi', title: 'Gereksinim listesi', hint: 'Her gereksinimin kabul kriteri, kanıtı ve sorumlusu. Satırları seçip atayın ve Planner\'a gönderin.' },
  { key: 'issues', label: 'Açık Konular', icon: '?', tone: 'peach', group: 'Girdi', title: 'Açık konular', hint: 'Eksik bilgi, çelişki ve belirsizlikler (Critical / Important / Optional). Bunlar da atanabilir.' },
  { key: 'people', label: 'Ekip', icon: '☺', tone: 'mint', group: 'Takip', title: 'Ekip', hint: 'Tasarım, konfigürasyon ve imalat mühendisleri ile Microsoft 365 hesapları.' },
  { key: 'planner', label: 'Teams Planner', icon: '↻', tone: 'rose', group: 'Takip', title: 'Teams Planner bağlantısı', hint: 'Atamalar Planner görevi olur; tamamlanan görevler uygulamada kapanır ve açıklaması eklenir.' },
];
