CREATE TYPE "score_status" AS ENUM('pending', 'scoring', 'scored', 'failed');--> statement-breakpoint
CREATE TABLE "application_scores" (
	"application_id" uuid PRIMARY KEY,
	"status" "score_status" DEFAULT 'pending'::"score_status" NOT NULL,
	"error" text,
	"result" jsonb,
	"cv_document_id" uuid,
	"criteria_hash" text,
	"model" text,
	"mode" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"scored_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vacancies" ADD COLUMN "criteria" jsonb;--> statement-breakpoint
ALTER TABLE "vacancies" ADD COLUMN "criteria_hash" text;--> statement-breakpoint
ALTER TABLE "application_scores" ADD CONSTRAINT "application_scores_application_id_applications_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "application_scores" ADD CONSTRAINT "application_scores_cv_document_id_cv_documents_id_fkey" FOREIGN KEY ("cv_document_id") REFERENCES "cv_documents"("id");--> statement-breakpoint
INSERT INTO "application_scores" ("application_id") SELECT "id" FROM "applications" ON CONFLICT DO NOTHING;