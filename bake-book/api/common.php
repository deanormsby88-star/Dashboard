<?php
/**
 * Bake Book — shared API bootstrap
 * Loaded by every endpoint. Handles sessions, config, PDO, auth,
 * CSRF protection and JSON helpers.
 */

// ---- Session (must run before any output) -------------------------
if (session_status() === PHP_SESSION_NONE) {
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_name('BAKEBOOK_SESSID');
    session_start();
}

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

// ---- Load configuration ------------------------------------------
$config_path = __DIR__ . '/../config.php';
if (!file_exists($config_path)) {
    http_response_code(500);
    echo json_encode(['error' => 'Missing config.php. Please create it from config.php.']);
    exit;
}
require_once $config_path;

/** Send a JSON response and stop. */
function json_response($data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data);
    exit;
}

/** Read and decode a JSON request body (returns array). */
function read_json_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) {
        return [];
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

/** Get a shared PDO connection using prepared-statement defaults. */
function get_db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }
    $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET;
    try {
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    } catch (PDOException $e) {
        json_response(['error' => 'Database connection failed. Check config.php.'], 500);
    }
    return $pdo;
}

/** True if a valid session exists. */
function is_authenticated(): bool
{
    return !empty($_SESSION['authenticated']) && $_SESSION['authenticated'] === true;
}

/** Require a session or bail with 401. */
function require_auth(): void
{
    if (!is_authenticated()) {
        json_response(['error' => 'Not authenticated'], 401);
    }
}

/** Return the current CSRF token, creating one if needed. */
function csrf_token(): string
{
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

/**
 * For mutating requests (POST/PUT/DELETE) verify the CSRF token sent
 * in the X-CSRF-Token header matches the session token.
 */
function require_csrf(): void
{
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if (in_array($method, ['POST', 'PUT', 'DELETE', 'PATCH'], true)) {
        $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        $have = $_SESSION['csrf_token'] ?? '';
        if ($have === '' || !hash_equals($have, (string) $sent)) {
            json_response(['error' => 'Invalid CSRF token'], 419);
        }
    }
}

/** The HTTP method for this request. */
function request_method(): string
{
    return $_SERVER['REQUEST_METHOD'] ?? 'GET';
}

/**
 * Rewrite a define('KEY', '...') string value inside config.php.
 * Used to persist the password hash and currency label.
 * Returns true on success.
 */
function update_config_value(string $key, string $value): bool
{
    $path = __DIR__ . '/../config.php';
    $contents = file_get_contents($path);
    if ($contents === false) {
        return false;
    }
    $escaped = str_replace("'", "\\'", $value);
    $pattern = "/define\\(\\s*'" . preg_quote($key, '/') . "'\\s*,\\s*'.*?'\\s*\\)\\s*;/s";
    // Use a callback so characters like $ and \ in the value (e.g. a bcrypt
    // hash "$2y$10$...") are NOT interpreted as regex backreferences.
    $new = preg_replace_callback($pattern, function () use ($key, $escaped) {
        return "define('" . $key . "', '" . $escaped . "');";
    }, $contents, 1, $count);
    if ($new === null || $count === 0) {
        return false;
    }
    return file_put_contents($path, $new) !== false;
}
