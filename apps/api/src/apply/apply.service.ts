import {
  BadRequestException,
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
import {
  CV_DOCUMENTS_REPOSITORY,
  type CvDocumentsRepository,
} from '../db/repositories/cv-documents.repository.js';
import {
  CvTextExtractor,
  UnreadableCvError,
  isPdf,
} from '../cv/cv-text-extractor.js';
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
    @Inject(CV_DOCUMENTS_REPOSITORY)
    private readonly cvDocumentsRepository: CvDocumentsRepository,
    private readonly cvTextExtractor: CvTextExtractor,
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

    return this.saveApplication(token, dto, {
      filename: normalizeFilename(file.originalname),
      content: file.buffer,
      text,
    });
  }

  @Transactional()
  private async saveApplication(
    token: string,
    dto: SubmitApplicationDto,
    cv: ParsedCv,
  ): Promise<SubmitApplicationResult> {
    const vacancy = await this.vacanciesRepository.findByApplyToken(token);
    if (!vacancy) {
      throw new NotFoundException('Vacancy not found');
    }

    if (vacancy.status === 'closed') {
      throw new ConflictException('Vacancy is closed');
    }

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

    await this.cvDocumentsRepository.create({
      candidateId: candidate.id,
      filename: cv.filename,
      sizeBytes: cv.content.length,
      content: cv.content,
      text: cv.text,
    });

    await this.applicationsRepository.create({
      vacancyId: vacancy.id,
      candidateId: candidate.id,
    });

    return { success: true };
  }
}
