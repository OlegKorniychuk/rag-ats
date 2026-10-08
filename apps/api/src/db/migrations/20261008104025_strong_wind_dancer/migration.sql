CREATE TYPE "parse_status" AS ENUM('pending', 'parsing', 'parsed', 'failed');--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "parse_status" "parse_status" DEFAULT 'pending'::"parse_status" NOT NULL;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "parse_error" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "parsed_cv_document_id" uuid;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "parsed_at" timestamp;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_parsed_cv_document_id_cv_documents_id_fkey" FOREIGN KEY ("parsed_cv_document_id") REFERENCES "cv_documents"("id");