-- Add resume_worker_url column to the settings table
ALTER TABLE "public"."settings" ADD COLUMN IF NOT EXISTS "resume_worker_url" TEXT;
