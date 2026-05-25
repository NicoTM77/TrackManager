CREATE TABLE `series_metadata` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`library_id` integer NOT NULL,
	`series_path` text NOT NULL,
	`series_name` text NOT NULL,
	`type` text DEFAULT 'tv' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `series_metadata_series_path_unique` ON `series_metadata` (`series_path`);--> statement-breakpoint
ALTER TABLE `libraries` ADD `refresh_interval` integer DEFAULT 3600;--> statement-breakpoint
ALTER TABLE `libraries` ADD `is_auto_refresh_enabled` integer DEFAULT false NOT NULL;