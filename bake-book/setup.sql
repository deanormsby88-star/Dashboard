-- ============================================================
-- Nunu's Bakery — database setup
-- Run this ONCE in phpMyAdmin (Import tab) after creating your
-- database in cPanel. It creates the three tables the app needs.
--
-- NOTE: Do NOT include a "CREATE DATABASE" line — on GoDaddy shared
-- hosting you create the database in cPanel first, then run this
-- script *inside* that database via phpMyAdmin.
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---- Ingredients (pantry) ----------------------------------
CREATE TABLE IF NOT EXISTS `ingredients` (
  `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`              VARCHAR(150)  NOT NULL,
  `brand`             VARCHAR(150)  DEFAULT NULL,
  `pack_size`         DECIMAL(12,3) NOT NULL DEFAULT 0,
  `pack_unit`         ENUM('grams','ml') NOT NULL DEFAULT 'grams',
  `price_paid`        DECIMAL(12,2) NOT NULL DEFAULT 0,
  `date_purchased`    DATE          DEFAULT NULL,
  `quantity_in_stock` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `created_at`        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ingredients_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- Recipes -----------------------------------------------
CREATE TABLE IF NOT EXISTS `recipes` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`           VARCHAR(150)  NOT NULL,
  `yield_text`     VARCHAR(150)  DEFAULT NULL,
  `yield_quantity` DECIMAL(12,3) DEFAULT NULL,
  `created_at`     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_recipes_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- Recipe ingredients (join table) -----------------------
CREATE TABLE IF NOT EXISTS `recipe_ingredients` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `recipe_id`     INT UNSIGNED NOT NULL,
  `ingredient_id` INT UNSIGNED DEFAULT NULL,
  `quantity_used` DECIMAL(12,3) NOT NULL DEFAULT 0,
  `unit`          ENUM('grams','ml') NOT NULL DEFAULT 'grams',
  PRIMARY KEY (`id`),
  KEY `idx_ri_recipe` (`recipe_id`),
  KEY `idx_ri_ingredient` (`ingredient_id`),
  CONSTRAINT `fk_ri_recipe`
    FOREIGN KEY (`recipe_id`) REFERENCES `recipes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ri_ingredient`
    FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
