// Microsoft Graph istemcisi: kullanıcının kendi hesabıyla (delegated) giriş, token önbelleği işletim
// sisteminin şifreli deposunda. Gerekli izinler: Tasks.ReadWrite, User.ReadBasic.All.
import { PublicClientApplication, type AccountInfo, type ICachePlugin } from '@azure/msal-node';
import { safeStorage, shell } from 'electron';
import fs from 'node:fs/promises';
import { GraphError, type GraphLike } from '../shared/planner';

export const SCOPES = ['Tasks.ReadWrite', 'User.ReadBasic.All'];
const BASE = 'https://graph.microsoft.com/v1.0';

const page = (title: string, msg: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:Segoe UI,sans-serif;padding:40px"><h2>${title}</h2><p>${msg}</p></body>`;

function cachePlugin(file: string): ICachePlugin {
  return {
    async beforeCacheAccess(ctx) {
      try {
        const buf = await fs.readFile(file);
        ctx.tokenCache.deserialize(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8'));
      } catch {
        /* önbellek yok */
      }
    },
    async afterCacheAccess(ctx) {
      if (!ctx.cacheHasChanged) return;
      const s = ctx.tokenCache.serialize();
      await fs.writeFile(file, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s) : Buffer.from(s, 'utf8'));
    },
  };
}

export class Graph implements GraphLike {
  private pca: PublicClientApplication;
  private key: string;

  constructor(private cfg: { clientId: string; tenantId: string }, cacheFile: string) {
    this.key = `${cfg.clientId}|${cfg.tenantId}`;
    this.pca = new PublicClientApplication({
      auth: { clientId: cfg.clientId, authority: `https://login.microsoftonline.com/${cfg.tenantId || 'organizations'}` },
      cache: { cachePlugin: cachePlugin(cacheFile) },
    });
  }

  sameAs(cfg: { clientId: string; tenantId: string }) {
    return this.key === `${cfg.clientId}|${cfg.tenantId}`;
  }

  async account(): Promise<AccountInfo | null> {
    const all = await this.pca.getTokenCache().getAllAccounts();
    return all[0] ?? null;
  }

  async signIn(): Promise<AccountInfo> {
    const r = await this.pca.acquireTokenInteractive({
      scopes: SCOPES,
      openBrowser: async (url) => {
        await shell.openExternal(url);
      },
      successTemplate: page('Giriş tamamlandı', 'Bu pencereyi kapatıp Gereksinim Takip uygulamasına dönebilirsiniz.'),
      errorTemplate: page('Giriş başarısız', 'Uygulamaya dönüp tekrar deneyin.'),
    });
    if (!r?.account) throw new Error('Microsoft girişi tamamlanmadı.');
    return r.account;
  }

  async signOut() {
    const cache = this.pca.getTokenCache();
    for (const a of await cache.getAllAccounts()) await cache.removeAccount(a);
  }

  private async token(): Promise<string> {
    const account = await this.account();
    if (!account) throw new Error('Microsoft hesabıyla giriş yapılmamış. Planner sekmesinden "Giriş yap" ile bağlanın.');
    try {
      return (await this.pca.acquireTokenSilent({ account, scopes: SCOPES })).accessToken;
    } catch {
      const r = await this.pca.acquireTokenInteractive({ scopes: SCOPES, openBrowser: async (url) => void (await shell.openExternal(url)) });
      return r.accessToken;
    }
  }

  private async req<T>(method: string, path: string, body?: unknown, etag?: string, attempt = 0): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${await this.token()}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (etag) headers['If-Match'] = etag;
    if (method === 'PATCH') headers.Prefer = 'return=representation';
    const res = await fetch(path.startsWith('http') ? path : BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if ((res.status === 429 || res.status === 503) && attempt < 4) {
      const wait = Number(res.headers.get('Retry-After') ?? 2 ** attempt) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      return this.req(method, path, body, etag, attempt + 1);
    }
    if (res.status === 204) return null as T;
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const msg = json?.error?.message ?? res.statusText;
      if (res.status === 403) throw new GraphError(403, `Yetki yok (${msg}). Plana üye olduğunuzu ve uygulama izinlerinin verildiğini kontrol edin.`);
      if (res.status === 412) throw new GraphError(412, 'Görev bu sırada Planner\'da değiştirilmiş; tekrar deneyin.');
      throw new GraphError(res.status, `${res.status} ${msg}`);
    }
    return json as T;
  }

  get<T>(path: string) {
    return this.req<T>('GET', path);
  }
  post<T>(path: string, body: unknown) {
    return this.req<T>('POST', path, body);
  }
  patch<T>(path: string, body: unknown, etag?: string) {
    return this.req<T | null>('PATCH', path, body, etag);
  }
  async list<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = path;
    while (next) {
      const r: { value: T[]; '@odata.nextLink'?: string } = await this.get(next);
      out.push(...r.value);
      next = r['@odata.nextLink'];
    }
    return out;
  }
}
