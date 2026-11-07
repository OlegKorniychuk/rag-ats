CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "candidate_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"candidate_id" uuid NOT NULL,
	"cv_document_id" uuid NOT NULL,
	"source" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_chunks_source_check" CHECK ("source" in ('cv', 'github'))
);
--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "embedded_cv_document_id" uuid;--> statement-breakpoint
CREATE INDEX "candidate_chunks_candidate_id_idx" ON "candidate_chunks" ("candidate_id");--> statement-breakpoint
ALTER TABLE "candidate_chunks" ADD CONSTRAINT "candidate_chunks_candidate_id_candidates_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "candidate_chunks" ADD CONSTRAINT "candidate_chunks_cv_document_id_cv_documents_id_fkey" FOREIGN KEY ("cv_document_id") REFERENCES "cv_documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_embedded_cv_document_id_cv_documents_id_fkey" FOREIGN KEY ("embedded_cv_document_id") REFERENCES "cv_documents"("id") ON DELETE SET NULL;