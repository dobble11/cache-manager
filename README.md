# cache-manager

实现统一的缓存使用管理与监控

## 可选方案

- [node-cache](https://github.com/node-cache/node-cache)：仅支持内存缓存，基本不维护
- [cache-manager](https://github.com/jaredwray/cacheable)：模块设计，支持扩展多种 store，nestjs 采用的底层库，维护活跃

## 技术方案

参考 cache-manager 实现，添加数据校验、Hook 等能力，且所有能力都是可选的

### 用法

```ts
import { createCache } from 'cache-manager';
import memoryStore from 'cache-manager/stores/memory';

// 内存缓存
const cache = createCache(memoryStore, {
  suffix: 'env',
  max: 100,
  ttl: 10,
});

import redisStore from 'cache-manager/stores/ioredis';
import Redis from 'ioredis';

const redisClient = new Redis({
  host: 'localhost',
  port: 6379,
});
// redis 缓存
const cache = createCache(redisStore, {
  client: redisClient,
});

await cache.set('foo', 'bar');
const value = await cache.get('foo');
// cache.get('foo', { parse: false }); // 不解析值
await cache.del('foo');
```

### Hook

发生缓存操作前都会触发对应 hook

```ts
const cache = createCache(store, {
  hooks: {
    // operation：get、set、del...
    // 其它为调用方法入参，value 为最终存储的值
    beforeOperation({ operation, key, value, rawValue, ttl }) {
      // 上报
    },
  },
});
```

### 事件

```ts
// json 解析错误
cache.on('error', (err: Error, context: { key: string; value: any; operation: string }) => {
  // 错误上报
});

// schema 校验错误
cache.on('error', (err: CacheSchemaValidatorError) => {
  // 错误上报
});

// 压缩事件
cache.on('compress', (context: { key: string; hasSzip: boolean; value: any }) => {
  // 压缩率上报
});

cache.off('error', callback);
```

### 内容压缩

```ts
import zlib from 'zlib';

function set(key: string, value: any, ttl?: number, { gzip = false }) {
  let str = JSON.stringify(value);
  if (gzip) {
    const buffer = zlib.gzipSync(str);
    const gzipStr = `_gzip_${buffer.toString('base64')}`;
    const hasSzip = false;

    if (str.length > gzipStr.length) {
      // 压缩后更小
      str = gzipStr;
      hasSzip = true;
    }
    // 触发压缩事件
    emitter.emit('compress', { key, hasSzip, value: str });
  }

  store.set(key, str, ttl);
}
```

### 限制

参考 json schema 规范定义存储结构规则

```ts
import { createCache } from 'cache-manager';

const cache = createCache(store, {
  schema: {
    foo: {
      type: 'string',
      maxTTL: 60,
    },
    // 模糊匹配
    'bar*': {
      type: 'object',
      // 可选，支持任意层级
      properties: {
        name: {
          type: 'string',
        },
      },
    },
    // 宽松匹配
    '*': {},
  },
});
```

- 模糊匹配会按匹配静态字符长度作为优先级，如 `bar*` 优先于 `ba*`
- type：object 传入 properties 定义，则会严格校验子属性
- 可以使用模糊匹配或 `*` 作为通配符兜底
- 校验为安全校验，不影响存储，只会触发事件

### Session 场景

session 场景下仅需要支持 set 方法的拦截与 schema 校验

#### 1. 创建 cache 实例

```ts
import { createSessionCache } from 'cache-manager';

const cache = createSessionCache({
  schema: {
    user: {
      type: 'object',
    },
    // ...其它属性
  },
  hooks: {
    beforeOperation(operation, ...args) {
      // 上报
    },
  },
  client: redisClient,
});
```

#### 2. 将 cache.client 传给 RedisStore

```ts
const session = require('express-session');
const RedisStore = require('connect-redis')(session);

const sessionHandler = session({
  // ...
  store: new RedisStore({
    client: cache.client,
    serializer: {
      // session 数据不序列化，下放到 cache 内部处理
      stringify: (obj) => {
        return obj;
      },
      parse: JSON.parse,
    },
  }),
  // ...
});
```

#### `createSessionCache` 部分实现

```ts
function createSessionCache(options) {
  const { schema, hooks, client } = options;
  const _set = client.set;

  client.set = function (args, cb) {
    if (Array.isArray(args)) {
      // schema 验证依赖对象 value
      vaildateCacheSilent(...args);

      try {
        // 由于 connect-redis 会处理将 set 值 JSON.stringify，所以需要将序列化下放到 redisCilent 内部
        args[1] = JSON.stringify(args[1]);
        hooks?.beforeOperation?.('set', ...args);
      } catch (error) {
        return cb(error);
      }
    }

    return _set.call(client, args, cb);
  };

  return {
    client,
    // ...
  };
}
```
