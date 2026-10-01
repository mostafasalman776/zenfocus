import { createHash, randomBytes } from 'node:crypto';

// Minimal Google OAuth 2.0 / OpenID Connect (authorization code + PKCE).
// The ID token comes straight from Google's token endpoint over TLS, so per
// OIDC Core §3.1.3.7 we may read its claims without verifying the signature;
// we still check issuer, audience and expiry.

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface GoogleProfile {
  sub: string;
  email: string | null;
  name: string | null;
  picture: string | null;
}

export const randomToken = () => randomBytes(32).toString('base64url');

export class GoogleOAuth {
  constructor(
    private clientId: string,
    private clientSecret: string,
    private redirectUri: string
  ) {}

  authorizationUrl(state: string, codeVerifier: string): string {
    const challenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account'
    });
    return `${AUTH_URL}?${params}`;
  }

  async exchange(code: string, codeVerifier: string): Promise<GoogleProfile> {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        code_verifier: codeVerifier,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code'
      }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!res.ok) throw new Error(`google token exchange failed: ${res.status}`);
    const { id_token: idToken } = (await res.json()) as { id_token?: string };
    if (!idToken) throw new Error('google response had no id_token');

    const payload = idToken.split('.')[1];
    if (!payload) throw new Error('malformed id_token');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    const issuerOk = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
    if (!issuerOk || claims.aud !== this.clientId || Number(claims.exp) * 1000 < Date.now()) {
      throw new Error('id_token failed validation');
    }
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    return { sub: String(claims.sub), email: str(claims.email), name: str(claims.name), picture: str(claims.picture) };
  }
}
