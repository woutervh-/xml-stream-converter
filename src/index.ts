import * as sax from 'sax';
import * as stream from 'stream';
import * as jsonpointer from 'jsonpointer';
import SchemaNode from './model/schema-node';
import Context from './model/context';
import { Dictionary, JSONValue } from './model/common';

function qnameLocal(tag: string): string {
    const parts = tag.split(':');
    return parts.length >= 2 ? parts[1] : parts[0];
}

function resolveSchemaNode(rootSchema: SchemaNode, node?: SchemaNode): SchemaNode | undefined {
    while (node && node['$ref']) {
        if (node['$ref'][0] === '#') {
            node = jsonpointer.get(rootSchema, node['$ref'].substr(1));
        } else {
            node = jsonpointer.get(rootSchema, node['$ref']);
        }
    }
    return node;
}

function normalizeArrayItems<T>(items: T | T[]): T[] {
    if (Array.isArray(items)) {
        return items;
    } else {
        if (typeof items === 'object') {
            return [items];
        } else {
            return [];
        }
    }
}

function getAttributesNodeJSON(context: Context, strict: boolean): string {
    let result = '"$attributes":{';
    let first = true;
    for (const key of Object.keys(context.attributes)) {
        if (!strict || (context.schema.attributes && context.schema.attributes[key])) {
            if (!first) {
                result += ',';
            }
            first = false;
            const attributeType = (context.schema.attributes && context.schema.attributes[key]) || (strict ? null : 'string');
            let value;
            switch (attributeType) {
                case 'string':
                    value = JSON.stringify(context.attributes[key]);
                    break;
                case 'integer':
                    value = parseInt(context.attributes[key]).toString();
                    break;
                case 'number':
                    value = parseFloat(context.attributes[key]).toString();
                    break;
                case 'boolean':
                    value = context.attributes[key].toLowerCase();
                    break;
                default:
                    throw new Error('Invalid attribute type ' + attributeType + ' in ' + JSON.stringify(context.schema));
            }
            result += `"${key}":${value}`;
        } else {
            throw new Error('Did not find attribute "' + key + '" in ' + JSON.stringify(context.schema));
        }
    }
    result += '}';
    return result;
}

function getAttributesNodeObject(context: Context): Dictionary<JSONValue> {
    if (context.schema.attributes) {
        const result: Dictionary<JSONValue> = {};
        for (const key of Object.keys(context.attributes)) {
            const attributeType = context.schema.attributes[key] || 'string';
            switch (attributeType) {
                case 'integer':
                    result[key] = parseInt(context.attributes[key]);
                    break;
                case 'number':
                    result[key] = parseFloat(context.attributes[key]);
                    break;
                case 'boolean':
                    result[key] = context.attributes[key].toLowerCase() === 'true';
                    break;
                case 'string':
                default:
                    result[key] = context.attributes[key];
                    break;
            }
        }
        return result;
    } else {
        return context.attributes;
    }
}

