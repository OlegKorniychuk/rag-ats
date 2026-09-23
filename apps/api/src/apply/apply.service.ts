import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import {
  APPLICATIONS_REPOSITORY,
  type ApplicationsRepository,
} from '../db/repositories/applications.repository.js';
import {
  CANDIDATES_REPOSITORY,
  type CandidatesRepository,
} from '../db/repositories/candidates.repository.js';
import {
  VACANCIES_REPOSITORY,
  type Vacancy,
  type VacanciesRepository,
} from '../db/repositories/vacancies.repository.js';
import type { SubmitApplicationDto } from './dto/submit-application.dto.js';
import { mergeCandidateProfile } from './merge-candidate-profile.js';

export type PublicVacancy = Pick<Vacancy, 'title' | 'requirements' | 'status'>;

export interface SubmitApplicationResult {
  success: true;
}

@Injectable()
export class ApplyService {
  constructor(
    @Inject(VACANCIES_REPOSITORY)
    private readonly vacanciesRepository: VacanciesRepository,
    @Inject(CANDIDATES_REPOSITORY)
    private readonly candidatesRepository: CandidatesRepository,
    @Inject(APPLICATIONS_REPOSITORY)
    private readonly applicationsRepository: ApplicationsRepository,
  ) {}

  async getByToken(token: string): Promise<PublicVacancy> {
    const vacancy = await this.vacanciesRepository.findByApplyToken(token);

    if (!vacancy) {
      throw new NotFoundException('Vacancy not found');
    }

    return {
      title: vacancy.title,
      requirements: vacancy.requirements,
      status: vacancy.status,
    };
  }

  @Transactional()
  async submit(
    token: string,
    dto: SubmitApplicationDto,
  ): Promise<SubmitApplicationResult> {
    const vacancy = await this.vacanciesRepository.findByApplyToken(token);
    if (!vacancy) {
      throw new NotFoundException('Vacancy not found');
    }

    if (vacancy.status === 'closed') {
      throw new ConflictException('Vacancy is closed');
    }

    const existing = await this.candidatesRepository.findByEmail(dto.email);

    // check for a duplicate application before merging the submission into
    // the candidate's profile, so a rejected duplicate never mutates data
    if (existing) {
      const existingApplication =
        await this.applicationsRepository.findByVacancyAndCandidate(
          vacancy.id,
          existing.id,
        );
      if (existingApplication) {
        throw new ConflictException('Already applied to this vacancy');
      }
    }

    const candidate = existing
      ? await this.candidatesRepository.update(
          existing.id,
          mergeCandidateProfile(existing, dto),
        )
      : await this.candidatesRepository.create({
          name: dto.name,
          email: dto.email,
          githubUrl: dto.githubUrl,
          portfolioUrl: dto.portfolioUrl,
          skills: dto.skills,
          experience: dto.experience,
          projects: dto.projects,
          summary: dto.summary,
        });

    await this.applicationsRepository.create({
      vacancyId: vacancy.id,
      candidateId: candidate.id,
    });

    return { success: true };
  }
}
