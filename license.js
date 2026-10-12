// Лицензионные ключи: подпись Ed25519. Ключ нельзя создать без закрытого ключа владельца.
// Формат: VINCI.<данные base64url>.<подпись base64url>
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execFile } = require('child_process');
const PUB = require('./pubkey.js');

// Если хочешь отзывать ключи удалённо: выложи на свой сайт файл со списком id (JSON-массив) и впиши адрес сюда.
const REVOKE_URL = '';

const SPKI = Buffer.from('302a300506032b6570032100', 'hex');
let pubKey = null;
try { pubKey = crypto.createPublicKey({ key: Buffer.concat([SPKI, Buffer.from(PUB, 'base64')]), format: 'der', type: 'spki' }); } catch (e) { pubKey = null; }

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

let dir = null, mid = null, current = null, revoked = [];
const fKey = () => path.join(dir, 'license.key');
const fSeen = () => path.join(dir, 'license.seen');

function machineId() {
  return new Promise((resolve) => {
    if (mid) return resolve(mid);
    const done = (raw) => {
      const h = crypto.createHash('sha256').update('5vinci|' + raw).digest('hex').slice(0, 16).toUpperCase();
      mid = h.match(/.{4}/g).join('-'); resolve(mid);
    };
    if (process.platform !== 'win32') return done(os.hostname() + os.arch());
    const reg = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
    execFile(reg, ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { windowsHide: true, timeout: 8000 }, (err, out) => {
      const m = /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(String(out || ''));
      done(m ? m[1] : os.hostname() + os.arch() + (os.cpus()[0] || {}).model);
    });
  });
}

function parse(key) {
  key = String(key || '').replace(/\s+/g, '');
  const p = key.split('.');
  if (p.length !== 3 || p[0] !== 'VINCI' || !pubKey) return { ok: false, msg: 'Это не похоже на ключ 5VINCI' };
  if (key.length > 1000) return { ok: false, msg: 'Ключ слишком длинный' };
  let sig;
  try { sig = unb64u(p[2]); } catch (e) { return { ok: false, msg: 'Ключ повреждён' }; }
  let good = false;
  try { good = sig.length === 64 && crypto.verify(null, Buffer.from(p[1], 'ascii'), pubKey, sig); } catch (e) { good = false; }
  if (!good) return { ok: false, msg: 'Ключ не подошёл. Проверь, что скопировал его целиком' };
  let d;
  try { d = JSON.parse(unb64u(p[1]).toString('utf8')); } catch (e) { return { ok: false, msg: 'Ключ повреждён' }; }
  if (!d || typeof d !== 'object' || typeof d.i !== 'string') return { ok: false, msg: 'Ключ повреждён' };
  return { ok: true, data: d, key };
}

function readSeen() { try { return Number(fs.readFileSync(fSeen(), 'utf8')) || 0; } catch (e) { return 0; } }
function touchSeen(now) { try { if (now > readSeen()) fs.writeFileSync(fSeen(), String(now)); } catch (e) {} }

async function check(key) {
  const r = parse(key);
  if (!r.ok) return r;
  const d = r.data, now = Date.now();
  if (d.m) { const id = await machineId(); if (String(d.m).toUpperCase() !== id) return { ok: false, msg: 'Этот ключ выдан для другого компьютера' }; }
  if (revoked.indexOf(d.i) >= 0) return { ok: false, msg: 'Этот ключ отозван' };
  if (d.e) {
    const exp = Number(d.e) * 864e5;
    if (now > exp) return { ok: false, msg: 'Срок ключа закончился ' + new Date(exp - 864e5).toLocaleDateString('ru-RU') };
    if (now < readSeen() - 864e5) return { ok: false, msg: 'Часы компьютера переведены назад. Верни правильное время' };
  }
  touchSeen(now);
  return { ok: true, key: r.key, info: { id: d.i, name: d.n || '', plan: d.p || 'pro', exp: d.e ? (Number(d.e) - 1) * 864e5 : 0, bound: !!d.m } };
}

function fetchRevoked() {
  if (!REVOKE_URL) return;
  try {
    https.get(REVOKE_URL, { timeout: 6000 }, (res) => {
      let b = ''; res.on('data', (c) => { if (b.length < 1e5) b += c; });
      res.on('end', () => { try { const a = JSON.parse(b); if (Array.isArray(a)) { revoked = a.map(String); if (current && revoked.indexOf(current.id) >= 0) { current = null; try { fs.unlinkSync(fKey()); } catch (e) {} } } } catch (e) {} });
    }).on('error', () => {}).on('timeout', function () { this.destroy(); });
  } catch (e) {}
}

async function init(userDir) {
  dir = userDir;
  let k = ''; try { k = fs.readFileSync(fKey(), 'utf8'); } catch (e) {}
  const r = k ? await check(k) : { ok: false, msg: '' };
  current = r.ok ? r.info : null;
  fetchRevoked();
  return status();
}
async function status() {
  const id = await machineId();
  if (current && current.exp && Date.now() >= current.exp + 864e5) current = null;
  return { ok: !!current, info: current, machine: id };
}
async function activate(key) {
  const r = await check(key);
  if (!r.ok) return { ok: false, msg: r.msg, machine: await machineId() };
  try { fs.writeFileSync(fKey(), r.key); } catch (e) { return { ok: false, msg: 'Не удалось сохранить ключ: ' + e.message }; }
  current = r.info;
  return status();
}
function logout() { current = null; try { fs.unlinkSync(fKey()); } catch (e) {} return { ok: true }; }
const valid = () => !!current && (!current.exp || Date.now() < current.exp + 864e5);

module.exports = { init, status, activate, logout, valid, parse };
