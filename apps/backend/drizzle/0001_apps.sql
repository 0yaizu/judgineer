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
SELECT `id`, coalesce(json_extract(`background`, '$.title'), ''), `background`, `created_at`, `created_at`
FROM (
	SELECT *, row_number() OVER (PARTITION BY json_extract(`background`, '$.title') ORDER BY `created_at` DESC) AS `rn`
	FROM `projects`
)
WHERE `rn` = 1;
