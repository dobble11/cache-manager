import type { Cluster, Redis } from 'ioredis';
import type { Store, Options } from '../cache.js';

export interface RedisStore extends Store {
  on: RedisClient['on'];
  off: RedisClient['off'];
}

type RedisClient = Redis | Cluster;

interface RedisStoreOptions extends Omit<Options, 'schema' | 'hooks' | 'suffix'> {
  client: RedisClient;
}

export function redisStore(options: RedisStoreOptions) {
  const { client } = options;
  const reset = async () => {
    await client.flushdb();
  };

  return {
    get(key: string) {
      return client.get(key);
    },
    async set(key, value: string, ttl) {
      const t = ttl === undefined ? options?.ttl : ttl;

      if (ttl !== undefined && t !== 0) {
        await client.set(key, value, 'EX', t);
      } else {
        await client.set(key, value);
      }
    },
    async mset(args, ttl) {
      const t = ttl === undefined ? options?.ttl : ttl;
      if (t !== undefined && t !== 0) {
        const multi = client.multi();
        for (const [key, value] of args) {
          multi.set(key, value as string, 'EX', t);
        }
        await multi.exec();
      } else
        await client.mset(
          args.flatMap(([key, value]) => {
            return [key, value] as [string, string];
          }),
        );
    },
    mget: (...args) => client.mget(args),
    async mdel(...args) {
      await client.del(args);
    },
    async del(key) {
      await client.del(key);
    },
    ttl: (key) => client.ttl(key),
    keys: (pattern = '*') => client.keys(pattern),
    exists: (key: string) => client.exists(key),
    reset,
    on: client.on.bind(client),
    off: client.off.bind(client),
  } as RedisStore;
}
