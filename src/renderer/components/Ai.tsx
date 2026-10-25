import { useEffect, useState } from 'react';
import { blankRow, nextId, NO_DATA } from '../../shared/model';
import type { DocumentRow, IssueRow, Project, RequirementRow } from '../../shared/types';
import { api, isDesktop } from '../api';
import { needsRaster, type DrawingImage } from '../../shared/raster';
import { useStore } from '../store';
import { Modal } from './Modal';

type Json = Record<string, unknown>;
interface Proposal {
  docs: DocumentRow[];
  requirements: (Json & { docId: string })[];
  issues: (Json & { docId: string })[];
  errors: string[];
}

const DOC_TYPE: Record<string, string> = {
  pdf: 'Teknik resim', dwg: 'Teknik resim', dxf: 'Teknik resim', png: 'Teknik resim', jpg: 'Teknik resim', jpeg: 'Teknik resim', tif: 'Teknik resim', tiff: 'Teknik resim', bmp: 'Teknik resim', docx: 'Teknik şartname',
  xlsx: 'Excel listesi', xlsm: 'Excel listesi', eml: 'E-posta', msg: 'E-posta', txt: 'Diğer', md: 'Diğer', csv: 'Excel listesi',
};

export function existingSummary(p: Project): string[] {
  return p.requirements.filter((r) => !r.deletedAt).map((r) => `${r.id} [${r.reqType}] ${r.text} | Kabul: ${r.acceptance || 'VERİ YOK'}`);
}

