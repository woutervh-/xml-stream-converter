import SchemaNode from './schema-node';
import { Dictionary, JSONValue } from './common';

interface Context {
    name?: string;
    value?: JSONValue;
    attributes: Dictionary<string>;
    schema: SchemaNode;
    root?: boolean;
    hasText?: boolean;
    firstItem?: boolean;
}

// eslint-disable-next-line no-undef
export default Context;
