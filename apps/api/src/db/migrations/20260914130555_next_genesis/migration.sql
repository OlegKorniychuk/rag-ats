CREATE TYPE "application_stage" AS ENUM('applied', 'screened', 'interview', 'rejected', 'hired');--> statement-breakpoint
CREATE TYPE "vacancy_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"vacancy_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"stage" "application_stage" DEFAULT 'applied'::"application_stage" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"github_url" text,
	"portfolio_url" text,
	"skills" text[] NOT NULL,
	"experience" text NOT NULL,
	"projects" text[] NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruiters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"email" text NOT NULL UNIQUE,
	"password_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vacancies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"recruiter_id" uuid NOT NULL,
	"title" text NOT NULL,
	"requirements" text NOT NULL,
	"apply_token" text NOT NULL UNIQUE,
	"status" "vacancy_status" DEFAULT 'open'::"vacancy_status" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_vacancy_id_vacancies_id_fkey" FOREIGN KEY ("vacancy_id") REFERENCES "vacancies"("id");--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_candidate_id_candidates_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id");--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_recruiter_id_recruiters_id_fkey" FOREIGN KEY ("recruiter_id") REFERENCES "recruiters"("id");