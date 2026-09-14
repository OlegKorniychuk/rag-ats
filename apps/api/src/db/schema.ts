import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
} from 'drizzle-orm/pg-core';

export const vacancyStatusEnum = pgEnum('vacancy_status', ['open', 'closed']);
export const applicationStageEnum = pgEnum('application_stage', [
  'applied',
  'screened',
  'interview',
  'rejected',
  'hired',
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
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const applications = pgTable('applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  vacancyId: uuid('vacancy_id')
    .notNull()
    .references(() => vacancies.id),
  candidateId: uuid('candidate_id')
    .notNull()
    .references(() => candidates.id),
  stage: applicationStageEnum('stage').notNull().default('applied'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
