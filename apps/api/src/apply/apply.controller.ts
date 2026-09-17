import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { ApplyService, type PublicVacancy } from './apply.service.js';

@Controller('apply')
@Public()
export class ApplyController {
  constructor(private readonly applyService: ApplyService) {}

  @Get(':token')
  async getByToken(@Param('token') token: string): Promise<PublicVacancy> {
    return this.applyService.getByToken(token);
  }
}
