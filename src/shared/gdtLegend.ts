// GD&T sembol rehberi (ISO 1101 / ISO 5459): her teknik resim isteğine bir görsel olarak eklenir.
// Küçük modeller sembolleri ezberden değil, bu rehberle karşılaştırarak daha doğru tanır.

const S = 'stroke="#000" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"';

// Her sembol 40×40'lık bir kutunun içine çizilir.
const SYMBOLS: [string, string, string][] = [
  ['Doğrusallık', 'straightness', `<line x1="8" y1="20" x2="32" y2="20" ${S}/>`],
  ['Düzlemsellik', 'flatness', `<polygon points="6,28 26,28 34,12 14,12" ${S}/>`],
  ['Dairesellik', 'circularity / roundness', `<circle cx="20" cy="20" r="11" ${S}/>`],
  ['Silindiriklik', 'cylindricity', `<circle cx="20" cy="20" r="8" ${S}/><line x1="8" y1="32" x2="22" y2="8" ${S}/><line x1="18" y1="32" x2="32" y2="8" ${S}/>`],
  ['Çizgi profili', 'profile of a line', `<path d="M8 28 A12 12 0 0 1 32 28" ${S}/>`],
  ['Yüzey profili', 'profile of a surface', `<path d="M8 28 A12 12 0 0 1 32 28 Z" ${S}/>`],
  ['Paralellik', 'parallelism', `<line x1="10" y1="32" x2="20" y2="8" ${S}/><line x1="20" y1="32" x2="30" y2="8" ${S}/>`],
  ['Diklik', 'perpendicularity', `<line x1="8" y1="31" x2="32" y2="31" ${S}/><line x1="20" y1="31" x2="20" y2="8" ${S}/>`],
  ['Açısallık', 'angularity', `<polyline points="32,31 8,31 30,11" ${S}/>`],
  ['Konum', 'position', `<circle cx="20" cy="20" r="9" ${S}/><line x1="6" y1="20" x2="34" y2="20" ${S}/><line x1="20" y1="6" x2="20" y2="34" ${S}/>`],
  ['Eş merkezlilik / eş eksenlilik', 'concentricity / coaxiality', `<circle cx="20" cy="20" r="11" ${S}/><circle cx="20" cy="20" r="5" ${S}/>`],
  ['Simetri', 'symmetry', `<line x1="12" y1="12" x2="28" y2="12" ${S}/><line x1="6" y1="20" x2="34" y2="20" ${S}/><line x1="12" y1="28" x2="28" y2="28" ${S}/>`],
  ['Dairesel salgı', 'circular run-out', `<line x1="10" y1="32" x2="28" y2="10" ${S}/><polygon points="28,10 20,13 25,18" fill="#000" stroke="#000"/>`],
  ['Toplam salgı', 'total run-out', `<line x1="6" y1="32" x2="24" y2="10" ${S}/><line x1="16" y1="32" x2="34" y2="10" ${S}/><line x1="6" y1="32" x2="16" y2="32" ${S}/><polygon points="24,10 16,13 21,18" fill="#000" stroke="#000"/><polygon points="34,10 26,13 31,18" fill="#000" stroke="#000"/>`],
];

