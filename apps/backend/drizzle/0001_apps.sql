CREATE TABLE `apps` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text,
	`name` text NOT NULL,
	`background` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `apps_path_unique` ON `apps` (`path`);
--> statement-breakpoint
-- 既存の登録記録から、同じアプリ名を1件にまとめて移す (id・背景は最新の登録のもの)
INSERT INTO `apps` (`id`, `name`, `background`, `created_at`, `updated_at`)
SELECT `id`, coalesce(json_extract(`background`, '$.title'), ''), `background`, max(`created_at`), max(`created_at`)
FROM `projects`
GROUP BY json_extract(`background`, '$.title');
