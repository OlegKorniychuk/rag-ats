import { Body, Controller, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import {
  ACCESS_TOKEN_COOKIE,
  accessTokenCookieOptions,
} from './access-token-cookie';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
  ): Promise<{ id: string; email: string }> {
    return this.authService.register(dto);
  }

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true }> {
    const { accessToken } = await this.authService.login(dto);
    res.cookie(
      ACCESS_TOKEN_COOKIE,
      accessToken,
      accessTokenCookieOptions(this.configService),
    );
    return { success: true };
  }
}
