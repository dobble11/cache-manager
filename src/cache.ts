import { type CacheSchema, transformSchema, vaildateCache } from './schema.js';
import { isString, parse, stringify } from './utils.js';

export type Options = {
  ttl?: Seconds;
  gzip?: boolean;
  suffix?: string;
  schema?: CacheSchema;
  hooks?: {
    beforeOperation?: (operation: string, ...args: any[]) => void;
  };
};

export type Seconds = number;

export type Store = {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, data: T, ttl?: Seconds): Promise<void>;
  del(key: string): Promise<void>;
  reset(): Promise<void>;
  mset(args: Array<[string, unknown]>, ttl?: Seconds): Promise<void>;
  mget(...args: string[]): Promise<unknown[]>;
  mdel(...args: string[]): Promise<void>;
  keys(pattern?: string): Promise<string[]>;
  ttl(key: string): Promise<number>;
};

export type Cache<S extends Store = Store> = {
  store: S;
  set: Store['set'];
  get: Store['get'];
  del: Store['del'];
  reset: Store['reset'];
  ttl: Store['ttl'];
  mset: Store['mset'];
  mget: Store['mget'];
  mdel: Store['mdel'];
};

export function createCache<S extends Store, O extends Options>(
  factory: (options: O) => S,
  options?: O & Options,
): Cache<S> {
  const { schema, suffix = '', hooks, ttl = 60, ...otherOptions } = options || {};
  const beforeOperation = hooks?.beforeOperation;
  const ruleMap = schema
    ? transformSchema({
        type: 'object',
        properties: schema,
      }).properties
    : undefined;
  const store = factory({
    ...otherOptions,
    ttl,
  } as O);

  return {
    store,
    del: async (key: string) => {
      beforeOperation?.('del', key);
      return store.del(`${key}${suffix}`);
    },
    get: async <T>(key: string) => {
      beforeOperation?.('get', key);
      const val = await store.get(`${key}${suffix}`);

      if (val && isString(val)) {
        try {
          return parse(val) as T;
        } catch (error) {
          return null;
        }
      }

      return val as T;
    },
    set: async (key: string, value: unknown, ttl?: Seconds) => {
      if (ruleMap) {
        vaildateCache(ruleMap, key, value, '', ttl);
      }
      const jsonStr = stringify(value);

      beforeOperation?.('set', key, jsonStr, ttl);
      return store.set(`${key}${suffix}`, jsonStr, ttl);
    },
    ttl: (key: string) => {
      beforeOperation?.('ttl', key);
      return store.ttl(`${key}${suffix}`);
    },
    mset: (args: [string, unknown][], ttl?: Seconds) => {
      if (ruleMap) {
        for (const [key, value] of args) {
          vaildateCache(ruleMap, key, value, '', ttl);
        }
      }
      const newArgs = args.map(
        ([key, value]) => [`${key}${suffix}`, stringify(value)] as [string, unknown],
      );
      beforeOperation?.(
        'mset',
        args.map((m, index) => [m[0], newArgs[index][1]]),
        ttl,
      );
      return store.mset(newArgs, ttl);
    },
    mget: (...args: string[]) => {
      beforeOperation?.('mget', ...args);
      return store.mget(...args.map((key) => `${key}${suffix}`));
    },
    mdel: (...args: string[]) => {
      beforeOperation?.('mdel', ...args);
      return store.mdel(...args.map((key) => `${key}${suffix}`));
    },
    reset: () => store.reset(),
  };
}
