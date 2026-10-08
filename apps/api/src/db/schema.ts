import { defineRelations } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  unique,
  integer,
  bytea,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const vacancyStatusEnum = pgEnum('vacancy_status', ['open', 'closed']);
export const applicationStageEnum = pgEnum('application_stage', [
  'applied',
  'screened',
  'interview',
  'rejected',
  'hired',
]);

export const parseStatusEnum = pgEnum('parse_status', [
  'pending',
  'parsing',
  'parsed',
  'failed',
]);

export const recruiters = pgTable('recruiters', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const vacancies = pgTable('vacancies', {
  id: uuid('id').primaryKey().defaultRandom(),
  recruiterId: uuid('recruiter_id')
    .notNull()
    .references(() => recruiters.id),
  title: text('title').notNull(),
  requirements: text('requirements').notNull(),
  applyToken: text('apply_token').notNull().unique(),
  status: vacancyStatusEnum('status').notNull().default('open'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const candidates = pgTable('candidates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  githubUrl: text('github_url'),
  portfolioUrl: text('portfolio_url'),
  skills: text('skills').array().notNull(),
  experience: text('experience').notNull(),
  projects: text('projects').array().notNull(),
  summary: text('summary').notNull(),
  parseStatus: parseStatusEnum('parse_status').notNull().default('pending'),
  parseError: text('parse_error'),
  // the CV the current profile was parsed from (internal, never exposed)
  parsedCvDocumentId: uuid('parsed_cv_document_id').references(
    (): AnyPgColumn => cvDocuments.id,
  ),
  parsedAt: timestamp('parsed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const applications = pgTable(
  'applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vacancyId: uuid('vacancy_id')
      .notNull()
      .references(() => vacancies.id),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => candidates.id),
    stage: applicationStageEnum('stage').notNull().default('applied'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('applications_vacancy_id_candidate_id_unique').on(
      t.vacancyId,
      t.candidateId,
    ),
  ],
);

export const cvDocuments = pgTable(
  'cv_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => candidates.id),
    filename: text('filename').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    content: bytea('content').notNull(),
    text: text('text').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('cv_documents_candidate_id_idx').on(t.candidateId)],
);

const schema = {
  vacancyStatusEnum,
  applicationStageEnum,
  parseStatusEnum,
  recruiters,
  vacancies,
  candidates,
  applications,
  cvDocuments,
};

export const dbRelations = defineRelations(schema, (r) => ({
  applications: {
    candidate: r.one.candidates({
      from: r.applications.candidateId,
      to: r.candidates.id,
      optional: false,
    }),
    vacancy: r.one.vacancies({
      from: r.applications.vacancyId,
      to: r.vacancies.id,
      optional: false,
    }),
  },
  vacancies: {
    recruiter: r.one.recruiters({
      from: r.vacancies.recruiterId,
      to: r.recruiters.id,
      optional: false,
    }),
    applications: r.many.applications(),
  },
  candidates: {
    applications: r.many.applications(),
    cvDocuments: r.many.cvDocuments(),
  },
  cvDocuments: {
    candidate: r.one.candidates({
      from: r.cvDocuments.candidateId,
      to: r.candidates.id,
      optional: false,
    }),
  },
}));