export function toObject(xmlStream: stream.Readable, schema: SchemaNode, objectPath: string[], { strict = false, trimText = true, ignoreTagNameSpace = false } = {}): stream.Readable {
    const saxStream = sax.createStream(true, { xmlns: false });
    const objectStream = new stream.Readable({ objectMode: true });

    let depth = 0;
    let pathDepth = 0;

    const rootSchema = schema;
    const contextStack: Context[] = [{
        name: 'root',
        value: undefined,
        schema: rootSchema,
        attributes: {}
    }];

    saxStream.on('opentag', (node: sax.Tag) => {
        if (depth === pathDepth) {
            if (ignoreTagNameSpace && objectPath[depth] === qnameLocal(node.name)) {
                pathDepth += 1;
            } else if (objectPath[depth] === node.name) {
                pathDepth += 1;
            }
        }
        depth += 1;

        const context = contextStack[contextStack.length - 1];
        switch (context.schema.type) {
            case 'string':
            case 'integer':
            case 'number':
            case 'boolean':
                if (strict) {
                    throw new Error('Did not expect element <' + node.name + '> for schema type ' + context.schema.type);
                } else {
                    contextStack.push(context);
                }
                break;
            case 'object': {
                const name = qnameLocal(node.name);
                const schemaNode: SchemaNode | null = (
                        context.schema.properties
                        && resolveSchemaNode(rootSchema, context.schema.properties[name])
                    ) || (strict ? null : { type: 'array' });
                if (!schemaNode) {
                    console.error(contextStack);
                    throw new Error('Element <' + node.name + '> cannot be matched against object type in schema.');
                }
                contextStack.push({
                    name,
                    value: undefined,
                    schema: schemaNode,
                    attributes: node.attributes
                });
                break;
            }
            case 'array': {
                const name = qnameLocal(node.name);
                const items = normalizeArrayItems(context.schema.items);
                const schemaNode = resolveSchemaNode(rootSchema, items.find((item) => item!.title === name)!) || (strict ? null : { type: 'array' });
                if (!schemaNode) {
                    console.error(contextStack);
                    throw new Error('Element <' + node.name + '> cannot be matched against array items in schema.');
                }
                contextStack.push({
                    name,
                    value: undefined,
                    schema: schemaNode,
                    attributes: node.attributes
                });
                break;
            }
            default:
                throw new Error('Unknown type (in schema): ' + context.schema.type + ' in ' + JSON.stringify(context.schema));
        }
    });

    const textHandler = (text: string) => {
        const context = contextStack[contextStack.length - 1];
        let result;
        if (trimText) {
            text = text.trim();
        }

        switch (context.schema.type) {
            case 'string':
                result = text;
                break;
            case 'integer':
                result = parseInt(text);
                break;
            case 'number':
                result = parseFloat(text);
                break;
            case 'boolean':
                result = text.toLowerCase() === 'true';
                break;
            case 'object':
            case 'array':
                if (text.length >= 1) {
                    if (strict) {
                        throw new Error('Did not expect a text element to match ' + context.schema.type + ' (found "' + text + '" while parsing ' + JSON.stringify(context.schema) + ')');
                    } else {
                        result = text;
                    }
                }
                break;
            default:
                throw new Error('Unknown type (in schema): ' + context.schema.type + ' in ' + JSON.stringify(context.schema));
        }
        if (result !== undefined) {
            if (context.value !== undefined) {
                if (strict) {
                    throw new Error('Multiple text chunks/CData chunks not supported, or found text/CData after child nodes');
                }
            } else {
                context.value = result;
            }
        }
    };

    saxStream.on('cdata', textHandler);
    saxStream.on('text', textHandler);

    saxStream.on('closetag', () => {
        const context = contextStack.pop()!;
        const parent = contextStack[contextStack.length - 1];
        let result = context.value;
        if (result === undefined) {
            result = null;
        }
        if (Object.keys(context.attributes).length >= 1) {
            result = { '$value': result, '$attributes': getAttributesNodeObject(context) };
        }
        if (parent.schema.type === 'array') {
            if (!Array.isArray(parent.value)) {
                if (parent.value === undefined) {
                    parent.value = [];
                } else {
                    parent.value = [parent.value];
                }
            }
            if (normalizeArrayItems(parent.schema.items).length >= 2 || Object.keys(parent.attributes).length >= 1) {
                parent.value.push({ [context.name!]: result });
            } else {
                parent.value.push(result);
            }
        } else if (parent.schema.type === 'object') {
            if (typeof parent.value !== 'object') {
                if (parent.value === undefined) {
                    parent.value = {};
                } else {
                    parent.value = { '$value': parent.value };
                }
            }
            (parent.value as {[key: string]: JSONValue})[context.name!] = result;
        }
        if (depth === pathDepth) {
            if (pathDepth === objectPath.length) {
                // Emit object, clear parent value
                parent.value = undefined;
                if (!objectStream.push(result)) {
                    xmlStream.pause();
                }
            }
            pathDepth -= 1;
        }
        depth -= 1;
    });

    saxStream.on('end', () => {
        objectStream.push(null);
    });

    xmlStream.on('error', (error) => {
        objectStream.emit('error', error);
    });

    saxStream.on('error', (error) => {
        objectStream.emit('error', error);
    });

    objectStream._read = () => {
        xmlStream.resume();
    };

    xmlStream.pipe(saxStream);

    return objectStream;
}

