import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  APPLICATIONS_REPOSITORY,
  type Application,
  type ApplicationsRepository,
} from '../db/repositories/applications.repository.js';
import type { UpdateApplicationDto } from './dto/update-application.dto.js';

@Injectable()
export class ApplicationsService {
  constructor(
    @Inject(APPLICATIONS_REPOSITORY)
    private readonly applicationsRepository: ApplicationsRepository,
  ) {}

  async updateStage(
    recruiterId: string,
    applicationId: string,
    dto: UpdateApplicationDto,
  ): Promise<Application> {
    const application =
      await this.applicationsRepository.findByIdWithVacancy(applicationId);

    // same 404 for "doesn't exist" and "exists but isn't yours" - don't let
    // a client distinguish which one it is
    if (!application || application.vacancy.recruiterId !== recruiterId) {
      throw new NotFoundException('Application not found');
    }

    return this.applicationsRepository.updateStage(applicationId, dto.stage);
  }
}