export function useExtraction() {
  const { project, mutate, toast } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);

  const guard = async () => {
    if (!isDesktop) {
      toast('AI çıkarma masaüstü uygulamasında çalışır.', 'warn');
      return false;
    }
    if (!(await api.aiStatus()).configured) {
      toast('Önce Ayarlar’dan Claude API anahtarını girin.', 'warn');
      window.dispatchEvent(new CustomEvent('open-settings'));
      return false;
    }
    return true;
  };

  /** Dosyaları doküman olarak kaydeder ve sırayla AI çıkarmasına gönderir. */
  const upload = async (existingDoc?: DocumentRow) => {
    let docs: DocumentRow[];
    if (existingDoc) {
      if (!existingDoc.filePath) {
        toast('Bu dokümana dosya bağlı değil.', 'warn');
        return;
      }
      docs = [existingDoc];
    } else {
      const files = await api.pickFiles(true);
      if (!files.length) return;
      let p = project;
      docs = files.map((f) => {
        const id = nextId(p, 'documents');
        const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
        const row: DocumentRow = { ...(blankRow('documents', id) as DocumentRow), name: f.name.replace(/\.[^.]+$/, ''), docType: DOC_TYPE[ext] ?? 'Diğer', filePath: f.path, date: new Date().toISOString().slice(0, 10) };
        p = { ...p, documents: [...p.documents, row] };
        return row;
      });
      mutate((d) => void d.documents.push(...docs));
      toast(`${docs.length} doküman kaydedildi`);
    }
    if (!(await guard())) return;
    await run(docs.map((d) => ({ doc: d, filePath: d.filePath })));
  };

  const fromText = async (text: string, label: string) => {
    if (!text.trim() || !(await guard())) return;
    const id = nextId(project, 'documents');
    const doc: DocumentRow = { ...(blankRow('documents', id) as DocumentRow), name: label || 'Yapıştırılan metin', docType: 'E-posta', date: new Date().toISOString().slice(0, 10), notes: text.slice(0, 2000) };
    mutate((d) => void d.documents.push(doc));
    await run([{ doc, text }]);
  };

  const run = async (jobs: { doc: DocumentRow; filePath?: string; text?: string }[]) => {
    const out: Proposal = { docs: [], requirements: [], issues: [], errors: [] };
    const existing = existingSummary(project);
    for (const [i, j] of jobs.entries()) {
      const step = `${j.doc.id} · ${j.doc.name} (${i + 1}/${jobs.length})`;
      const fileName = j.filePath?.split(/[\\/]/).pop() ?? '';
      const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
      let images: DrawingImage[] | undefined;
      if (j.filePath && needsRaster(ext, j.doc.docType)) {
        setBusy(`${step}: teknik resim görüntüleri hazırlanıyor…`);
        try {
          const { prepareDrawing } = await import('../drawing'); // pdf.js yalnızca gerektiğinde yüklenir
          const prep = await prepareDrawing(j.filePath, fileName);
          images = prep.images;
          if (prep.note) out.errors.push(`${j.doc.id}: ${prep.note}`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          // DWG çevrilemediyse metin de çıkarılamaz; diğer durumlarda dosyanın kendisiyle devam edilir.
          if (ext === 'dwg' || ext === 'dxf') {
            out.errors.push(`${j.doc.id} ${j.doc.name}: ${msg}`);
            continue;
          }
          out.errors.push(`${j.doc.id}: görüntüler hazırlanamadı (${msg}); dosya olduğu gibi gönderildi.`);
        }
      }
      setBusy(`${step}: Claude okuyor${images?.length ? ` (${images.length} görüntü)` : ''}…`);
      const r = await api.aiRequirements({ filePath: j.filePath, text: j.text, images, drawing: j.doc.docType === 'Teknik resim', docId: j.doc.id, docLabel: `${j.doc.docType} – ${j.doc.name}`, existing });
      if (!r.ok) {
        out.errors.push(`${j.doc.id} ${j.doc.name}: ${r.error}`);
        continue;
      }
      const d = r.data as { requirements: Json[]; issues: Json[] };
      out.docs.push(j.doc);
      out.requirements.push(...d.requirements.map((x) => ({ ...x, docId: j.doc.id })));
      out.issues.push(...d.issues.map((x) => ({ ...x, docId: j.doc.id })));
      existing.push(...d.requirements.map((x) => `(yeni) ${String(x.text)}`));
    }
    setBusy(null);
    if (!out.requirements.length && !out.issues.length) {
      toast(out.errors.length ? `AI hatası: ${out.errors.join(' · ')}` : 'AI bu dokümandan yeni gereksinim çıkarmadı.', out.errors.length ? 'err' : 'warn');
      return;
    }
    setProposal(out);
  };

  const dialogs = (
    <>
      {busy && (
        <div className="modal-back">
          <div className="modal">
            <div className="busy">
              <div className="spinner" />
              <div>
                <b>Claude dokümanı okuyor</b>
                <div className="muted">{busy}</div>
                <Elapsed />
                <button className="btn" onClick={() => void api.aiCancel()}>
                  İptal
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {proposal && <ProposalDialog proposal={proposal} onClose={() => setProposal(null)} />}
    </>
  );

  return { upload, fromText, dialogs, busy: !!busy };
}

function Elapsed() {
  const [s, setS] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setS((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <div className="muted">Geçen süre {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')} · Büyük teknik resimlerde birkaç dakika sürebilir.</div>;
}

function ProposalDialog({ proposal, onClose }: { proposal: Proposal; onClose: () => void }) {
  const { mutate, toast } = useStore();
  const [reqSel, setReqSel] = useState(proposal.requirements.map(() => true));
  const [issSel, setIssSel] = useState(proposal.issues.map(() => true));

  const apply = () => {
    let added = 0;
    mutate((d) => {
      const now = new Date().toISOString();
      proposal.requirements.forEach((r, i) => {
        if (!reqSel[i]) return;
        const id = nextId(d, 'requirements');
        const acceptance = String(r.acceptance ?? '');
        d.requirements.push({
          ...(blankRow('requirements', id) as RequirementRow),
          text: String(r.text ?? ''),
          reqType: String(r.reqType ?? ''),
          acceptance,
          evidenceType: String(r.evidenceType ?? ''),
          evidence: String(r.evidence ?? ''),
          discipline: (String(r.discipline ?? '') as RequirementRow['discipline']) || '',
          sourceDocId: String(r.docId),
          sourceRef: String(r.source ?? ''),
          confidence: (r.confidence as RequirementRow['confidence']) ?? '',
          dataStatus: acceptance.includes('VERİ YOK') ? NO_DATA : 'Dokümandan (kaynaklı)',
          approval: 'AI Proposed',
        });
        added++;
      });
      proposal.issues.forEach((r, i) => {
        if (!issSel[i]) return;
        const id = nextId(d, 'issues');
        d.issues.push({
          ...(blankRow('issues', id) as IssueRow),
          description: String(r.description ?? ''),
          priority: (r.priority as IssueRow['priority']) ?? '',
          sourceDocId: String(r.docId),
          sourceRef: String(r.source ?? ''),
          risk: String(r.risk ?? ''),
          recommendedAction: String(r.recommendedAction ?? ''),
          relatedReq: String(r.relatedReq ?? ''),
          status: 'Open',
        });
        added++;
      });
      for (const doc of proposal.docs) {
        const row = d.documents.find((x) => x.id === doc.id);
        if (row) row.extractedAt = now;
      }
    });
    toast(`${added} kayıt “AI Proposed” olarak eklendi`);
    onClose();
  };

  const toggle = (arr: boolean[], set: (v: boolean[]) => void, i: number, v: boolean) => set(arr.map((x, j) => (j === i ? v : x)));

  return (
    <Modal
      wide
      icon="✦"
      title="Çıkarılan gereksinimleri kontrol edin"
      sub={`${proposal.docs.map((d) => d.id).join(', ')} · Öneriler “AI Proposed” olarak eklenir; eklemek istemediklerinizin işaretini kaldırın.`}
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>
            Vazgeç
          </button>
          <button className="btn primary" onClick={apply}>
            Seçilenleri ekle
          </button>
        </>
      }
    >
      {proposal.errors.length > 0 && <div className="callout peach">Okunamayan dosyalar: {proposal.errors.join(' · ')}</div>}
      <h3>
        <span className="badge b-lav">{proposal.requirements.length}</span> gereksinim
      </h3>
      <div className="preview-scroll">
        <table className="effects">
          <thead>
            <tr>
              <th>
                <input type="checkbox" checked={reqSel.every(Boolean)} onChange={(e) => setReqSel(reqSel.map(() => e.target.checked))} />
              </th>
              <th>Gereksinim</th>
              <th>Tip</th>
              <th>Kabul kriteri</th>
              <th>Kanıt</th>
              <th>Disiplin</th>
              <th>Kaynak</th>
              <th>Güven</th>
            </tr>
          </thead>
          <tbody>
            {proposal.requirements.map((r, i) => (
              <tr key={i}>
                <td>
                  <input type="checkbox" checked={reqSel[i]} onChange={(e) => toggle(reqSel, setReqSel, i, e.target.checked)} />
                </td>
                <td>{String(r.text)}</td>
                <td>{String(r.reqType)}</td>
                <td className={String(r.acceptance).includes('VERİ YOK') ? 'warn' : ''}>{String(r.acceptance)}</td>
                <td>
                  <span className="badge b-lav">{String(r.evidenceType)}</span> {String(r.evidence)}
                </td>
                <td>{String(r.discipline)}</td>
                <td>{String(r.source)}</td>
                <td>{String(r.confidence)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {proposal.issues.length > 0 && (
        <>
          <h3 style={{ marginTop: 16 }}>
            <span className="badge b-peach">{proposal.issues.length}</span> açık konu
          </h3>
          <div className="preview-scroll">
            <table className="effects">
              <tbody>
                {proposal.issues.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <input type="checkbox" checked={issSel[i]} onChange={(e) => toggle(issSel, setIssSel, i, e.target.checked)} />
                    </td>
                    <td>
                      <span className={`badge ${r.priority === 'Critical' ? 'b-rose' : r.priority === 'Important' ? 'b-peach' : 'b-gray'}`}>{String(r.priority)}</span>
                    </td>
                    <td>{String(r.description)}</td>
                    <td className="muted">{String(r.recommendedAction)}</td>
                    <td className="muted">{String(r.source)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}

export function PasteDialog({ onRun, onClose }: { onRun: (text: string, label: string) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [label, setLabel] = useState('');
  return (
    <Modal
      wide
      icon="✉"
      title="Metinden gereksinim çıkar"
      sub="Müşteri e-postasını, toplantı notunu veya şartname bölümünü yapıştırın. Metin bir doküman kaydı olarak saklanır."
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>
            Vazgeç
          </button>
          <button
            className="btn primary"
            disabled={!text.trim()}
            onClick={() => {
              onClose();
              onRun(text, label);
            }}
          >
            ✦ Çıkar
          </button>
        </>
      }
    >
      <div className="form" style={{ marginBottom: 10 }}>
        <label className="wide">
          <span>Başlık (ör. "Müşteri e-postası 22.10.2026 – A. Yılmaz")</span>
          <input className="cell-input" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
      </div>
      <textarea className="big-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Metni buraya yapıştırın…" />
    </Modal>
  );
}
