const { token } = require('./config');
const { encrypt, decrypt } = require('./crypto');

function createMicrosoft(config) {
  let discovery;
  async function client() {
    if (!discovery) discovery = (async () => {
      const oidc = await import('openid-client');
      const settings = await oidc.discovery(new URL(`https://login.microsoftonline.com/${config.tenant}/v2.0`), config.clientId, config.clientSecret);
      oidc.enableNonRepudiationChecks(settings);
      return { oidc, settings };
    })().catch(error => { discovery = undefined; throw error; });
    return discovery;
  }
  return {
    async begin() {
      const { oidc, settings } = await client();
      const verifier = oidc.randomPKCECodeVerifier();
      const state = token(), nonce = token();
      const url = oidc.buildAuthorizationUrl(settings, {
        redirect_uri: config.redirectUri, scope: 'openid profile email', response_mode: 'query',
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256',
        state, nonce, prompt: 'select_account',
      });
      return { url: url.href, pending: { state, nonce, verifier: encrypt(verifier, config.key), expires: Date.now() + config.challengeMs } };
    },
    async finish(query, pending) {
      const { oidc, settings } = await client();
      const url = new URL(config.redirectUri);
      url.search = query;
      const result = await oidc.authorizationCodeGrant(settings, url, {
        pkceCodeVerifier: decrypt(pending.verifier, config.key), expectedState: pending.state,
        expectedNonce: pending.nonce, idTokenExpected: true,
      });
      return result.claims();
    },
  };
}
module.exports = { createMicrosoft };
