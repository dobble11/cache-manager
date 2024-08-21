import { isBoolean, isNumber, isObject, isString } from './utils.js';

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

function match(keyMatch: CacheSchemaKeyType, key: string): boolean {
  if (keyMatch instanceof RegExp) {
    return keyMatch.test(key);
  }
  return keyMatch === key;
}

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
      Object.keys(node.properties).forEach((key) => {
        const value = node.properties[key];
        value.keyMatch = key.includes('*') ? new RegExp(key.replace(/\*/g, '.*')) : key;
        transformSchema(value);
      });
    }

    return node;
  }

  return node;
}

export const vaildateCache = (
  ruleMap: any,
  key: string,
  value: any,
  path?: string,
  ttl?: number,
) => {
  const currentPath = path ? `${path}.${key}` : key;
  const rule: any = Object.values(ruleMap).find((rule: any) => {
    return match(rule.keyMatch, key);
  });

  if (!rule) {
    throw new Error(`No match schema for key ${currentPath}`);
  }
  if (ttl && rule.maxTTL && ttl > rule.maxTTL) {
    throw new Error(`ttl for key ${currentPath} is greater than max ttl`);
  }
  const checker = typeCheckerMap[rule.type];

  if (!checker) {
    return;
  }
  if (!checker(value)) {
    throw new Error(`value for key ${currentPath} is not ${rule.type}`);
  }
  if (rule.type === 'object' && rule.properties) {
    Object.keys(value as Record<string, any>).forEach((key) => {
      vaildateCache(rule.properties, key, value[key], currentPath, ttl);
    });
  }
};
