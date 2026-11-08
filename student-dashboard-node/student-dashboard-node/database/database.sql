-- ============================================================
-- Student Management Dashboard - MySQL / MariaDB schema
-- Charset: utf8mb4  |  Engine: InnoDB
--
-- XAMPP / phpMyAdmin : import this file as-is (it creates the database).
-- Shared hosting     : create the database in your control panel, select it
--                      in phpMyAdmin, then import this file (delete the
--                      CREATE DATABASE / USE lines if your host does not
--                      allow them).
-- The first admin is created by install.php (never stored in this file).
-- The data at the bottom is the original project's sample data, now stored in MySQL.
-- ============================================================

CREATE DATABASE IF NOT EXISTS `student_dashboard`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `student_dashboard`;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `admins` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`      VARCHAR(50)  NOT NULL,
  `full_name`     VARCHAR(100) NOT NULL DEFAULT '',
  `password_hash` VARCHAR(255) NOT NULL,
  `created_at`    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_login_at` DATETIME     NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_admins_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `groups` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`       VARCHAR(100) NOT NULL,
  `created_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_groups_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `students` (
  `id`            INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  `student_code`  VARCHAR(20)      NULL DEFAULT NULL,
  `name`          VARCHAR(120)     NOT NULL,
  `password_hash` VARCHAR(255)     NOT NULL,
  `group_id`      INT UNSIGNED     NOT NULL,
  `score`         TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `avatar`        VARCHAR(16)      NOT NULL,
  `created_at`    TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_students_name` (`name`),
  UNIQUE KEY `uq_students_code` (`student_code`),
  KEY `idx_students_group` (`group_id`),
  KEY `idx_students_score` (`score`),
  CONSTRAINT `fk_students_group` FOREIGN KEY (`group_id`)
    REFERENCES `groups` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `login_logs` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role`       ENUM('admin','student') NOT NULL,
  `user_id`    INT UNSIGNED    NULL DEFAULT NULL,
  `username`   VARCHAR(120)    NOT NULL,
  `ip_address` VARCHAR(45)     NOT NULL,
  `user_agent` VARCHAR(255)    NULL DEFAULT NULL,
  `success`    TINYINT(1)      NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_logs_throttle` (`ip_address`, `role`, `success`, `created_at`),
  KEY `idx_logs_user` (`role`, `user_id`),
  KEY `idx_logs_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- SAMPLE DATA (the same 4 groups and 7 students as the original HTML dashboard)
-- Every sample student has the temporary password:  Student@2026
-- Delete these rows (or change the passwords from the dashboard) before going live.
-- INSERT IGNORE: re-importing never creates duplicates.
-- ============================================================
INSERT IGNORE INTO `groups` (`id`, `name`) VALUES
  (1, 'مجموعة أ'),
  (2, 'مجموعة ب'),
  (3, 'مجموعة ج'),
  (4, 'مجموعات التفوق');

INSERT IGNORE INTO `students` (`id`, `student_code`, `name`, `password_hash`, `group_id`, `score`, `avatar`) VALUES
  (1, 'STD-101', 'عمر خالد العتيبي',     '$2b$12$r0u/C.mC9MctKJDsKQ2dOeIDp.h1BXAUIxV/DcbBwmedJ8J93n37m', 1, 98, '👨‍🎓'),
  (2, 'STD-102', 'سارة أحمد الزهراني',   '$2b$12$r0u/C.mC9MctKJDsKQ2dOeIDp.h1BXAUIxV/DcbBwmedJ8J93n37m', 2, 94, '👩‍🎓'),
  (3, 'STD-103', 'يوسف محمود الدوسري',   '$2b$12$r0u/C.mC9MctKJDsKQ2dOeIDp.h1BXAUIxV/DcbBwmedJ8J93n37m', 1, 89, '👨‍💻'),
  (4, 'STD-104', 'فاطمة إبراهيم الشمري', '$2b$12$r0u/C.mC9MctKJDsKQ2dOeIDp.h1BXAUIxV/DcbBwmedJ8J93n37m', 4, 96, '👩‍🔬'),
  (5, 'STD-105', 'عبدالله محمد السعيد',  '$2b$12$r0u/C.mC9MctKJDsKQ2dOeIDp.h1BXAUIxV/DcbBwmedJ8J93n37m', 3, 78, '👦'),
  (6, 'STD-106', 'ريم علي المطيري',      '$2b$12$r0u/C.mC9MctKJDsKQ2dOeIDp.h1BXAUIxV/DcbBwmedJ8J93n37m', 2, 83, '👧'),
  (7, 'STD-107', 'حسان سعد القحطاني',    '$2b$12$r0u/C.mC9MctKJDsKQ2dOeIDp.h1BXAUIxV/DcbBwmedJ8J93n37m', 3, 65, '👨‍🎓');
