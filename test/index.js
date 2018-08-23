const fs = require('fs');
const { toObject } = require('../lib/index');

const schema = {
    type: 'object',
    properties: {
        Document: {
            type: 'array',
            items: [
                {
                    title: 'metaData',
                    type: 'object',
                    properties: {
                        foo: {
                            type: 'integer'
                        },
                        bar: {
                            type: 'string'
                        },
                        created: {
                            type: 'string'
                        }
                    }
                },
                {
                    title: 'item',
                    type: 'object',
                    properties: {
                        message: {
                            type: 'object',
                            properties: {
                                key: {
                                    type: 'string'
                                },
                                version: {
                                    type: 'integer'
                                },
                                contentType: {
                                    type: 'string'
                                }
                            }
                        },
                        location: {
                            type: 'object',
                            properties: {
                                position: {
                                    type: 'string'
                                }
                            }
                        },
                        event: {
                            type: 'object',
                            properties: {
                                importantEvent: {
                                    type: 'string'
                                },
                                secondaryEvent: {
                                    type: 'string'
                                }
                            }
                        }
                    }
                }
            ]
        }
    }
};

toObject(fs.createReadStream(__dirname + '/test-ns.xml'), schema, ['Document', 'item'], { ignoreTagNameSpace: true })
    .on('data', (data) => {
        console.log(data);
    });
