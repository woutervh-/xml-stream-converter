import fs from 'fs';
import stream from 'stream';

export function toObject(xmlStream: fs.ReadStream, schema: string?, objectPath: string[], { strict: boolean = false, trimText: boolean = true, ignoreTagNameSpace: boolean = false } = {}): stream.Readable;
export function toJSON(xmlStream: fs.ReadStream, schema: string?, { strict: boolean = false, trimText: boolean = true } = {}): stream.Readable;