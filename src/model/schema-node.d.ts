import { Dictionary } from './common';

interface SchemaNode {
    title?: string;
    attributes?: Dictionary<string>;
    properties?: Dictionary<SchemaNode>;
    definitions?: Dictionary<SchemaNode>;
    type?: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array';
    '$ref'?: string;
    items?: Array<SchemaNode> | SchemaNode;
    format?: string;
}

// eslint-disable-next-line no-undef
export default SchemaNode;
