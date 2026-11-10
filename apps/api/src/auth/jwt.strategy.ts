import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { Strategy } from 'passport-jwt';
import { ACCESS_TOKEN_COOKIE } from './access-token-cookie.js';
import type { AuthUser } from './auth-user.js';
import { EnvConfig } from '../config/env.config.js';
import {
  RECRUITERS_REPOSITORY,
  type RecruitersRepository,
} from '../db/repositories/recruiters.repository.js';
import type { JwtPayload } from './jwt-payload.interface.js';

function cookieExtractor(req: Request): string | null {
  return req?.cookies?.[ACCESS_TOKEN_COOKIE] ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: EnvConfig,
    @Inject(RECRUITERS_REPOSITORY)
    private readonly recruitersRepository: RecruitersRepository,
  ) {
    super({
      jwtFromRequest: cookieExtractor,
      ignoreExpiration: false,
      secretOrKey: config.JWT_SECRET,
    });
  }

  // A signature-valid token is not enough: the recruiter may have been deleted
  // since it was issued. Returning null makes Passport answer 401.
  async validate(payload: JwtPayload): Promise<AuthUser | null> {
    const recruiter = await this.recruitersRepository.findById(payload.sub);
    if (!recruiter) return null;
    return { id: recruiter.id, email: recruiter.email };
  }
}
