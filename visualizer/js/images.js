'use strict';

/**
 * Background / logo images live in IndexedDB (settings only keep the id),
 * so they survive reloads and work offline. If IndexedDB is unavailable the
 * images still work for the current session.
 */
const ImageStore = {
  db: null,
  urls: new Map(),

  async init() {
    try {
      this.db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('sound-visualizer', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('images', { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        setTimeout(() => reject(new Error('timeout')), 4000);
      });
      const all = await this._req(this._store('readonly').getAll());
      for (const rec of all) this.urls.set(rec.id, URL.createObjectURL(rec.blob));
    } catch (e) {
      console.warn('画像の保存領域を開けませんでした。画像はこのセッション中のみ有効です。', e);
      this.db = null;
    }
  },

  _store(mode) {
    return this.db.transaction('images', mode).objectStore('images');
  },

  _req(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  url(id) {
    return id ? this.urls.get(id) || '' : '';
  },

  async put(id, blob) {
    const old = this.urls.get(id);
    if (old) URL.revokeObjectURL(old);
    this.urls.set(id, URL.createObjectURL(blob));
    if (this.db) await this._req(this._store('readwrite').put({ id, blob }));
  },

  async add(file) {
    const id = 'img-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    await this.put(id, file);
    return id;
  },

  async getBlob(id) {
    if (this.db) {
      const rec = await this._req(this._store('readonly').get(id));
      if (rec) return rec.blob;
    }
    const url = this.urls.get(id);
    return url ? (await fetch(url)).blob() : null;
  },

  /** Delete images no longer referenced by the settings. */
  async gc(usedIds) {
    for (const id of [...this.urls.keys()]) {
      if (usedIds.has(id)) continue;
      URL.revokeObjectURL(this.urls.get(id));
      this.urls.delete(id);
      if (this.db) await this._req(this._store('readwrite').delete(id));
    }
  },
};

function usedImageIds(settings) {
  const ids = new Set(settings.visuals.map(v => v.image).filter(Boolean));
  if (settings.logo.image) ids.add(settings.logo.image);
  return ids;
}

/** Images referenced by the current settings or by any saved preset. */
function allUsedImageIds(settings) {
  const ids = usedImageIds(settings);
  for (const p of PresetStore.list()) {
    for (const v of p.data.visuals || []) if (v && v.image) ids.add(v.image);
    if (p.data.logo && p.data.logo.image) ids.add(p.data.logo.image);
  }
  return ids;
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
