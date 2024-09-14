export const parse = (value: string): [Error | undefined, unknown] => {
  try {
    const result = JSON.parse(value);

    return [undefined, result];
  } catch (error) {
    return [error as Error, undefined];
  }
};

export const stringify = (value: unknown) => JSON.stringify(value);
