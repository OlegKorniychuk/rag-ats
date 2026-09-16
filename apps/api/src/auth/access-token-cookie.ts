import { ConfigService } from '@nestjs/config';
import type { CookieOptions } from 'express';
import * as ms from 'ms';

export const ACCESS_TOKEN_COOKIE = 'access_token';

// Single source of truth for the cookie's lifetime and security flags -
// login (set) and logout (clear) must both pass matching options, or the
// browser treats them as different cookies and logout silently no-ops.
export function accessTokenCookieOptions(config: ConfigService): CookieOptions {
  return {
    ...baseCookieOptions(config),
    maxAge: ms(config.getOrThrow<string>('JWT_EXPIRES_IN') as ms.StringValue),
  };
}

// res.clearCookie() deprecates passing maxAge (Express sets its own
// immediate-expiry value), so logout uses this instead of the full options.
export function clearAccessTokenCookieOptions(
  config: ConfigService,
): CookieOptions {
  return baseCookieOptions(config);
}

function baseCookieOptions(config: ConfigService): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.get<string>('NODE_ENV') === 'production',
  };
}
