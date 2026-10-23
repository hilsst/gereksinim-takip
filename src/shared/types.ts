// Gereksinim takip veri modeli. Tüm tablolar sabit ID'li satırlardan oluşur (DOC-001, REQ-001, ISS-001, P-001).
// Gereksinim ve açık konu alanları FMEA Studio V4.6 ile aynı tutulur; ileride iki uygulama bu ID'ler üzerinden bağlanır.

export type Approval = 'AI Proposed' | 'Engineer Reviewed' | 'Approved' | 'Rejected' | '';
export type Confidence = 'High' | 'Medium' | 'Low' | '';
export type DataStatus =
  | 'Dokümandan (kaynaklı)'
  | 'VERİ YOK – doğrulanmalı'
  | 'AI VARSAYIMI – mühendislik doğrulaması gerekli'
  | 'AI RECOMMENDATION'
  | '';
export type IssueStatus = 'Open' | 'Under Review' | 'Waiting Customer' | 'Resolved' | 'Closed' | '';
export type Discipline = 'Tasarım' | 'Konfigürasyon' | 'İmalat' | '';
/** Atama durumu. "Kapandı" yalnızca Planner'da görev tamamlanınca veya elle kapatılınca olur. */
export type WorkStatus = 'Atanmadı' | 'Atandı' | 'Devam ediyor' | 'Kapandı' | 'İptal' | '';

export interface BaseRow {
  id: string;
}

/** Gereksinim ve açık konuların ortak atama ve Planner alanları. */
export interface Assignable {
  discipline: Discipline;
  /** Ekip tablosundaki kişi ID'si (P-001). */
  assignee: string;
  dueDate: string;
  workStatus: WorkStatus;
  plannerTaskId: string;
  plannerSyncedAt: string;
  /** Planner'da yapılan son değişiklik kontrolü için (görev etag'i). */
  plannerEtag: string;
  closedAt: string;
  closedBy: string;
  /** Planner görevinin kapanıştaki açıklaması. */
  closureNote: string;
}

export interface ProjectMeta {
  name: string;
  partNumber: string;
  partName: string;
  customer: string;
  program: string;
  drawingRevision: string;
  owner: string;
  startDate: string;
  scope: string;
  confidentiality: string;
}

export interface PlannerSettings {
  /** flow: Power Automate + OneDrive/SharePoint klasörü (Azure kaydı gerekmez); graph: doğrudan Microsoft Graph. */
  mode: 'flow' | 'graph';
  /** Power Automate modunda OneDrive/SharePoint ile senkron yerel klasör. */
  flowFolder: string;
  /** Azure AD (Entra ID) uygulama kaydı – "Mobile and desktop", yönlendirme http://localhost */
  clientId: string;
  tenantId: string;
  planId: string;
  planTitle: string;
  /** Disiplin → kova (bucket) ID'si. Boşsa ilk gönderimde kova oluşturulur. */
  buckets: Record<string, string>;
  /** Uygulama açıkken otomatik kontrol aralığı (dakika). 0 = kapalı. */
  pollMinutes: number;
  lastSync: string;
}

export interface DocumentRow extends BaseRow {
  name: string;
  docType: string;
  docNumber: string;
  revision: string;
  date: string;
  source: string;
  notes: string;
  filePath: string;
  extractedAt: string;
}

export interface RequirementRow extends BaseRow, Assignable {
  text: string;
  reqType: string;
  acceptance: string;
  /** Kanıt türü: ölçüm, test, analiz, muayene … */
  evidenceType: string;
  /** Kanıtın nasıl sunulacağı: beklenen doküman, kayıt, rapor. */
  evidence: string;
  source: string;
  confidence: Confidence;
  dataStatus: DataStatus;
  approval: Approval;
  notes: string;
}

export interface IssueRow extends BaseRow, Assignable {
  description: string;
  priority: 'Critical' | 'Important' | 'Optional' | '';
  source: string;
  risk: string;
  relatedReq: string;
  recommendedAction: string;
  status: IssueStatus;
  answer: string;
}

export interface PersonRow extends BaseRow {
  name: string;
  discipline: Discipline;
  /** Microsoft 365 oturum adı / e-posta (Planner ataması bununla yapılır). */
  email: string;
  /** Graph kullanıcı ID'si, ilk Planner gönderiminde doldurulur. */
  aadId: string;
  active: boolean;
}

export interface SyncLogEntry {
  at: string;
  text: string;
  kind: 'ok' | 'warn' | 'err';
}

export interface Project {
  schema: 'gereksinim-takip/1';
  meta: ProjectMeta;
  planner: PlannerSettings;
  documents: DocumentRow[];
  requirements: RequirementRow[];
  issues: IssueRow[];
  people: PersonRow[];
  syncLog: SyncLogEntry[];
}

export type TableKey = 'documents' | 'requirements' | 'issues' | 'people';
export type AnyRow = DocumentRow | RequirementRow | IssueRow | PersonRow;
export type AssignableTable = 'requirements' | 'issues';
