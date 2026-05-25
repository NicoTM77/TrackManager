CREATE TABLE `audio_tracks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_item_id` integer NOT NULL,
	`track_index` integer NOT NULL,
	`language` text,
	`format` text NOT NULL,
	`channels` integer,
	`bitrate` integer,
	`is_default` integer DEFAULT false NOT NULL,
	`is_forced` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `audit_results` (
	`media_item_id` integer NOT NULL,
	`rule_id` integer NOT NULL,
	`passed` integer NOT NULL,
	`error_message` text,
	`audited_at` integer NOT NULL,
	PRIMARY KEY(`media_item_id`, `rule_id`),
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `libraries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`type` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `libraries_path_unique` ON `libraries` (`path`);--> statement-breakpoint
CREATE TABLE `media_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`library_id` integer NOT NULL,
	`file_path` text NOT NULL,
	`file_name` text NOT NULL,
	`file_size` integer NOT NULL,
	`mtime_ms` integer NOT NULL,
	`status` text NOT NULL,
	`scanned_at` integer NOT NULL,
	`removed_at` integer,
	`title` text,
	`season` integer,
	`episode` integer,
	`container` text NOT NULL,
	`video_resolution` text,
	`video_bitrate` integer,
	`video_codec` text,
	`video_color_depth` integer,
	`video_hdr_format` text,
	`raw_metadata` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_items_file_path_unique` ON `media_items` (`file_path`);--> statement-breakpoint
CREATE TABLE `rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL,
	`target_type` text NOT NULL,
	`conditions` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subtitle_tracks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_item_id` integer NOT NULL,
	`track_index` integer NOT NULL,
	`language` text,
	`format` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`is_forced` integer DEFAULT false NOT NULL,
	`is_hearing_impaired` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
