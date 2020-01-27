
export interface Dictionary<T> { [key: string]: T }
export type JSONValue = string | number | boolean | JSONValue[] | { [key: string]: JSONValue } | null;