export function toJSON(xmlStream: stream.Readable, schema: SchemaNode, { strict = false, trimText = true } = {}): stream.Readable {
    const saxStream = sax.createStream(true, { xmlns: false });
    const jsonStream = new stream.Readable();

    const rootSchema = schema;
    const contextStack: Context[] = [{
        root: true,
        schema: rootSchema,
        firstItem: true,
        hasText: false,
        attributes: {}
    }];

    saxStream.on('opentag', (node: sax.Tag) => {
        const context = contextStack[contextStack.length - 1];
        let result = '';
        switch (context.schema.type) {
            case 'string':
            case 'integer':
            case 'number':
            case 'boolean':
                if (strict) {
                    throw new Error('Did not expect element <' + node.name + '> for schema type ' + context.schema.type);
                } else {
                    contextStack.push(context);
                }
                break;
            case 'object': {
                const name = qnameLocal(node.name);
                const schemaNode = (
                        context.schema.properties
                        && resolveSchemaNode(rootSchema, context.schema.properties[name])
                    ) || (strict ? null : { type: 'array' });
                if (context.root) {
                    result += '{';
                }
                if (!schemaNode) {
                    console.error(contextStack);
                    throw new Error('Element <' + node.name + '> cannot be matched against object type in schema.');
                }
                if (!context.firstItem) {
                    result += ',';
                }
                result += JSON.stringify(name) + ':';
                if (schemaNode.type === 'object') {
                    result += '{';
                } else if (schemaNode.type === 'array') {
                    result += '[';
                }
                context.firstItem = false;
                contextStack.push({ root: false, schema: schemaNode, firstItem: true, hasText: false, attributes: node.attributes });
                break;
            }
            case 'array': {
                const name = qnameLocal(node.name);
                const items = normalizeArrayItems(context.schema.items);
                const schemaNode = resolveSchemaNode(rootSchema, items.find((item) => item!.title === name)) || (strict ? null : { type: 'array' });
                if (context.root) {
                    result += '[';
                }
                if (!schemaNode) {
                    console.error(contextStack);
                    throw new Error('Element <' + node.name + '> cannot be matched against array items in schema.');
                }
                if (!context.firstItem) {
                    result += ',';
                }
                if (items.length >= 2 || Object.keys(context.attributes).length >= 1) {
                    result += '{' + JSON.stringify(name) + ':';
                }
                if (schemaNode.type === 'object') {
                    result += '{';
                } else if (schemaNode.type === 'array') {
                    result += '[';
                }
                context.firstItem = false;
                contextStack.push({ root: false, schema: schemaNode, firstItem: true, hasText: false, attributes: node.attributes });
                break;
            }
            default:
                throw new Error('Unknown type (in schema): ' + context.schema.type + ' in ' + JSON.stringify(context.schema));
        }
        if (result.length >= 1) {
            if (!jsonStream.push(result)) {
                xmlStream.pause();
            }
        }
    });

    const textHandler = (text: string) => {
        const context: Context = contextStack[contextStack.length - 1];
        let result;
        if (trimText) {
            text = text.trim();
        }

        if (context.schema.type == 'object'
            || context.schema.type == 'array') {
            if (strict) {
                if (text.length >= 1) {
                    throw new Error('Did not expect a text element to match ' + context.schema.type + ' (found "' + text + '" while parsing ' + JSON.stringify(context.schema) + ')');
                } else {
                    result = '';
                }
            } else {
                result = text.length >= 1 ? JSON.stringify(text) : '';
            }
        } else {
            let value;

            switch(context.schema.type) {

                case 'string':
                    value = JSON.stringify(text);
                    break;
                case 'integer':
                    value = parseInt(text).toString();
                    break;
                case 'number':
                    value = parseFloat(text).toString();
                    break;
                case 'boolean':
                    value = text.toLowerCase();
                default:
                    throw new Error('Unknown type (in schema): ' + context.schema.type + ' in ' + JSON.stringify(context.schema));
            }

            if (Object.keys(context.attributes).length >= 1) {
                result = '{';
                result += getAttributesNodeJSON(context, strict);
                result += ',"$value":' + value + '}';
            } else {
                result = value;
            }
        }

        if (result.length >= 1) {
            if (context.hasText) {
                if (strict) {
                    throw new Error('Multiple text chunks/CData chunks not supported');
                }
            } else {
                context.hasText = true;
                if (!jsonStream.push(result)) {
                    xmlStream.pause();
                }
            }
        }
    };

    saxStream.on('cdata', textHandler);
    saxStream.on('text', textHandler);

    saxStream.on('closetag', () => {
        const context = contextStack.pop()!;
        let result;
        switch (context.schema.type) {
            case 'string':
            case 'integer':
            case 'number':
            case 'boolean':
                if (context.hasText) {
                    result = '';
                } else {
                    if (Object.keys(context.attributes).length >= 1) {
                        result = '{';
                        result += getAttributesNodeJSON(context, strict);
                        result += '}';
                    } else {
                        result = 'null';
                    }
                }
                break;
            case 'object':
                if (Object.keys(context.attributes).length >= 1) {
                    result = context.firstItem ? '' : ',';
                    result += getAttributesNodeJSON(context, strict) + '}';
                } else {
                    result = '}';
                }
                break;
            case 'array':
                if (Object.keys(context.attributes).length >= 1) {
                    result = context.firstItem ? '' : ',';
                    result += '{' + getAttributesNodeJSON(context, strict) + '}]';
                } else {
                    result = ']';
                }
                break;
            default:
                throw new Error('Unknown type in schema: ' + context.schema.type);
        }
        const parent = contextStack[contextStack.length - 1];
        if (parent.schema.type === 'array' && (normalizeArrayItems(parent.schema.items).length >= 2 || Object.keys(parent.attributes).length >= 1)) {
            result += '}';
        }
        if (parent.root) {
            if (parent.schema.type === 'object') {
                result += '}';
            } else if (parent.schema.type === 'array') {
                result += ']';
            }
        }
        if (result.length >= 1) {
            if (!jsonStream.push(result)) {
                xmlStream.pause();
            }
        }
    });

    saxStream.on('end', () => {
        jsonStream.push(null);
    });

    xmlStream.on('error', (error: Error) => {
        jsonStream.emit('error', error);
    });

    saxStream.on('error', (error: Error) => {
        jsonStream.emit('error', error);
    });

    jsonStream._read = () => {
        xmlStream.resume();
    };

    xmlStream.pipe(saxStream);

    return jsonStream;
}
