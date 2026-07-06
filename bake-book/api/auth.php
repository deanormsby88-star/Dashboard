<?php
/**
 * Bake Book — authentication endpoint
 * POST actions: login, logout, change_password, set_currency
 * GET: status (safe, no CSRF required)
 */
require_once __DIR__ . '/common.php';

$method = request_method();

// -------- Status: used by the app on load to bootstrap ------------
if ($method === 'GET') {
    json_response([
        'authenticated' => is_authenticated(),
        'csrf_token'    => is_authenticated() ? csrf_token() : null,
        'currency'      => CURRENCY_LABEL,
        'password_set'  => APP_PASSWORD_HASH !== '',
    ]);
}

if ($method !== 'POST') {
    json_response(['error' => 'Method not allowed'], 405);
}

$body   = read_json_body();
$action = $body['action'] ?? '';

// -------- Login ---------------------------------------------------
if ($action === 'login') {
    if (APP_PASSWORD_HASH === '') {
        json_response(['error' => 'No password has been set. Run set_password.php first.'], 500);
    }
    $password = (string) ($body['password'] ?? '');
    if (!password_verify($password, APP_PASSWORD_HASH)) {
        // small delay to slow brute-force attempts
        usleep(400000);
        json_response(['error' => 'Incorrect password'], 401);
    }
    session_regenerate_id(true);
    $_SESSION['authenticated'] = true;
    json_response([
        'ok'         => true,
        'csrf_token' => csrf_token(),
        'currency'   => CURRENCY_LABEL,
    ]);
}

// -------- Logout --------------------------------------------------
if ($action === 'logout') {
    require_csrf();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
    }
    session_destroy();
    json_response(['ok' => true]);
}

// Remaining actions require an active session + CSRF token.
require_auth();
require_csrf();

// -------- Change password -----------------------------------------
if ($action === 'change_password') {
    $current = (string) ($body['current_password'] ?? '');
    $new     = (string) ($body['new_password'] ?? '');

    if (!password_verify($current, APP_PASSWORD_HASH)) {
        json_response(['error' => 'Current password is incorrect'], 401);
    }
    if (strlen($new) < 6) {
        json_response(['error' => 'New password must be at least 6 characters'], 422);
    }
    $hash = password_hash($new, PASSWORD_BCRYPT);
    if (!update_config_value('APP_PASSWORD_HASH', $hash)) {
        json_response(['error' => 'Could not write to config.php. Check file permissions.'], 500);
    }
    json_response(['ok' => true]);
}

// -------- Set currency label --------------------------------------
if ($action === 'set_currency') {
    $currency = trim((string) ($body['currency'] ?? ''));
    if ($currency === '' || mb_strlen($currency) > 5) {
        json_response(['error' => 'Currency label must be 1–5 characters'], 422);
    }
    if (!update_config_value('CURRENCY_LABEL', $currency)) {
        json_response(['error' => 'Could not write to config.php. Check file permissions.'], 500);
    }
    json_response(['ok' => true, 'currency' => $currency]);
}

json_response(['error' => 'Unknown action'], 400);
