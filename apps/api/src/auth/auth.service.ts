import { ConflictException, Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import {
  RECRUITERS_REPOSITORY,
  RecruitersRepository,
} from '../db/repositories/recruiters.repository';
import { RegisterDto } from './dto/register.dto';

const BCRYPT_SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    @Inject(RECRUITERS_REPOSITORY)
    private readonly recruitersRepository: RecruitersRepository,
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
}
