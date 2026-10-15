CREATE TABLE `test_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`stage` text NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`elapsed_ms` integer,
	`duration_ms` integer,
	`error_code` integer
);
--> statement-breakpoint
CREATE INDEX `test_events_user_started` ON `test_events` (`user_id`,`started_at`);