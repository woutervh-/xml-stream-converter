import { Dictionary } from "./common";

export default interface SchemaNode {
    title?: string;
    attributes?: Dictionary<unknown>;
    properties?: Dictionary<SchemaNode>;
    type: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array';
    '$ref'?: string;
    items?: Array<SchemaNode>;
}
