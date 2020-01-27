import SchemaNode from "./schema-node";
import { Dictionary, JSONValue } from "./common";

export default interface Context {
    name?: string;
    value?: JSONValue;
    attributes: Dictionary<string>;
    schema: SchemaNode;
    root?: boolean;
    hasText?: boolean;
    firstItem?: boolean;
}
