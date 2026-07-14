<?php
/**
 * Nunu's Bakery — recipes endpoint
 * GET    list recipes with ingredient lines + live cost calculations
 * POST   create recipe (optionally with an ingredients array)
 * PUT    update recipe (id in body; replaces ingredient lines if given)
 * DELETE delete recipe (cascades to recipe_ingredients)
 */
require_once __DIR__ . '/common.php';
require_auth();
require_csrf();

$db     = get_db();
$method = request_method();

/** Build the full computed representation of one recipe. */
function build_recipe(PDO $db, array $recipe): array
{
    $stmt = $db->prepare(
        'SELECT ri.id, ri.ingredient_id, ri.quantity_used, ri.unit,
                i.name AS ingredient_name, i.pack_size, i.pack_unit,
                i.price_paid
         FROM recipe_ingredients ri
         LEFT JOIN ingredients i ON i.id = ri.ingredient_id
         WHERE ri.recipe_id = ?
         ORDER BY ri.id ASC'
    );
    $stmt->execute([$recipe['id']]);

    $lines = [];
    $total = 0.0;
    foreach ($stmt->fetchAll() as $r) {
        $inPantry = $r['ingredient_name'] !== null;
        $contribution = 0.0;
        if ($inPantry && (float) $r['pack_size'] > 0) {
            $perUnit = (float) $r['price_paid'] / (float) $r['pack_size'];
            $contribution = $perUnit * (float) $r['quantity_used'];
        }
        $total += $contribution;
        $lines[] = [
            'id'              => (int) $r['id'],
            'ingredient_id'   => $r['ingredient_id'] !== null ? (int) $r['ingredient_id'] : null,
            'ingredient_name' => $r['ingredient_name'],
            'quantity_used'   => (float) $r['quantity_used'],
            'unit'            => $r['unit'],
            'in_pantry'       => $inPantry,
            'cost'            => round($contribution, 4),
        ];
    }

    $yieldQty = $recipe['yield_quantity'] !== null ? (float) $recipe['yield_quantity'] : null;
    $mode     = ($recipe['yield_mode'] ?? 'divide') === 'multiply' ? 'multiply' : 'divide';

    // divide:   the recipe makes `yieldQty` units → cost each = total / qty; batch = total.
    // multiply: the recipe makes one → cost each = total; batch of qty = total * qty.
    if ($mode === 'multiply') {
        $unitCost   = round($total, 4);
        $batchTotal = ($yieldQty && $yieldQty > 0) ? round($total * $yieldQty, 4) : round($total, 4);
    } else {
        $unitCost   = ($yieldQty && $yieldQty > 0) ? round($total / $yieldQty, 4) : null;
        $batchTotal = round($total, 4);
    }

    return [
        'id'             => (int) $recipe['id'],
        'name'           => $recipe['name'],
        'yield_text'     => $recipe['yield_text'],
        'yield_quantity' => $yieldQty,
        'yield_mode'     => $mode,
        'ingredients'    => $lines,
        'total_cost'     => round($total, 4),
        'unit_cost'      => $unitCost,
        'batch_total'    => $batchTotal,
        'updated_at'     => $recipe['updated_at'],
        'calculated_at'  => date('Y-m-d H:i:s'),
    ];
}

/** Replace all ingredient lines for a recipe inside the current transaction. */
function save_recipe_ingredients(PDO $db, int $recipeId, array $ingredients): void
{
    $del = $db->prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?');
    $del->execute([$recipeId]);

    $ins = $db->prepare(
        'INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity_used, unit)
         VALUES (:rid, :iid, :qty, :unit)'
    );
    foreach ($ingredients as $line) {
        $iid  = isset($line['ingredient_id']) && $line['ingredient_id'] !== '' && $line['ingredient_id'] !== null
                ? (int) $line['ingredient_id'] : null;
        $unit = in_array($line['unit'] ?? 'grams', ['grams', 'ml', 'units'], true) ? $line['unit'] : 'grams';
        $ins->execute([
            ':rid'  => $recipeId,
            ':iid'  => $iid,
            ':qty'  => (float) ($line['quantity_used'] ?? 0),
            ':unit' => $unit,
        ]);
    }
}

