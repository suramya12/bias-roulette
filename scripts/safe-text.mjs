import { createHash } from 'node:crypto';

export const requestHash = (url) => createHash('sha256').update(url).digest('hex');

export const escapeMarkdown = (value) => String(value ?? '')
  .replace(/[\r\n\u2028\u2029]+/g, ' ')
  .replace(/[\\`*_{}\[\]()#+!|<>]/g, '\\$&');

export const escapeRegExp = (value) => value.replace(/[.*+?^${}()|\[\]\\]/g, '\\$&');
