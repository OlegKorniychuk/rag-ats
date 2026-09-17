import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  ACCESS_TOKEN_COOKIE,
  accessTokenCookieOptions,
  clearAccessTokenCookieOptions,
} from './access-token-cookie.js';
import { AuthService } from './auth.service.js';
import type { AuthUser } from './auth-user.js';
import { EnvConfig } from '../config/env.config.js';
import { CurrentUser } from './current-user.decorator.js';
import { LoginDto } from './dto/login.dto.js';
import { Public } from './public.decorator.js';
import { RegisterDto } from './dto/register.dto.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly envConfig: EnvConfig,
  ) {}

  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
  ): Promise<{ id: string; email: string }> {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true }> {
    const { accessToken } = await this.authService.login(dto);
    res.cookie(
      ACCESS_TOKEN_COOKIE,
      accessToken,
      accessTokenCookieOptions(this.envConfig),
    );
    return { success: true };
  }

  @Public()
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response): { success: true } {
    res.clearCookie(
      ACCESS_TOKEN_COOKIE,
      clearAccessTokenCookieOptions(this.envConfig),
    );
    return { success: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}
