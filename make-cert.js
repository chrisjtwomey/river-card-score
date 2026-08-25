'use strict';
/* Makes a self-signed certificate for this machine, so the server can serve
   https. Phones then keep the screen awake, because that needs a secure page.
   A phone shows a warning once, because nobody signed this certificate. */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = path.join(__dirname, 'certs');
fs.mkdirSync(dir, { recursive: true });
const key = path.join(dir, 'key.pem');
const cert = path.join(dir, 'cert.pem');

const ips = [];
Object.values(os.networkInterfaces()).forEach((list) => (list || []).forEach((ni) => {
  if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
}));
const san = ['DNS:localhost', 'IP:127.0.0.1'].concat(ips.map((ip) => `IP:${ip}`)).join(',');

console.log('addresses in the certificate:', san);
execFileSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
  '-keyout', key, '-out', cert, '-days', '825',
  '-subj', '/CN=up-down-the-river',
  '-addext', `subjectAltName=${san}`,
], { stdio: ['ignore', 'inherit', 'inherit'] });

console.log('\nwrote', key);
console.log('wrote', cert);
console.log('\nStart the server again. It will serve https.');
console.log('Each phone shows a warning the first time: accept it to go on.');
