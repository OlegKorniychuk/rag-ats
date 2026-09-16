import type { CookieOptions } from 'express';
import ms from 'ms';
import type { StringValue } from 'ms';
import { EnvConfig } from '../config/env.config.js';

export const ACCESS_TOKEN_COOKIE = 'access_token';

// Single source of truth for the cookie's lifetime and security flags -
// login (set) and logout (clear) must both pass matching options, or the
// browser treats them as different cookies and logout silently no-ops.
export function accessTokenCookieOptions(config: EnvConfig): CookieOptions {
  return {
    ...baseCookieOptions(config),
    maxAge: ms(config.JWT_EXPIRES_IN as StringValue),
  };
}

// res.clearCookie() deprecates passing maxAge (Express sets its own
// immediate-expiry value), so logout uses this instead of the full options.
export function clearAccessTokenCookieOptions(
  config: EnvConfig,
): CookieOptions {
  return baseCookieOptions(config);
}

function baseCookieOptions(config: EnvConfig): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
  };
}
