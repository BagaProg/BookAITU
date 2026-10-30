const pool = require('../db');
const { encrypt, decrypt, verifyTotp, recoveryCodes, hashRecovery } = require('./crypto');
const { equal } = require('./config');

const publicUser = user => ({ id: String(user.id), email: user.email, name: user.name, role: user.role, two_factor_enabled: user.two_factor_enabled });
const problem = (code, status = 403) => Object.assign(new Error(code), { code, status });
async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

function createRepository(config) {
  return {
    async resolveIdentity(profile) {
      return transaction(async client => {
        const existing = (await client.query('SELECT * FROM users WHERE microsoft_id=$1 FOR UPDATE', [profile.microsoftId])).rows[0];
        if (existing && !existing.is_active) throw problem('ACCOUNT_DISABLED');
        // Never claim an existing account or its role based solely on a matching email.
        const collision = (await client.query('SELECT id FROM users WHERE email=$1 AND microsoft_id IS DISTINCT FROM $2', [profile.email, profile.microsoftId])).rows[0];
        if (collision) throw problem('ACCOUNT_LINK_REQUIRED', 409);
        let result;
        if (existing) result = await client.query('UPDATE users SET email=$1,name=$2 WHERE id=$3 RETURNING *', [profile.email, profile.name, existing.id]);
        else result = await client.query("INSERT INTO users(microsoft_id,email,name) VALUES($1,$2,$3) RETURNING *", [profile.microsoftId, profile.email, profile.name]);
        return publicUser(result.rows[0]);
      });
    },
    async findUser(id) {
      const user = (await pool.query('SELECT id,email,name,role,is_active,two_factor_enabled FROM users WHERE id=$1', [id])).rows[0];
      return user?.is_active ? publicUser(user) : null;
    },
    async secondFactor(id, input) {
      return transaction(async client => {
        const user = (await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!user?.is_active || !user.microsoft_id) throw problem('ACCOUNT_DISABLED');
        if (user.second_factor_locked_until && new Date(user.second_factor_locked_until).getTime() > Date.now()) return { ok: false, code: 'SECOND_FACTOR_LOCKED', status: 429 };
        if (input.enrollmentSecret && user.two_factor_enabled) throw problem('ALREADY_ENROLLED', 409);
        if (!input.enrollmentSecret && !user.two_factor_enabled) throw problem('ENROLLMENT_REQUIRED', 409);
        const secret = input.enrollmentSecret || decrypt(user.two_factor_secret, config.key);
        let match = { valid: false };
        let remaining = user.backup_codes || [];
        if (/^\d{6}$/.test(input.code)) match = await verifyTotp(secret, input.code, user.two_factor_last_step);
        else if (!input.enrollmentSecret && /^[a-f0-9\s-]{32,80}$/i.test(input.code)) {
          const hash = hashRecovery(input.code);
          const index = remaining.findIndex(value => equal(value, hash));
          if (index >= 0) { match = { valid: true }; remaining = remaining.filter((_, i) => i !== index); }
        }
        if (!match.valid) {
          const expiredLock = user.second_factor_locked_until && new Date(user.second_factor_locked_until).getTime() <= Date.now();
          const failures = (expiredLock ? 0 : user.second_factor_failures) + 1;
          await client.query('UPDATE users SET second_factor_failures=$1,second_factor_locked_until=$2 WHERE id=$3',
            [failures, failures >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null, id]);
          return { ok: false, code: failures >= 5 ? 'SECOND_FACTOR_LOCKED' : 'INVALID_SECOND_FACTOR', status: failures >= 5 ? 429 : 401 };
        }
        let codes;
        if (input.enrollmentSecret) {
          const generated = recoveryCodes(); codes = generated.codes; remaining = generated.hashes;
        }
        const updated = (await client.query(`UPDATE users SET two_factor_enabled=true,
          two_factor_secret=$1,backup_codes=$2::jsonb,two_factor_last_step=$3,
          second_factor_failures=0,second_factor_locked_until=NULL,last_login_at=now()
          WHERE id=$4 RETURNING id,email,name,role,two_factor_enabled`,
        [input.enrollmentSecret ? encrypt(secret, config.key) : user.two_factor_secret,
          JSON.stringify(remaining), match.timeStep == null ? user.two_factor_last_step : match.timeStep, id])).rows[0];
        return { ok: true, user: publicUser(updated), ...(codes ? { recoveryCodes: codes } : {}) };
      });
    },
  };
}
module.exports = { createRepository, publicUser };
