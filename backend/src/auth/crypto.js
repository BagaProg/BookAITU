const crypto = require('node:crypto');
const otp = require('otplib');

function encrypt(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('BookAITU:2FA:v1'));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}
function decrypt(value, key) {
  const [version, iv, tag, ciphertext, extra] = String(value).split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext || extra) throw new Error('Invalid encrypted secret');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from('BookAITU:2FA:v1'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}
const hashRecovery = value => crypto.createHash('sha256').update(String(value).replace(/[\s-]/g, '').toLowerCase()).digest('hex');
function recoveryCodes() {
  const codes = Array.from({ length: 10 }, () => crypto.randomBytes(16).toString('hex').match(/.{4}/g).join('-'));
  return { codes, hashes: codes.map(hashRecovery) };
}
async function verifyTotp(secret, code, lastStep) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return { valid: false };
  return otp.verify({ secret, token: code, epochTolerance: 30,
    ...(lastStep == null ? {} : { afterTimeStep: Number(lastStep) }) });
}
module.exports = { encrypt, decrypt, hashRecovery, recoveryCodes, verifyTotp, generateSecret: otp.generateSecret, generateURI: otp.generateURI };
