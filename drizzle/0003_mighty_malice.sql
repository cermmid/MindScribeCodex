CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`email` text NOT NULL,
	`visit_id` text NOT NULL,
	`original` text NOT NULL,
	`original_kind` text NOT NULL,
	`corrected` text NOT NULL,
	`comment` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `feedback_owner_visit` ON `feedback` (`owner_id`,`visit_id`);--> statement-breakpoint
CREATE INDEX `feedback_created` ON `feedback` (`created_at`);--> statement-breakpoint
ALTER TABLE `visits` ADD `original_note` text;