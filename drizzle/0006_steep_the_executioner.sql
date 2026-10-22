CREATE TABLE `client_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`email` text NOT NULL,
	`visit_id` text,
	`job_id` text,
	`received_at` integer NOT NULL,
	`details` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reports_owner_visit` ON `client_reports` (`owner_id`,`visit_id`,`received_at`);--> statement-breakpoint
CREATE TABLE `processing_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`visit_id` text NOT NULL,
	`event_id` text NOT NULL,
	`stage` text NOT NULL,
	`state` text NOT NULL,
	`audio_id` text,
	`input` text,
	`input_hash` text NOT NULL,
	`model` text NOT NULL,
	`provider_id` text,
	`result` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`diagnostics` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_owner_visit` ON `processing_jobs` (`owner_id`,`visit_id`);--> statement-breakpoint
CREATE TABLE `processing_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`at` integer NOT NULL,
	`phase` text NOT NULL,
	`details` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `steps_job` ON `processing_steps` (`job_id`,`at`);--> statement-breakpoint
