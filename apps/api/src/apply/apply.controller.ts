import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import {
  ApplyService,
  type PublicVacancy,
  type SubmitApplicationResult,
} from './apply.service.js';
import { SubmitApplicationDto } from './dto/submit-application.dto.js';

@Controller('apply')
@Public()
export class ApplyController {
  constructor(private readonly applyService: ApplyService) {}

  @Get(':token')
  async getByToken(@Param('token') token: string): Promise<PublicVacancy> {
    return this.applyService.getByToken(token);
  }

  @Post(':token')
  async submit(
    @Param('token') token: string,
    @Body() dto: SubmitApplicationDto,
  ): Promise<SubmitApplicationResult> {
    return this.applyService.submit(token, dto);
  }
}
