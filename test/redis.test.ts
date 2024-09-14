import { describe, test, vi, afterEach, expect, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { redisStore } from '../src/stores/ioredis.js';
import { createCache } from '../src/cache.js';

const redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

describe('redis store', () => {
  afterAll(() => {
    redisClient.disconnect();
  });

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
    await expect(cache.get('ab', { parse: false })).resolves.toEqual(
      JSON.stringify({ a: 1, c: 2 }),
    );

    await cache.set('ab', 11, 60, { NX: true });
    await expect(redisClient.get('ab_test')).resolves.toEqual(JSON.stringify({ a: 1, c: 2 }));
  });

  test('set beforeOperation hook', async () => {
    const beforeOperation = vi.fn();
    const cache = createCache(redisStore, {
      client: redisClient,
      hooks: {
        beforeOperation,
      },
    });
    const value = { a: 1, c: 2 };

    await cache.set('ab', value, 60);
    expect(beforeOperation).toHaveBeenCalledWith({
      key: 'ab',
      operation: 'set',
      rawValue: value,
      ttl: 60,
      value: JSON.stringify(value),
    });
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
        'benx*': {
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

  test('set with gzip', async () => {
    const cache = createCache(redisStore, {
      client: redisClient,
    });
    const fn = vi.fn();

    cache.on('compress', fn);

    const str = 'aaaaaaaabbbbbbbbbcccccccddddddddsssssssssssssssssssssssssssssss';
    await cache.set('gzipbar', str, 60, {
      gzip: true,
    });

    await expect(redisClient.get('gzipbar')).resolves.toMatch(/^_gzip_/);
    await expect(cache.get('gzipbar')).resolves.toEqual(str);
    expect(fn).toHaveBeenCalledWith({
      key: 'gzipbar',
      value: '_gzip_H4sIAAAAAAAAE1NKhIIkGEiGgBQoKMYPlAB70jLNQQAAAA==',
      hasGzip: true,
    });
  });

  test('set NX flag', async () => {
    const cache = createCache(redisStore, {
      client: redisClient,
    });

    await cache.set('nxbar', '1', 60, { NX: true });
    await cache.set('nxbar', '2', 60, { NX: true });
    await expect(cache.get('nxbar')).resolves.toEqual('1');
  });
});
