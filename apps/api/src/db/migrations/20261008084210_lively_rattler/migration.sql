CREATE TABLE "cv_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"candidate_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content" bytea NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "cv_documents_candidate_id_idx" ON "cv_documents" ("candidate_id");--> statement-breakpoint
ALTER TABLE "cv_documents" ADD CONSTRAINT "cv_documents_candidate_id_candidates_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id");