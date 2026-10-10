import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// The script-tag build is loaded from a CDN on every login page. Its
// Subresource Integrity hash goes into dist/sri.json, and the backend SDKs pin
// it in the <script integrity="..."> they write, so a tampered file never runs.
const file = new URL('../dist/murkio.js', import.meta.url);
const digest = createHash('sha384').update(readFileSync(file)).digest('base64');
writeFileSync(new URL('../dist/sri.json', import.meta.url), JSON.stringify({ 'murkio.js': `sha384-${digest}` }, null, 2) + '\n');
console.log(`murkio.js sha384-${digest}`);
