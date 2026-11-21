CREATE TYPE "question_status" AS ENUM('pending', 'generating', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "interview_questions" (
	"application_id" uuid PRIMARY KEY,
	"status" "question_status" DEFAULT 'pending'::"question_status" NOT NULL,
	"error" text,
	"failure_details" jsonb,
	"result" jsonb,
	"cv_document_id" uuid,
	"criteria_hash" text,
	"score_scored_at" timestamp,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"generated_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interview_questions" ADD CONSTRAINT "interview_questions_application_id_applications_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "interview_questions" ADD CONSTRAINT "interview_questions_cv_document_id_cv_documents_id_fkey" FOREIGN KEY ("cv_document_id") REFERENCES "cv_documents"("id");