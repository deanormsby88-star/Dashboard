<?php
/**
 * Nunu's Bakery — Configuration
 * ------------------------------------------------------------------
 * Fill in your MySQL database details below. You get these from your
 * GoDaddy cPanel when you create a database (see README.md).
 *
 * The APP_PASSWORD_HASH line is written automatically the first time
 * you run set_password.php in your browser — you do NOT edit it by hand.
 * ------------------------------------------------------------------
 */

// ---- Database connection -----------------------------------------
// On most GoDaddy cPanel shared plans the host is 'localhost'.
define('DB_HOST', 'localhost');
define('DB_NAME', 'your_database_name');
define('DB_USER', 'your_database_user');
define('DB_PASS', 'your_database_password');
define('DB_CHARSET', 'utf8mb4');

// ---- Application password -----------------------------------------
// Leave this EMPTY. Running set_password.php will fill it in for you
// with a secure bcrypt hash. Never store the plain password here.
define('APP_PASSWORD_HASH', '');

// ---- Display currency label ---------------------------------------
// Default South African Rand. Can be changed in Settings.
define('CURRENCY_LABEL', 'R');
