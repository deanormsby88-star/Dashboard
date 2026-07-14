<?php
/**
 * Nunu's Bakery — recipe_ingredients endpoint
 * Granular management of individual ingredient lines within a recipe.
 * (The recipes.php endpoint can also replace all lines at once; this
 *  endpoint operates on single rows.)
 *
 * GET    ?recipe_id=  list lines for a recipe
 * POST   add a single line
 * PUT    update a single line (id in body)
 * DELETE remove a single line (id in query or body)
 */
require_once __DIR__ . '/common.php';
require_auth();
require_csrf();

$db     = get_db();
$method = request_method();

if ($method === 'GET') {
    $recipeId = (int) ($_GET['recipe_id'] ?? 0);
    if ($recipeId <= 0) {
        json_response(['error' => 'recipe_id is required'], 422);
    }
    $stmt = $db->prepare(
        'SELECT ri.*, i.name AS ingredient_name
         FROM recipe_ingredients ri
         LEFT JOIN ingredients i ON i.id = ri.ingredient_id
         WHERE ri.recipe_id = ? ORDER BY ri.id ASC'
    );
    $stmt->execute([$recipeId]);
    json_response(['recipe_ingredients' => $stmt->fetchAll()]);
}

if ($method === 'POST') {
    $b        = read_json_body();
    $recipeId = (int) ($b['recipe_id'] ?? 0);
    if ($recipeId <= 0) {
        json_response(['error' => 'recipe_id is required'], 422);
    }
    $iid  = isset($b['ingredient_id']) && $b['ingredient_id'] !== '' ? (int) $b['ingredient_id'] : null;
    $unit = in_array($b['unit'] ?? 'grams', ['grams', 'ml', 'units'], true) ? $b['unit'] : 'grams';
    $stmt = $db->prepare(
        'INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity_used, unit)
         VALUES (?, ?, ?, ?)'
    );
    $stmt->execute([$recipeId, $iid, (float) ($b['quantity_used'] ?? 0), $unit]);
    json_response(['id' => (int) $db->lastInsertId()], 201);
}

if ($method === 'PUT') {
    $b  = read_json_body();
    $id = (int) ($b['id'] ?? 0);
    if ($id <= 0) {
        json_response(['error' => 'Valid id is required'], 422);
    }
    $iid  = isset($b['ingredient_id']) && $b['ingredient_id'] !== '' ? (int) $b['ingredient_id'] : null;
    $unit = in_array($b['unit'] ?? 'grams', ['grams', 'ml', 'units'], true) ? $b['unit'] : 'grams';
    $stmt = $db->prepare(
        'UPDATE recipe_ingredients SET ingredient_id = ?, quantity_used = ?, unit = ? WHERE id = ?'
    );
    $stmt->execute([$iid, (float) ($b['quantity_used'] ?? 0), $unit, $id]);
    json_response(['ok' => true]);
}

if ($method === 'DELETE') {
    $b  = read_json_body();
    $id = (int) ($_GET['id'] ?? $b['id'] ?? 0);
    if ($id <= 0) {
        json_response(['error' => 'Valid id is required'], 422);
    }
    $stmt = $db->prepare('DELETE FROM recipe_ingredients WHERE id = ?');
    $stmt->execute([$id]);
    json_response(['ok' => true]);
}

json_response(['error' => 'Method not allowed'], 405);
