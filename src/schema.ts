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

export class CacheSchemaValidatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CacheSchemaValidatorError';
  }
}

export const vaildateCache = (
  ruleMap: CacheSchemaMap,
  key: string,
  value: any,
  path?: string,
  ttl?: number,
) => {
  let rule = ruleMap.get(key);
  if (!rule) {
    for (const [matchKey, value] of ruleMap) {
      if (matchKey instanceof RegExp && matchKey.test(key)) {
        rule = value;
        break;
      }
    }
  }

  const currentPath = path ? `${path}.${key}` : key;
  if (!rule) {
    throw new CacheSchemaValidatorError(`No match schema for key ${currentPath}`);
  }
  if (ttl && rule.maxTTL && ttl > rule.maxTTL) {
    throw new CacheSchemaValidatorError(`ttl for key ${currentPath} is greater than max ttl`);
  }
  const checker = typeCheckerMap[rule.type || ''];

  if (!checker) {
    return;
  }
  if (!checker(value)) {
    throw new CacheSchemaValidatorError(`value for key ${currentPath} is not ${rule.type}`);
  }
  if (rule.type === 'object' && rule.properties) {
    Object.keys(value).forEach((key) => {
      vaildateCache(rule.properties!, key, value[key], currentPath, ttl);
    });
  }
};
