import jwt from 'jsonwebtoken';
import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

export interface LicensePayload {
  customerId: string;
  customerName: string;
  plan: string;
  maxUsers: number;
  maxObjects: number;
  features: string[];
  addons: string[];
  deliveryModel: 'saas' | 'on_prem' | 'dev';
}

function getPrivateKey(): string {
  if (process.env.RSA_PRIVATE_KEY) return process.env.RSA_PRIVATE_KEY;
  const keyPath = process.env.RSA_PRIVATE_KEY_PATH || join(process.cwd(), 'keys', 'private.pem');
  return readFileSync(keyPath, 'utf8');
}

export function signLicense(payload: LicensePayload, expiresAt?: Date): string {
  const privateKey = getPrivateKey();
  const keyId = process.env.LICENSE_KEY_ID || 'dev-2026-01';
  const jti = randomUUID();

  const options: jwt.SignOptions = {
    algorithm: 'RS256',
    header: { alg: 'RS256', typ: 'JWT', kid: keyId } as jwt.Algorithm & object,
    issuer: 'designfoundry-superadmin',
    jwtid: jti,
  };

  if (expiresAt) {
    options.expiresIn = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  }

  return jwt.sign({ ...payload, jti }, privateKey, options);
}

/** Wraps a JWT in a PEM-like .lic file format */
export function toLicFile(licenseJwt: string): string {
  return [
    '-----BEGIN DESIGNFOUNDRY LICENSE-----',
    Buffer.from(licenseJwt).toString('base64'),
    '-----END DESIGNFOUNDRY LICENSE-----',
  ].join('\n') + '\n';
}

export function planDefaults(plan: string): { maxUsers: number; maxObjects: number; features: string[] } {
  const plans: Record<string, { maxUsers: number; maxObjects: number; features: string[] }> = {
    free:         { maxUsers: 5,   maxObjects: 100,  features: ['core'] },
    team:         { maxUsers: 25,  maxObjects: 1000, features: ['core', 'collaboration'] },
    professional: { maxUsers: 100, maxObjects: 5000, features: ['core', 'collaboration', 'export'] },
    enterprise:   { maxUsers: -1,  maxObjects: -1,   features: ['core', 'collaboration', 'export', 'sso', 'audit'] },
  };
  return plans[plan] ?? plans.free;
}
