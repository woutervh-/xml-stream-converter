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

function getAttributesNodeJSON(context, strict) {
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
                case 'integer':
                case 'number':
                case 'boolean':
                    let value;
                    if (attributeType === 'string') {
                        value = JSON.stringify(context.attributes[key]);
                    } else if (attributeType === 'integer') {
                        value = parseInt(context.attributes[key]).toString();
                    } else if (attributeType === 'number') {
                        value = parseFloat(context.attributes[key]).toString();
                    } else {
                        value = context.attributes[key].toLowerCase();
                    }
                    result += `"${key}":${value}`;
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

export function toObject(xmlStream, schema, objectPath, {strict = false, trimText = true} = {}) {
    const saxStream = sax.createStream(strict, {xmlns: false});
    const objectStream = new stream.Readable({objectMode: true});

    let depth = 0;
    let pathDepth = 0;

    const rootSchema = schema;
    const contextStack = [{
        name: 'root',
        value: undefined,
        schema: rootSchema,
        attributes: {}
    }];

    saxStream.on('opentag', (node) => {
        if (depth === pathDepth && objectPath[depth] === node.name) {
            pathDepth += 1;
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
                const schemaNode = resolveSchemaNode(rootSchema, context.schema.properties[name]) || (strict ? null : {type: 'array'});
                if (!schemaNode) {
                    console.error(contextStack);
                    throw new Error('Element <' + node.name + '> cannot be matched against object type in schema.');
                }
                contextStack.push({name, value: undefined, schema: schemaNode, attributes: node.attributes});
                break;
            }
            case 'array': {
                const name = qnameLocal(node.name);
                const items = normalizeArrayItems(context.schema.items);
                const schemaNode = resolveSchemaNode(rootSchema, items.find((item) => item.title === name)) || (strict ? null : {type: 'array'});
                if (!schemaNode) {
                    console.error(contextStack);
                    throw new Error('Element <' + node.name + '> cannot be matched against array items in schema.');
                }
                contextStack.push({name, value: undefined, schema: schemaNode, attributes: node.attributes});
                break;
            }
            default:
                throw new Error('Unknown type (in schema): ' + context.schema.type + ' in ' + JSON.stringify(context.schema));
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
            case 'integer':
            case 'number':
            case 'boolean':
                if (context.schema.type === 'string') {
                    result = text;
                } else if (context.schema.type === 'integer') {
                    result = parseInt(text);
                } else if (context.schema.type === 'number') {
                    result = parseFloat(text);
                } else {
                    result = text.toLowerCase();
                }
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
        const context = contextStack.pop();
        const parent = contextStack[contextStack.length - 1];
        let result = context.value;
        if (result === undefined) {
            result = null;
        }
        if (Object.keys(context.attributes).length >= 1) {
            result = {'$value': result, '$attributes': context.attributes};
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
                parent.value.push({[context.name]: result});
            } else {
                parent.value.push(result);
            }
        } else if (parent.schema.type === 'object') {
            if (typeof parent.value !== 'object') {
                if (parent.value === undefined) {
                    parent.value = {};
                } else {
                    parent.value = {'$value': parent.value};
                }
            }
            parent.value[context.name] = result;
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

export function toJSON(xmlStream, schema, {strict = false, trimText = true} = {}) {
    const saxStream = sax.createStream(strict, {xmlns: false});
    const jsonStream = new stream.Readable();

    const rootSchema = schema;
    const contextStack = [{
        root: true,
        schema: rootSchema,
        firstItem: true,
        hasText: false,
        attributes: {}
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
                if (items.length >= 2 || Object.keys(context.attributes).length >= 1) {
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
            case 'integer':
            case 'number':
            case 'boolean':
                let value;
                if (context.schema.type === 'string') {
                    value = JSON.stringify(text);
                } else if (context.schema.type === 'integer') {
                    value = parseInt(text).toString();
                } else if (context.schema.type === 'number') {
                    value = parseFloat(text).toString();
                } else {
                    value = text.toLowerCase();
                }
                if (Object.keys(context.attributes).length >= 1) {
                    result = '{';
                    result += getAttributesNodeJSON(context, strict);
                    result += ',"$value":' + value + '}';
                } else {
                    result = value;
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
