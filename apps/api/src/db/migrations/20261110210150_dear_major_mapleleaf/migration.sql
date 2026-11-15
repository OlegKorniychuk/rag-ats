ALTER TABLE "cv_documents" ADD COLUMN "content_sha256" text;
--> statement-breakpoint
UPDATE "cv_documents" SET "content_sha256" = encode(sha256("content"), 'hex') WHERE "content_sha256" IS NULL;
