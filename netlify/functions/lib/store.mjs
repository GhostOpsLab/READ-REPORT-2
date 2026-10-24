// Small storage wrapper around Netlify Blobs.
// Production uses one global store. Staging and deploy previews use a store tied to that deploy,
// so test data never mixes with the live data.
// Tests set ARENA_MEMORY_STORE=1 to use an in-memory store.

export function env(name) {
  if (typeof Netlify !== "undefined" && Netlify.env) return Netlify.env.get(name);
  return process.env[name];
}

class MemoryStore {
  constructor() { this.m = new Map(); }
  async get(key) { return this.m.has(key) ? JSON.parse(this.m.get(key)) : null; }
  async setJSON(key, value) { this.m.set(key, JSON.stringify(value)); }
  async delete(key) { this.m.delete(key); }
  async list({ prefix = "" } = {}) {
    return { blobs: [...this.m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
  }
}

let cached = null;

export async function getArena() {
  if (cached) return cached;
  let store;
  if (process.env.ARENA_MEMORY_STORE === "1") {
    store = new MemoryStore();
  } else {
    const { getStore, getDeployStore } = await import("@netlify/blobs");
    const ctx = typeof Netlify !== "undefined" ? Netlify.context?.deploy?.context : undefined;
    store = ctx === "production"
      ? getStore({ name: "arena", consistency: "strong" })
      : getDeployStore("arena", { consistency: "strong" });
  }
  cached = {
    async getJSON(key) {
      return store.get(key, { type: "json", consistency: "strong" });
    },
    async putJSON(key, value) {
      await store.setJSON(key, value);
    },
    async del(key) {
      await store.delete(key);
    },
    async keys(prefix) {
      const res = await store.list({ prefix });
      return (res.blobs || []).map((b) => b.key);
    },
  };
  return cached;
}

// For tests only.
export function resetArenaForTests() { cached = null; }
