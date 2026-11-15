import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
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
  SCORES_REPOSITORY,
  type ScoresRepository,
} from '../db/repositories/scores.repository.js';
import {
  VACANCIES_REPOSITORY,
  type Vacancy,
  type VacanciesRepository,
} from '../db/repositories/vacancies.repository.js';
import {
  CV_DOCUMENTS_REPOSITORY,
  type CvDocumentsRepository,
} from '../db/repositories/cv-documents.repository.js';
import {
  CvTextExtractor,
  UnreadableCvError,
  isPdf,
} from '../cv/cv-text-extractor.js';
import { isUniqueViolation } from '../common/pg-errors.js';
import { APPLICATION_UNIQUE_CONSTRAINT } from '../db/schema.js';
import { JobsService } from '../jobs/jobs.service.js';
import type { SubmitApplicationDto } from './dto/submit-application.dto.js';

const DEFAULT_CV_FILENAME = 'cv.pdf';

interface ParsedCv {
  filename: string;
  content: Buffer;
  text: string;
}

// multer decodes the multipart filename as latin1; recover the UTF-8 original
function normalizeFilename(originalname: string): string {
  const decoded = Buffer.from(originalname, 'latin1').toString('utf8');
  const basename = decoded.split(/[\\/]/).pop()?.trim() ?? '';
  return basename || DEFAULT_CV_FILENAME;
}

export type PublicVacancy = Pick<Vacancy, 'title' | 'requirements' | 'status'>;

interface SavedApplication {
  candidateId: string;
  /**
   * The CV stored by this application, which still has to be parsed; null when
   * a repeat applicant's identical CV was reused and nothing needs parsing.
   */
  cvDocumentId: string | null;
  applicationId: string;
}

export interface SubmitApplicationResult {
  success: true;
}

@Injectable()
export class ApplyService {
  private readonly logger = new Logger(ApplyService.name);

  constructor(
    @Inject(VACANCIES_REPOSITORY)
    private readonly vacanciesRepository: VacanciesRepository,
    @Inject(CANDIDATES_REPOSITORY)
    private readonly candidatesRepository: CandidatesRepository,
    @Inject(APPLICATIONS_REPOSITORY)
    private readonly applicationsRepository: ApplicationsRepository,
    @Inject(CV_DOCUMENTS_REPOSITORY)
    private readonly cvDocumentsRepository: CvDocumentsRepository,
    @Inject(SCORES_REPOSITORY)
    private readonly scoresRepository: ScoresRepository,
    private readonly cvTextExtractor: CvTextExtractor,
    private readonly jobs: JobsService,
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

  async submit(
    token: string,
    dto: SubmitApplicationDto,
    file: Express.Multer.File | undefined,
  ): Promise<SubmitApplicationResult> {
    if (!file) {
      throw new BadRequestException('CV file is required');
    }
    if (!isPdf(file.buffer)) {
      throw new BadRequestException('CV must be a PDF file');
    }

    let text: string;
    try {
      text = await this.cvTextExtractor.extract(file.buffer);
    } catch (err) {
      if (err instanceof UnreadableCvError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    let saved: SavedApplication;
    try {
      saved = await this.saveApplication(token, dto, {
        filename: normalizeFilename(file.originalname),
        content: file.buffer,
        text,
      });
    } catch (error) {
      // a concurrent duplicate passed the check in saveApplication and lost
      // the race on the unique constraint: same answer as the check
      if (isUniqueViolation(error, APPLICATION_UNIQUE_CONSTRAINT)) {
        throw new ConflictException('Already applied to this vacancy');
      }
      throw error;
    }
    const { candidateId, cvDocumentId, applicationId } = saved;

    // Enqueue only after the transaction committed, so the worker can see the
    // CV. The application is already saved, so an enqueue failure must not fail
    // the request: the candidate stays `pending` and the startup sweep
    // re-enqueues it (a recruiter can also trigger a reparse). A reused CV
    // (cvDocumentId null) needs no parse.
    if (cvDocumentId !== null) {
      try {
        await this.jobs.enqueueParse(candidateId, cvDocumentId);
      } catch (error) {
        this.logger.error(
          `Failed to enqueue CV parsing for candidate ${candidateId}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }
    // When a parse was enqueued the candidate is `pending` again, so the score
    // job normally returns at once and the parse completion (which resets and
    // enqueues all of the candidate's scores) does the real work; this keeps
    // the job queued even if that is ever skipped. When the CV was reused the
    // candidate is already parsed and this job does the scoring. Same failure
    // handling as above: the `pending` score is recovered by the startup sweep.
    try {
      await this.jobs.enqueueScore(applicationId);
    } catch (error) {
      this.logger.error(
        `Failed to enqueue scoring for application ${applicationId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }

    return { success: true };
  }

  @Transactional()
  private async saveApplication(
    token: string,
    dto: SubmitApplicationDto,
    cv: ParsedCv,
  ): Promise<SavedApplication> {
    const vacancy = await this.vacanciesRepository.findByApplyToken(token);
    if (!vacancy) {
      throw new NotFoundException('Vacancy not found');
    }

    if (vacancy.status === 'closed') {
      throw new ConflictException('Vacancy is closed');
    }

    const contentSha256 = createHash('sha256').update(cv.content).digest('hex');
    const existing = await this.candidatesRepository.findByEmail(dto.email);

    // check for a duplicate application before touching the candidate, so a
    // rejected duplicate never mutates data
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
      ? await this.candidatesRepository.update(existing.id, {
          name: dto.name,
          ...(dto.githubUrl !== undefined && { githubUrl: dto.githubUrl }),
          ...(dto.portfolioUrl !== undefined && {
            portfolioUrl: dto.portfolioUrl,
          }),
        })
      : await this.candidatesRepository.create({
          name: dto.name,
          email: dto.email,
          githubUrl: dto.githubUrl,
          portfolioUrl: dto.portfolioUrl,
          skills: [],
          projects: [],
          experience: '',
          summary: '',
        });

    // A repeat applicant re-sending the identical CV with an unchanged GitHub
    // URL has nothing new to parse: keep the parsed profile and its CV, and
    // skip the paid LLM call (the new application is scored from it as is).
    const reuseCv =
      existing !== null &&
      existing.parseStatus === 'parsed' &&
      (dto.githubUrl === undefined || dto.githubUrl === existing.githubUrl) &&
      (await this.hasSameLatestCv(existing.id, contentSha256));

    const cvDocument = reuseCv
      ? null
      : await this.cvDocumentsRepository.create({
          candidateId: candidate.id,
          filename: cv.filename,
          sizeBytes: cv.content.length,
          content: cv.content,
          contentSha256,
          text: cv.text,
        });

    const application = await this.applicationsRepository.create({
      vacancyId: vacancy.id,
      candidateId: candidate.id,
      source: 'applied',
    });
    await this.scoresRepository.createPending(application.id);

    // Repeat applicants keep their old profile visible while the new CV is
    // re-parsed; new candidates are already pending.
    if (cvDocument) {
      await this.candidatesRepository.setParseStatus(candidate.id, 'pending');
    }

    return {
      candidateId: candidate.id,
      cvDocumentId: cvDocument?.id ?? null,
      applicationId: application.id,
    };
  }

  private async hasSameLatestCv(
    candidateId: string,
    contentSha256: string,
  ): Promise<boolean> {
    const latest =
      await this.cvDocumentsRepository.findLatestIdentityByCandidate(
        candidateId,
      );
    return latest?.contentSha256 === contentSha256;
  }
}
