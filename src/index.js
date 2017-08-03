import sax from 'sax';
import stream from 'stream';
import jsonpointer from 'jsonpointer';

function qnameLocal(tag) {
    const parts = tag.split(':');
    return parts.length >= 2 ? parts[1] : parts[0];
}

function resolveSchemaNode(rootSchema, node) {
    while (node && node['$ref']) {
        if (node['$ref'][0] === '#') {
            node = jsonpointer.get(rootSchema, node['$ref'].substr(1));
        } else {
            node = jsonpointer.get(rootSchema, node['$ref']);
        }
    }
    return node;
}

function normalizeArrayItems(items) {
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

function getAttributesNode(context, strict) {
    let result = '"$attributes":{';
    let first = true;
    for (const key of Object.keys(context.attributes)) {
        if (!strict || (context.schema.attributes && context.schema.attributes[key])) {
            if (!first) {
                result += ',';
            }
            first = false;
            const attributeType = (context.schema.attributes && context.schema.attributes[key]) || (strict ? null : 'string');
            switch (attributeType) {
                case 'string':
                    result += `"${key}":${JSON.stringify(context.attributes[key])}`;
                    break;
                case 'integer':
                case 'number':
                case 'boolean':
                    result += `"${key}":${context.attributes[key].toLowerCase()}`;
                    break;
                default:
                    throw new Error('Invalid attribute type ' + attributeType + ' in ' + JSON.stringify(context.schema));
            }
        } else {
            throw new Error('Did not find attribute "' + key + '" in ' + JSON.stringify(context.schema));
        }
    }
    result += '}';
    return result;
}

export default function convert(xmlStream, schema, {strict = false, trimText = true} = {}) {
    const saxStream = sax.createStream(true, {xmlns: false});
    const jsonStream = new stream.Readable();

    const rootSchema = schema;
    const contextStack = [{
        root: true,
        schema: rootSchema,
        firstItem: true,
        hasText: false,
        attributes: []
    }];

    saxStream.on('opentag', (node) => {
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
                const schemaNode = resolveSchemaNode(rootSchema, context.schema.properties[name]) || (strict ? null : {type: 'array'});
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
                contextStack.push({root: false, schema: schemaNode, firstItem: true, hasText: false, attributes: node.attributes});
                break;
            }
            case 'array': {
                const name = qnameLocal(node.name);
                const items = normalizeArrayItems(context.schema.items);
                const schemaNode = resolveSchemaNode(rootSchema, items.find((item) => item.title === name)) || (strict ? null : {type: 'array'});
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
                if (items.length >= 2) {
                    result += '{' + JSON.stringify(name) + ':';
                }
                if (schemaNode.type === 'object') {
                    result += '{';
                } else if (schemaNode.type === 'array') {
                    result += '[';
                }
                context.firstItem = false;
                contextStack.push({root: false, schema: schemaNode, firstItem: true, hastText: false, attributes: node.attributes});
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

    const textHandler = (text) => {
        const context = contextStack[contextStack.length - 1];
        let result;
        if (trimText) {
            text = text.trim();
        }

        switch (context.schema.type) {
            case 'string':
                if (Object.keys(context.attributes).length >= 1) {
                    result = '{';
                    result += getAttributesNode(context, strict);
                    result += ',"$value":' + JSON.stringify(text) + '}';
                } else {
                    result = JSON.stringify(text);
                }
                break;
            case 'integer':
            case 'number':
            case 'boolean':
                if (Object.keys(context.attributes).length >= 1) {
                    result = '{';
                    result += getAttributesNode(context, strict);
                    result += ',"$value":' + text.toLowerCase() + '}';
                } else {
                    result = text.toLowerCase();
                }
                break;
            case 'object':
            case 'array':
                if (strict) {
                    if (text.length >= 1) {
                        throw new Error('Did not expect a text element to match ' + context.schema.type + ' (found "' + text + '" while parsing ' + JSON.stringify(context.schema) + ')');
                    } else {
                        result = '';
                    }
                } else {
                    result = text.length >= 1 ? JSON.stringify(text) : '';
                }
                break;
            default:
                throw new Error('Unknown type (in schema): ' + context.schema.type + ' in ' + JSON.stringify(context.schema));
        }
        if (result.length >= 1) {
            if (context.hasText) {
                throw new Error('Multiple text chunks/CData chunks not supported');
            }
            context.hasText = true;
            if (!jsonStream.push(result)) {
                xmlStream.pause();
            }
        }
    };

    saxStream.on('cdata', textHandler);
    saxStream.on('text', textHandler);

    saxStream.on('closetag', () => {
        const context = contextStack.pop();
        let result;
        switch (context.schema.type) {
            case 'string':
            case 'integer':
            case 'number':
            case 'boolean':
                if (context.hasText) {
                    result = '';
                } else {
                    result = 'null';
                }
                break;
            case 'object':
                if (Object.keys(context.attributes).length >= 1) {
                    result = context.firstItem ? '' : ',';
                    result += getAttributesNode(context, strict) + '}';
                } else {
                    result = '}';
                }
                break;
            case 'array':
                if (Object.keys(context.attributes).length >= 1) {
                    result = context.firstItem ? '' : ',';
                    result += '{' + getAttributesNode(context, strict) + '}]';
                } else {
                    result = ']';
                }
                break;
            default:
                throw new Error('Unknown type in schema: ' + context.schema.type);
        }
        const parent = contextStack[contextStack.length - 1];
        if (parent.schema.type === 'array' && normalizeArrayItems(parent.schema.items).length >= 2) {
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

    xmlStream.on('error', (error) => {
        jsonStream.emit('error', error);
    });

    saxStream.on('error', (error) => {
        jsonStream.emit('error', error);
    });

    jsonStream._read = () => {
        xmlStream.resume();
    };

    xmlStream.pipe(saxStream);

    return jsonStream;
}
