import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import {
  RECRUITERS_REPOSITORY,
  RecruitersRepository,
} from '../db/repositories/recruiters.repository';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const BCRYPT_SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    @Inject(RECRUITERS_REPOSITORY)
    private readonly recruitersRepository: RecruitersRepository,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<{ id: string; email: string }> {
    const existing = await this.recruitersRepository.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);
    const recruiter = await this.recruitersRepository.create({
      email: dto.email,
      passwordHash,
    });

    return { id: recruiter.id, email: recruiter.email };
  }

  async login(dto: LoginDto): Promise<{ accessToken: string }> {
    const recruiter = await this.recruitersRepository.findByEmail(dto.email);
    const passwordMatches = recruiter
      ? await bcrypt.compare(dto.password, recruiter.passwordHash)
      : false;

    // same error for "unknown email" and "wrong password" - don't let a
    // client distinguish which one failed
    if (!recruiter || !passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const accessToken = await this.jwtService.signAsync({
      sub: recruiter.id,
      email: recruiter.email,
    });

    return { accessToken };
  }
}
