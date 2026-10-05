import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Storage abstraction: save/read/delete/exists against a server-controlled key. Keys are never derived
 * from user input (see document.service.js, which builds them from tenantId/invoiceId/documentId only),
 * but this adapter also independently refuses to resolve outside its own root as defence in depth.
 *
 * Only a LOCAL filesystem adapter exists today. A future cloud adapter (S3, etc.) would implement the
 * same four methods and be swapped in at the composition root (container.js) — no caller changes.
 */
export class LocalStorageAdapter {
  constructor({ rootDir }) {
    this.rootDir = path.resolve(rootDir);
  }

  #resolve(key) {
    const segments = String(key).replace(/\\/g, '/').split('/').filter((s) => s && s !== '.' && s !== '..');
    const full = path.resolve(this.rootDir, ...segments);
    if (full !== this.rootDir && !full.startsWith(this.rootDir + path.sep)) {
      throw new Error('Refusing to resolve a storage key outside the document storage root');
    }
    return full;
  }

  /** Atomic write (write-to-temp then rename) so a reader never observes a partially-written file. */
  async save(key, buffer) {
    const full = this.#resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.tmp-${crypto.randomBytes(8).toString('hex')}`;
    await fs.writeFile(tmp, buffer);
    await fs.rename(tmp, full);
    return { size: buffer.length };
  }

  async read(key) { return fs.readFile(this.#resolve(key)); }

  async delete(key) {
    try { await fs.unlink(this.#resolve(key)); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }

  async exists(key) {
    try { await fs.access(this.#resolve(key)); return true; } catch { return false; }
  }
}

/** Default root: DOCUMENT_STORAGE_PATH if set, else <cwd>/storage/documents (gitignored; never statically served). */
export function createStorageService(env) {
  const rootDir = env.DOCUMENT_STORAGE_PATH || path.join(process.cwd(), 'storage', 'documents');
  return new LocalStorageAdapter({ rootDir });
}
