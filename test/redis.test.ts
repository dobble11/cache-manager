import { describe, test, vi, afterEach, expect } from 'vitest';
import { createCache } from '../src/cache.js';
import { redisStore } from '../src/stores/ioredis.js';
import Redis from 'ioredis';

const redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

describe('redis store', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('basic usage', async () => {
    const cache = createCache(redisStore, {
      client: redisClient,
      suffix: '_test',
    });
    await cache.set('ab', { a: 1, c: 2 }, 60);

    await expect(cache.get('ab')).resolves.toEqual({ a: 1, c: 2 });
    await expect(redisClient.get('ab_test')).resolves.toEqual('{"a":1,"c":2}');
  });

  test('set beforeOperation hook', async () => {
    const beforeOperation = vi.fn();
    const cache = createCache(redisStore, {
      client: redisClient,
      hooks: {
        beforeOperation,
      },
    });

    await cache.set('ab', { a: 1, c: 2 }, 60);
    expect(beforeOperation).toHaveBeenCalledWith('set', 'ab', JSON.stringify({ a: 1, c: 2 }), 60);
  });

  test('schema validation', async () => {
    const cache = createCache(redisStore, {
      client: redisClient,
      schema: {
        foo: {
          type: 'string',
          maxTTL: 60,
        },
        // 模糊匹配
        'bar*': {
          type: 'object',
          // 可选，传入则校验子属性
          properties: {
            name: {
              type: 'string',
            },
          },
        },
        'ben*': {
          type: 'object',
        },
      },
    });

    await expect(cache.set('foo', 1)).rejects.toThrowError();
    await expect(cache.set('foo', '1', 70)).rejects.toThrowError();
    await expect(cache.set('foo', '1', 60)).resolves.toBeUndefined();

    await expect(cache.set('barxxx', 1)).rejects.toThrowError();
    await expect(cache.set('barxxx', { name: 1 })).rejects.toThrowError();
    await expect(cache.set('barxxx', { age: 1 })).rejects.toThrowError();
    await expect(cache.set('barxxx', { name: '1' })).resolves.toBeUndefined();

    await expect(cache.set('benxxx', { x: 1, y: 2 })).resolves.toBeUndefined();

    await expect(cache.set('ban', 1)).rejects.toThrowError();
  });

  test('schema any type validation', async () => {
    const cache = createCache(redisStore, {
      client: redisClient,
      schema: {
        foo: {
          type: 'string',
        },
        // 宽松匹配，type 不传等于 any 类型
        '*': {},
      },
    });

    await expect(cache.set('anytype', 1)).resolves.toBeUndefined();
    await expect(cache.set('anytype', { x: 1 })).resolves.toBeUndefined();
  });
});
