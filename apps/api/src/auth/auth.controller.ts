import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
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
import { AuthUserResponseDto } from './dto/auth-user-response.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { Public } from './public.decorator.js';
import { RegisterDto } from './dto/register.dto.js';
import { RegisteredRecruiterResponseDto } from './dto/registered-recruiter-response.dto.js';
import { SuccessResponseDto } from '../common/dto/success-response.dto.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly envConfig: EnvConfig,
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new recruiter account' })
  @ApiCreatedResponse({
    description: 'Recruiter account created',
    type: RegisteredRecruiterResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiConflictResponse({ description: 'Email already registered' })
  async register(
    @Body() dto: RegisterDto,
  ): Promise<{ id: string; email: string }> {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @ApiOperation({
    summary: 'Log in and receive an httpOnly access_token cookie',
    description:
      'On success, sets the httpOnly access_token cookie used to ' +
      'authenticate subsequent requests.',
  })
  @ApiCreatedResponse({
    description: 'Login succeeded, access_token cookie set',
    type: SuccessResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
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
  @ApiOperation({ summary: 'Log out and clear the access_token cookie' })
  @ApiCreatedResponse({
    description: 'Logout succeeded, access_token cookie cleared',
    type: SuccessResponseDto,
  })
  logout(@Res({ passthrough: true }) res: Response): { success: true } {
    res.clearCookie(
      ACCESS_TOKEN_COOKIE,
      clearAccessTokenCookieOptions(this.envConfig),
    );
    return { success: true };
  }

  @Get('me')
  @ApiOperation({ summary: 'Get the currently authenticated recruiter' })
  @ApiOkResponse({
    description: 'The authenticated recruiter',
    type: AuthUserResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid session' })
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}
