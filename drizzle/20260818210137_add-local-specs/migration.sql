CREATE TABLE `specs` (
	`repository` text NOT NULL,
	`branch` text NOT NULL,
	`spec_path` text NOT NULL,
	`source_relative_path` text,
	CONSTRAINT `specs_pk` PRIMARY KEY(`repository`, `branch`)
);