const MODIFIERS: [string, string, string][] = [
  ['Ⓜ Maksimum malzeme şartı (MMC)', 'M', `<circle cx="20" cy="20" r="11" ${S}/>`],
  ['Ⓛ Minimum malzeme şartı (LMC)', 'L', `<circle cx="20" cy="20" r="11" ${S}/>`],
  ['Ⓟ Uzatılmış tolerans bölgesi', 'P', `<circle cx="20" cy="20" r="11" ${S}/>`],
  ['Ⓔ Zarf şartı', 'E', `<circle cx="20" cy="20" r="11" ${S}/>`],
  ['Ø Tolerans bölgesi silindirik (çap)', 'Ø', ''],
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function cell(x: number, y: number, inner: string, letter?: string) {
  const t = letter ? `<text x="20" y="27" font-size="${letter === 'Ø' ? 22 : 18}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif">${esc(letter)}</text>` : '';
  return `<g transform="translate(${x} ${y})"><rect width="40" height="40" ${S}/>${inner}${t}</g>`;
}

/** Rehberi SVG olarak verir (≈ 1100×760 px). */
export function gdtLegendSvg(): string {
  const W = 1100;
  const out: string[] = [];
  out.push('<text x="20" y="36" font-size="24" font-weight="bold">GD&amp;T SEMBOL REHBERİ (ISO 1101 / ISO 5459) – resimdeki sembolleri bununla karşılaştır</text>');
  SYMBOLS.forEach(([tr, en, svg], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 20 + col * 540;
    const y = 60 + row * 52;
    out.push(cell(x, y, svg));
    out.push(`<text x="${x + 54}" y="${y + 27}" font-size="19">${esc(tr)} <tspan fill="#555">(${esc(en)})</tspan></text>`);
  });
  let y = 60 + 7 * 52 + 14;
  out.push(`<text x="20" y="${y}" font-size="20" font-weight="bold">Değiştiriciler</text>`);
  y += 12;
  MODIFIERS.forEach(([tr, letter, svg], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 20 + col * 540;
    const yy = y + row * 52;
    out.push(cell(x, yy, svg, letter));
    out.push(`<text x="${x + 54}" y="${yy + 27}" font-size="19">${esc(tr)}</text>`);
  });
  y += 3 * 52 + 10;
  // Örnek tolerans çerçevesi ve okunuşu
  out.push(`<text x="20" y="${y}" font-size="20" font-weight="bold">Tolerans çerçevesi soldan sağa okunur</text>`);
  y += 12;
  const fx = 20;
  out.push(cell(fx, y, SYMBOLS[9][2]));
  out.push(`<g transform="translate(${fx + 40} ${y})"><rect width="110" height="40" ${S}/><text x="8" y="28" font-size="20" font-family="Arial">Ø0.2</text><circle cx="88" cy="20" r="11" ${S}/><text x="88" y="27" font-size="16" text-anchor="middle" font-family="Arial">M</text></g>`);
  ['A', 'B', 'C'].forEach((l, i) => out.push(`<g transform="translate(${fx + 150 + i * 40} ${y})"><rect width="40" height="40" ${S}/><text x="20" y="28" font-size="20" text-anchor="middle" font-family="Arial">${l}</text></g>`));
  out.push(`<text x="${fx + 290}" y="${y + 18}" font-size="18">= Konum toleransı, silindirik bölge Ø0.2, MMC'de; referanslar A (birincil), B, C.</text>`);
  out.push(`<text x="${fx + 290}" y="${y + 40}" font-size="18">Üstündeki "4X Ø8.5" gibi yazı, toleransın hangi özelliğe (4 deliğe) ait olduğunu söyler.</text>`);
  y += 62;
  // Referans işareti ve TED
  out.push(`<line x1="${fx - 14}" y1="${y + 4}" x2="${fx + 38}" y2="${y + 4}" ${S}/><polygon points="${fx},${y + 4} ${fx + 24},${y + 4} ${fx + 12},${y + 20}" fill="#000"/><line x1="${fx + 12}" y1="${y + 20}" x2="${fx + 12}" y2="${y + 32}" ${S}/><g transform="translate(${fx - 8} ${y + 32})"><rect width="40" height="40" ${S}/><text x="20" y="28" font-size="20" text-anchor="middle" font-family="Arial">A</text></g>`);
  out.push(`<text x="${fx + 50}" y="${y + 48}" font-size="18">Referans (datum) işareti: dolu üçgenin tabanı yüzeye oturur; kutudaki harf referansın adı.</text>`);
  out.push(`<g transform="translate(${fx + 800} ${y + 26})"><rect width="54" height="32" ${S}/><text x="27" y="23" font-size="20" text-anchor="middle" font-family="Arial">50</text></g>`);
  out.push(`<text x="${fx + 866}" y="${y + 48}" font-size="18">Çerçeveli ölçü = TED</text>`);
  out.push(`<text x="${fx + 800}" y="${y + 80}" font-size="16" fill="#333">(teorik tam ölçü, toleranssız)</text>`);
  const H = y + 100;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/><g font-family="Arial, Helvetica, sans-serif" fill="#000">${out.join('')}</g></svg>`;
}
