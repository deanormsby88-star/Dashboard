-- ============================================================
-- Nunu's Bakery — database setup
-- Run this ONCE in phpMyAdmin (Import tab) after creating your
-- database in cPanel. It creates the tables the app needs.
--
-- NOTE: Do NOT include a "CREATE DATABASE" line — on GoDaddy shared
-- hosting you create the database in cPanel first, then run this
-- script *inside* that database via phpMyAdmin.
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---- Stock: ingredients, packaging & consumables -----------
CREATE TABLE IF NOT EXISTS `ingredients` (
  `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`              VARCHAR(150)  NOT NULL,
  `brand`             VARCHAR(150)  DEFAULT NULL,
  `store`             VARCHAR(150)  DEFAULT NULL,
  `category`          ENUM('ingredient','packaging','consumable') NOT NULL DEFAULT 'ingredient',
  `pack_size`         DECIMAL(12,3) NOT NULL DEFAULT 0,
  `pack_unit`         ENUM('grams','ml','units') NOT NULL DEFAULT 'grams',
  `price_paid`        DECIMAL(12,2) NOT NULL DEFAULT 0,
  `quantity_in_stock` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `created_at`        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ingredients_name` (`name`),
  KEY `idx_ingredients_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- Recipes -----------------------------------------------
CREATE TABLE IF NOT EXISTS `recipes` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`           VARCHAR(150)  NOT NULL,
  `yield_text`     VARCHAR(150)  DEFAULT NULL,        -- unit label, e.g. "muffins", "cake"
  `yield_quantity` DECIMAL(12,3) DEFAULT NULL,        -- number yielded, or number to make
  `yield_mode`     ENUM('divide','multiply') NOT NULL DEFAULT 'divide',
  `created_at`     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_recipes_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- Recipe lines (join table) -----------------------------
CREATE TABLE IF NOT EXISTS `recipe_ingredients` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `recipe_id`     INT UNSIGNED NOT NULL,
  `ingredient_id` INT UNSIGNED DEFAULT NULL,
  `quantity_used` DECIMAL(12,3) NOT NULL DEFAULT 0,
  `unit`          ENUM('grams','ml','units') NOT NULL DEFAULT 'grams',
  PRIMARY KEY (`id`),
  KEY `idx_ri_recipe` (`recipe_id`),
  KEY `idx_ri_ingredient` (`ingredient_id`),
  CONSTRAINT `fk_ri_recipe`
    FOREIGN KEY (`recipe_id`) REFERENCES `recipes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ri_ingredient`
    FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- Suppliers (contacts) ----------------------------------
CREATE TABLE IF NOT EXISTS `suppliers` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`       VARCHAR(150) NOT NULL,
  `company`    VARCHAR(150) DEFAULT NULL,
  `phone`      VARCHAR(60)  DEFAULT NULL,
  `email`      VARCHAR(150) DEFAULT NULL,
  `website`    VARCHAR(200) DEFAULT NULL,
  `notes`      TEXT         DEFAULT NULL,
  `created_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_suppliers_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- UPGRADING an existing install? If your database was created
-- with an earlier version, run these once (ignore "duplicate
-- column" errors for any that already exist):
--
-- ALTER TABLE `ingredients` ADD COLUMN `store` VARCHAR(150) NULL AFTER `brand`;
-- ALTER TABLE `ingredients` ADD COLUMN `category` ENUM('ingredient','packaging','consumable') NOT NULL DEFAULT 'ingredient' AFTER `store`;
-- ALTER TABLE `ingredients` MODIFY `pack_unit` ENUM('grams','ml','units') NOT NULL DEFAULT 'grams';
-- ALTER TABLE `ingredients` DROP COLUMN `date_purchased`;
-- ALTER TABLE `recipes` ADD COLUMN `yield_mode` ENUM('divide','multiply') NOT NULL DEFAULT 'divide';
-- ALTER TABLE `recipe_ingredients` MODIFY `unit` ENUM('grams','ml','units') NOT NULL DEFAULT 'grams';
-- (plus the CREATE TABLE `suppliers` block above)
-- ============================================================
