import { LRUCache } from 'lru-cache';
import { type Options, type Cache, type Store } from '../cache.js';

type LRU = LRUCache<string, any>;

type Pre = LRUCache.OptionsTTLLimit<string, any, unknown>;
type LRUOptions = Omit<Pre, 'ttlAutopurge'> & Partial<Pick<Pre, 'ttlAutopurge'>>;
export type MemoryOptions = {
  max?: number;
} & LRUOptions &
  Options;

export type MemoryStore = Store & {
  dump: LRU['dump'];
  load: LRU['load'];
  calculatedSize: LRU['calculatedSize'];
  get size(): number;
};
export type MemoryCache = Cache<MemoryStore>;

/**
 * Wrapper for lru-cache.
 */
export function memoryStore(options?: MemoryOptions): MemoryStore {
  const lruOptions = {
    ttlAutopurge: true,
    ...options,
    max: options?.max ?? 500,
    ttl: options?.ttl ?? 0,
  };

  const lruCache = new LRUCache(lruOptions);

  return {
    async del(key) {
      lruCache.delete(key);
    },
    get: async <T>(key: string) => lruCache.get(key) as T,
    keys: async () => [...lruCache.keys()],
    mget: async (...arguments_) => arguments_.map((x) => lruCache.get(x)),
    async mset(arguments_, ttl?) {
      const opt = { ttl: (ttl ?? lruOptions.ttl) * 1000 } as const;
      for (const [key, value] of arguments_) {
        lruCache.set(key, value, opt);
      }
    },
    async mdel(...arguments_) {
      for (const key of arguments_) {
        lruCache.delete(key);
      }
    },
    async reset() {
      lruCache.clear();
    },
    ttl: async (key) => lruCache.getRemainingTTL(key) / 1000,
    async exists(key) {
      return lruCache.has(key) ? 1 : 0;
    },
    async set(key, value, opt) {
      const ttl = opt ?? lruOptions.ttl;

      lruCache.set(key, value, { ttl: ttl * 1000 });
    },
    get calculatedSize() {
      return lruCache.calculatedSize;
    },
    /**
     * This method is not available in the caching modules.
     */
    get size() {
      return lruCache.size;
    },
    /**
     * This method is not available in the caching modules.
     */
    dump: () => lruCache.dump(),
    /**
     * This method is not available in the caching modules.
     */
    load(...arguments_: Parameters<LRU['load']>) {
      lruCache.load(...arguments_);
    },
  };
}
