import EventEmitter from 'node:events';
import {
  type CacheSchema,
  CacheSchemaValidatorError,
  transformSchema,
  vaildateCache,
} from './schema.js';
import { parse, stringify } from './utils.js';
import { isString, trimStart } from 'lodash';
import zlib from 'node:zlib';

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
  get<T = unknown>(key: string, options?: { parse?: boolean }): Promise<T | string | null>;
  set<T = unknown>(
    key: string,
    data: T,
    ttl?: Seconds,
    options?: { gzip?: boolean; NX?: boolean },
  ): Promise<void>;
  del(key: string): Promise<void>;
  reset(): Promise<void>;
  mset(args: Array<[string, unknown]>, ttl?: Seconds): Promise<void>;
  mget(...args: string[]): Promise<unknown[]>;
  mdel(...args: string[]): Promise<void>;
  keys(pattern?: string): Promise<string[]>;
  ttl(key: string): Promise<number>;
  exists(key: string): Promise<number>;
};

interface EventMap {
  compress: [context: { key: string; hasSzip: boolean; value: string }];
  error:
    | [err: Error, context: { key: string; value: unknown; operation: string }]
    | [err: CacheSchemaValidatorError];
}

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
  exists: Store['exists'];
  on: EventEmitter<EventMap>['on'];
  off: EventEmitter<EventMap>['off'];
};

const GZIP_FLAG = '_gzip_';

export function createCache<S extends Store, O extends Options>(
  factory: (options: O) => S,
  options?: O & Options,
): Cache<S> {
  const { schema, suffix = '', hooks, ttl = 60, ...otherOptions } = options || {};
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
  const beforeOperation = hooks?.beforeOperation;
  const emitter = new EventEmitter<EventMap>();
  const vaildateCacheSilent = (key: string, value: any, path?: string, ttl?: number) => {
    if (ruleMap) {
      try {
        vaildateCache(ruleMap, key, value, path, ttl);
      } catch (error) {
        emitter.emit('error', error as CacheSchemaValidatorError);
      }
    }
  };

  return {
    store,
    del: async (key: string) => {
      beforeOperation?.('del', key);
      return store.del(`${key}${suffix}`);
    },
    get: async <T>(key: string, options: Parameters<Store['get']>['1']) => {
      beforeOperation?.('get', key);
      let val = await store.get<string>(`${key}${suffix}`);
      const { parse: enableParse = true } = options || {};

      if (!enableParse) {
        return val;
      }
      if (isString(val) && val.startsWith(GZIP_FLAG)) {
        const buffer = Buffer.from(trimStart(val, GZIP_FLAG), 'base64');
        val = zlib.gunzipSync(buffer).toString();
      }
      const [err, value] = parse(val!);

      if (err) {
        emitter.emit('error', err, {
          key: `${key}${suffix}`,
          value,
          operation: 'get',
        });
      }

      return value as T;
    },
    set: async (key: string, value: unknown, ttl?: Seconds, options?) => {
      vaildateCacheSilent(key, value, '', ttl);

      const { gzip } = options || {};
      let str = stringify(value);

      if (gzip) {
        const buffer = zlib.gzipSync(str);
        const gzipStr = `${GZIP_FLAG}${buffer.toString('base64')}`;
        let hasSzip = false;

        if (str.length > gzipStr.length) {
          // 压缩后更小
          str = gzipStr;
          hasSzip = true;
        }
        // 触发压缩事件
        emitter.emit('compress', { key, hasSzip, value: str });
      }

      beforeOperation?.('set', key, str, ttl);
      return store.set(`${key}${suffix}`, str, ttl, options);
    },
    ttl: (key: string) => {
      beforeOperation?.('ttl', key);
      return store.ttl(`${key}${suffix}`);
    },
    mset: (args: [string, unknown][], ttl?: Seconds) => {
      for (const [key, value] of args) {
        vaildateCacheSilent(key, value, '', ttl);
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
    mget: async (...args: string[]) => {
      beforeOperation?.('mget', ...args);
      const newArgs = args.map((key) => `${key}${suffix}`);
      const list = await store.mget(...newArgs);

      return list.map((val, index) => {
        const [err, value] = parse(val as string);

        if (err) {
          emitter.emit('error', err, {
            key: newArgs[index],
            value,
            operation: 'mget',
          });
        }

        return value;
      });
    },
    mdel: (...args: string[]) => {
      beforeOperation?.('mdel', ...args);
      return store.mdel(...args.map((key) => `${key}${suffix}`));
    },
    exists: (key) => {
      beforeOperation?.('exists', key);
      return store.exists(`${key}${suffix}`);
    },
    reset: () => store.reset(),
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
  };
}
