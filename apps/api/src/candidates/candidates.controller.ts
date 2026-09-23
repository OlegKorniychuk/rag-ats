import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import type { Candidate } from '../db/repositories/candidates.repository.js';
import { CandidatesService } from './candidates.service.js';

@Controller('candidates')
export class CandidatesController {
  constructor(private readonly candidatesService: CandidatesService) {}

  @Get()
  async findAll(): Promise<Candidate[]> {
    return this.candidatesService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Candidate> {
    return this.candidatesService.findOne(id);
  }
}
