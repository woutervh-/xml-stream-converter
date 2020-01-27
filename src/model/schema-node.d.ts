import { Dictionary } from './common';

interface SchemaNode {
    title?: string;
    attributes?: Dictionary<unknown>;
    properties?: Dictionary<SchemaNode>;
    type: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array';
    '$ref'?: string;
    items?: Array<SchemaNode>;
}

// eslint-disable-next-line no-undef
export default SchemaNode;
