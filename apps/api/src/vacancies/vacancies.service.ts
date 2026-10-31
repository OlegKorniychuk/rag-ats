import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { nanoid } from 'nanoid';
import { isUniqueViolation } from '../common/pg-errors.js';
import {
  APPLICATIONS_REPOSITORY,
  type ApplicationsRepository,
  type ApplicationWithCandidate,
} from '../db/repositories/applications.repository.js';
import {
  CANDIDATES_REPOSITORY,
  type CandidatesRepository,
} from '../db/repositories/candidates.repository.js';
import {
  SCORES_REPOSITORY,
  type ScoresRepository,
} from '../db/repositories/scores.repository.js';
import type { NewVacancy } from '../db/repositories/vacancies.repository.js';
import {
  VACANCIES_REPOSITORY,
  type Vacancy,
  type VacanciesRepository,
} from '../db/repositories/vacancies.repository.js';
import { APPLICATION_UNIQUE_CONSTRAINT } from '../db/schema.js';
import { JobsService } from '../jobs/jobs.service.js';
import type { CreateVacancyDto } from './dto/create-vacancy.dto.js';
import type { UpdateVacancyDto } from './dto/update-vacancy.dto.js';

@Injectable()
export class VacanciesService {
  private readonly logger = new Logger(VacanciesService.name);

  constructor(
    @Inject(VACANCIES_REPOSITORY)
    private readonly vacanciesRepository: VacanciesRepository,
    @Inject(APPLICATIONS_REPOSITORY)
    private readonly applicationsRepository: ApplicationsRepository,
    @Inject(CANDIDATES_REPOSITORY)
    private readonly candidatesRepository: CandidatesRepository,
    @Inject(SCORES_REPOSITORY)
    private readonly scoresRepository: ScoresRepository,
    private readonly jobs: JobsService,
  ) {}

  async create(recruiterId: string, dto: CreateVacancyDto): Promise<Vacancy> {
    return this.vacanciesRepository.create({
      recruiterId,
      title: dto.title,
      requirements: dto.requirements,
      applyToken: nanoid(),
    });
  }

  async update(
    recruiterId: string,
    vacancyId: string,
    dto: UpdateVacancyDto,
  ): Promise<Vacancy> {
    await this.getOwnedVacancy(recruiterId, vacancyId);

    const patch: Partial<NewVacancy> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.requirements !== undefined) patch.requirements = dto.requirements;
    if (dto.status !== undefined) patch.status = dto.status;

    return this.vacanciesRepository.update(vacancyId, patch);
  }

  async findAllMine(recruiterId: string): Promise<Vacancy[]> {
    return this.vacanciesRepository.findByRecruiterId(recruiterId);
  }

  async findOne(recruiterId: string, vacancyId: string): Promise<Vacancy> {
    return this.getOwnedVacancy(recruiterId, vacancyId);
  }

  async findApplications(
    recruiterId: string,
    vacancyId: string,
  ): Promise<ApplicationWithCandidate[]> {
    await this.getOwnedVacancy(recruiterId, vacancyId);
    return this.applicationsRepository.findByVacancyIdWithCandidate(vacancyId);
  }

  async addCandidate(
    recruiterId: string,
    vacancyId: string,
    candidateId: string,
  ): Promise<ApplicationWithCandidate> {
    let applicationId: string;
    try {
      applicationId = await this.createAddedApplication(
        recruiterId,
        vacancyId,
        candidateId,
      );
    } catch (error) {
      // a concurrent duplicate passed the check in createAddedApplication and
      // lost the race on the unique constraint: same answer as the check
      if (isUniqueViolation(error, APPLICATION_UNIQUE_CONSTRAINT)) {
        throw new ConflictException('Candidate is already on this vacancy');
      }
      throw error;
    }

    // After commit, so the worker sees the application. The application is
    // already saved, so an enqueue failure must not fail the request: the score
    // stays `pending` and the startup sweep (parsed candidates) re-enqueues it.
    // A candidate still being parsed gets scored by the parse completion.
    try {
      await this.jobs.enqueueScore(applicationId);
    } catch (error) {
      this.logger.error(
        `Failed to enqueue scoring for application ${applicationId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }

    const application =
      await this.applicationsRepository.findByIdWithCandidate(applicationId);
    if (!application) throw new NotFoundException('Application not found');
    return application;
  }

  @Transactional()
  private async createAddedApplication(
    recruiterId: string,
    vacancyId: string,
    candidateId: string,
  ): Promise<string> {
    const vacancy = await this.getOwnedVacancy(recruiterId, vacancyId);

    // the pool is shared, so any existing candidate can be added
    const candidate = await this.candidatesRepository.findById(candidateId);
    if (!candidate) {
      throw new NotFoundException('Candidate not found');
    }

    if (vacancy.status === 'closed') {
      throw new ConflictException('Vacancy is closed');
    }

    const existing =
      await this.applicationsRepository.findByVacancyAndCandidate(
        vacancyId,
        candidateId,
      );
    if (existing) {
      throw new ConflictException('Candidate is already on this vacancy');
    }

    // No CV comes in, so the candidate's parse status is left alone: the
    // score worker handles parsed and still-parsing candidates alike.
    const application = await this.applicationsRepository.create({
      vacancyId,
      candidateId,
      source: 'added',
    });
    await this.scoresRepository.createPending(application.id);

    return application.id;
  }

  private async getOwnedVacancy(
    recruiterId: string,
    vacancyId: string,
  ): Promise<Vacancy> {
    const vacancy = await this.vacanciesRepository.findById(vacancyId);

    // same 404 for "doesn't exist" and "exists but isn't yours" - don't let
    // a client distinguish which one it is
    if (!vacancy || vacancy.recruiterId !== recruiterId) {
      throw new NotFoundException('Vacancy not found');
    }

    return vacancy;
  }
}
