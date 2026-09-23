import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { Application } from '../db/repositories/applications.repository.js';
import { ApplicationsService } from './applications.service.js';
import { UpdateApplicationDto } from './dto/update-application.dto.js';

@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Patch(':id')
  async updateStage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApplicationDto,
  ): Promise<Application> {
    return this.applicationsService.updateStage(user.id, id, dto);
  }
}
