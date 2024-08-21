import { isBoolean, isNumber, isObject, isString, orderBy, partition, trim } from 'lodash';

type CacheSchemaKeyType = string | RegExp;

export type CacheSchemaNode = {
  type?: 'number' | 'string' | 'boolean';
  maxTTL?: number;
};

export type CacheSchemaObject = {
  type?: 'object';
  maxTTL?: number;
  properties?: Record<string, CacheSchemaNode | CacheSchemaObject | CacheSchemaArray>;
};

export type CacheSchemaArray = {
  type?: 'array';
  maxTTL?: number;
};

export type CacheSchema = Record<string, CacheSchemaNode | CacheSchemaObject | CacheSchemaArray>;

type CacheSchemaMap = Map<
  CacheSchemaKeyType,
  | CacheSchemaNode
  | (Omit<CacheSchemaObject, 'properties'> & { properties?: CacheSchemaMap })
  | CacheSchemaArray
>;

const typeCheckerMap: Record<string, Function> = {
  string: isString,
  number: isNumber,
  boolean: isBoolean,
  object: isObject,
  array: Array.isArray,
};

export function transformSchema(node: any) {
  if (node !== null && typeof node === 'object') {
    if (node.type === 'object' && node.properties) {
      const keys = Object.keys(node.properties);
      const [wildcardKeys, normalKeys] = partition(keys, (key) => key.includes('*'));
      const orderedKeys = [
        ...normalKeys,
        ...orderBy(wildcardKeys, (key) => trim(key, '*').length, ['desc']),
      ];

      node.properties = orderedKeys.reduce((acc, key) => {
        const value = node.properties[key];

        acc.set(
          key.includes('*') ? new RegExp(key.replace(/\*/g, '.*')) : key,
          transformSchema(value),
        );
        return acc;
      }, new Map());
    }

    return node;
  }

  return node;
}

export const vaildateCache = (
  ruleMap: CacheSchemaMap,
  key: string,
  value: any,
  path?: string,
  ttl?: number,
) => {
  const currentPath = path ? `${path}.${key}` : key;
  let rule = ruleMap.get(key);

  for (const [key, value] of ruleMap) {
    if (key instanceof RegExp && key.test(currentPath)) {
      rule = value;
      break;
    }
  }

  if (!rule) {
    throw new Error(`No match schema for key ${currentPath}`);
  }
  if (ttl && rule.maxTTL && ttl > rule.maxTTL) {
    throw new Error(`ttl for key ${currentPath} is greater than max ttl`);
  }
  const checker = typeCheckerMap[rule.type || ''];

  if (!checker) {
    return;
  }
  if (!checker(value)) {
    throw new Error(`value for key ${currentPath} is not ${rule.type}`);
  }
  if (rule.type === 'object' && rule.properties) {
    Object.keys(value).forEach((key) => {
      vaildateCache(rule.properties!, key, value[key], currentPath, ttl);
    });
  }
};
