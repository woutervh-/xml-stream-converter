import { Dictionary } from './common';

interface ObjectSchemaNode {
    type: 'object';
    properties: Dictionary<SchemaNode>;
    attributes?: Dictionary<string>;
}

interface ArraySchemaNode {
    type: 'array';
    attributes?: Dictionary<string>;
    items?: ArrayItemSchemaNode | ArrayItemSchemaNode[];
}

type ArrayItemSchemaNode = SchemaNode & { title?: string };

interface StringSchemaNode {
    type: 'string';
}

interface IntegerSchemaNode {
    type: 'integer';
}

interface NumberSchemaNode {
    type: 'number';
}

interface BooleanSchemaNode {
    type: 'boolean';
}

interface RefSchemaNode {
    $ref: string;
}

type SchemaNode = ObjectSchemaNode
    | StringSchemaNode
    | IntegerSchemaNode
    | NumberSchemaNode
    | BooleanSchemaNode
    | ArraySchemaNode
    | RefSchemaNode;

// interface SchemaNode {
//     title?: string;
//     attributes?: Dictionary<unknown>;
//     properties?: Dictionary<SchemaNode>;
//     type: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array';
//     '$ref'?: string;
//     items?: Array<SchemaNode>;
// }

// eslint-disable-next-line no-undef
export default SchemaNode;
