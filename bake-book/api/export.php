<?php
/**
 * Nunu's Bakery — export endpoint
 * GET: dumps all tables as a downloadable JSON file.
 */
require_once __DIR__ . '/common.php';
require_auth();

if (request_method() !== 'GET') {
    json_response(['error' => 'Method not allowed'], 405);
}

$db = get_db();

$data = [
    'app'                => "Nunu's Bakery",
    'version'            => 1,
    'exported_at'        => date('c'),
    'ingredients'        => $db->query('SELECT * FROM ingredients ORDER BY id')->fetchAll(),
    'recipes'            => $db->query('SELECT * FROM recipes ORDER BY id')->fetchAll(),
    'recipe_ingredients' => $db->query('SELECT * FROM recipe_ingredients ORDER BY id')->fetchAll(),
    'suppliers'          => $db->query('SELECT * FROM suppliers ORDER BY id')->fetchAll(),
];

// Send as a file download rather than inline JSON.
header('Content-Type: application/json; charset=utf-8');
header('Content-Disposition: attachment; filename="bake-book-export-' . date('Y-m-d') . '.json"');
echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
exit;
