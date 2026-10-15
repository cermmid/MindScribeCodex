CREATE TABLE `visit_audio` (
	`id` text PRIMARY KEY NOT NULL,
	`visit_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`object_key` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`duration_ms` integer,
	`digest` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `visit_audio_owner_visit` ON `visit_audio` (`owner_id`,`visit_id`);