if ($method === 'GET') {
    $recipes = $db->query('SELECT * FROM recipes ORDER BY name ASC')->fetchAll();
    $out = array_map(fn($r) => build_recipe($db, $r), $recipes);
    json_response(['recipes' => $out]);
}

if ($method === 'POST') {
    $b    = read_json_body();
    $name = trim((string) ($b['name'] ?? ''));
    if ($name === '') {
        json_response(['error' => 'Recipe name is required'], 422);
    }
    $yieldText = trim((string) ($b['yield_text'] ?? ''));
    $yieldMode = ($b['yield_mode'] ?? 'divide') === 'multiply' ? 'multiply' : 'divide';
    $yieldQty  = isset($b['yield_quantity']) && $b['yield_quantity'] !== '' ? (float) $b['yield_quantity'] : null;

    $db->beginTransaction();
    $stmt = $db->prepare('INSERT INTO recipes (name, yield_text, yield_quantity, yield_mode) VALUES (?, ?, ?, ?)');
    $stmt->execute([$name, $yieldText ?: null, $yieldQty, $yieldMode]);
    $id = (int) $db->lastInsertId();
    if (isset($b['ingredients']) && is_array($b['ingredients'])) {
        save_recipe_ingredients($db, $id, $b['ingredients']);
    }
    $db->commit();

    $row = $db->prepare('SELECT * FROM recipes WHERE id = ?');
    $row->execute([$id]);
    json_response(['recipe' => build_recipe($db, $row->fetch())], 201);
}

if ($method === 'PUT') {
    $b  = read_json_body();
    $id = (int) ($b['id'] ?? 0);
    if ($id <= 0) {
        json_response(['error' => 'Valid id is required'], 422);
    }
    $name = trim((string) ($b['name'] ?? ''));
    if ($name === '') {
        json_response(['error' => 'Recipe name is required'], 422);
    }
    $yieldText = trim((string) ($b['yield_text'] ?? ''));
    $yieldMode = ($b['yield_mode'] ?? 'divide') === 'multiply' ? 'multiply' : 'divide';
    $yieldQty  = isset($b['yield_quantity']) && $b['yield_quantity'] !== '' ? (float) $b['yield_quantity'] : null;

    $db->beginTransaction();
    $stmt = $db->prepare('UPDATE recipes SET name = ?, yield_text = ?, yield_quantity = ?, yield_mode = ? WHERE id = ?');
    $stmt->execute([$name, $yieldText ?: null, $yieldQty, $yieldMode, $id]);
    if (isset($b['ingredients']) && is_array($b['ingredients'])) {
        save_recipe_ingredients($db, $id, $b['ingredients']);
    }
    $db->commit();

    $row = $db->prepare('SELECT * FROM recipes WHERE id = ?');
    $row->execute([$id]);
    $found = $row->fetch();
    if (!$found) {
        json_response(['error' => 'Recipe not found'], 404);
    }
    json_response(['recipe' => build_recipe($db, $found)]);
}

if ($method === 'DELETE') {
    $b  = read_json_body();
    $id = (int) ($_GET['id'] ?? $b['id'] ?? 0);
    if ($id <= 0) {
        json_response(['error' => 'Valid id is required'], 422);
    }
    // Remove child rows explicitly as well as relying on the FK cascade,
    // so no orphans remain even if FK enforcement is off on the host.
    $db->beginTransaction();
    $db->prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?')->execute([$id]);
    $db->prepare('DELETE FROM recipes WHERE id = ?')->execute([$id]);
    $db->commit();
    json_response(['ok' => true]);
}

json_response(['error' => 'Method not allowed'], 405);
