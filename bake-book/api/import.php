<?php
/**
 * Nunu's Bakery — import / clear endpoint
 * POST { action: 'import', data: {...} }  overwrite all data from a backup
 * POST { action: 'clear' }                wipe all data
 */
require_once __DIR__ . '/common.php';
require_auth();
require_csrf();

if (request_method() !== 'POST') {
    json_response(['error' => 'Method not allowed'], 405);
}

$db     = get_db();
$body   = read_json_body();
$action = $body['action'] ?? 'import';

/** Empty every table (children first for FK safety). */
function wipe_all(PDO $db): void
{
    $db->exec('DELETE FROM recipe_ingredients');
    $db->exec('DELETE FROM recipes');
    $db->exec('DELETE FROM ingredients');
}

if ($action === 'clear') {
    $db->beginTransaction();
    wipe_all($db);
    $db->commit();
    json_response(['ok' => true, 'cleared' => true]);
}

if ($action === 'import') {
    $data = $body['data'] ?? null;
    if (!is_array($data) || !isset($data['ingredients'], $data['recipes'], $data['recipe_ingredients'])) {
        json_response(['error' => 'Invalid backup file. Expected ingredients, recipes and recipe_ingredients.'], 422);
    }

    $db->beginTransaction();
    try {
        wipe_all($db);

        $insIng = $db->prepare(
            'INSERT INTO ingredients
              (id, name, brand, pack_size, pack_unit, price_paid, date_purchased, quantity_in_stock, created_at, updated_at)
             VALUES (:id,:name,:brand,:pack_size,:pack_unit,:price_paid,:date_purchased,:qty,
                     COALESCE(:created_at, NOW()), COALESCE(:updated_at, NOW()))'
        );
        foreach ($data['ingredients'] as $r) {
            $insIng->execute([
                ':id'             => (int) ($r['id'] ?? 0) ?: null,
                ':name'           => (string) ($r['name'] ?? ''),
                ':brand'          => $r['brand'] ?? null,
                ':pack_size'      => (float) ($r['pack_size'] ?? 0),
                ':pack_unit'      => ($r['pack_unit'] ?? 'grams') === 'ml' ? 'ml' : 'grams',
                ':price_paid'     => (float) ($r['price_paid'] ?? 0),
                ':date_purchased' => $r['date_purchased'] ?? null,
                ':qty'            => (float) ($r['quantity_in_stock'] ?? 0),
                ':created_at'     => $r['created_at'] ?? null,
                ':updated_at'     => $r['updated_at'] ?? null,
            ]);
        }

        $insRec = $db->prepare(
            'INSERT INTO recipes (id, name, yield_text, yield_quantity, created_at, updated_at)
             VALUES (:id,:name,:yield_text,:yield_quantity, COALESCE(:created_at, NOW()), COALESCE(:updated_at, NOW()))'
        );
        foreach ($data['recipes'] as $r) {
            $insRec->execute([
                ':id'             => (int) ($r['id'] ?? 0) ?: null,
                ':name'           => (string) ($r['name'] ?? ''),
                ':yield_text'     => $r['yield_text'] ?? null,
                ':yield_quantity' => isset($r['yield_quantity']) && $r['yield_quantity'] !== '' ? (float) $r['yield_quantity'] : null,
                ':created_at'     => $r['created_at'] ?? null,
                ':updated_at'     => $r['updated_at'] ?? null,
            ]);
        }

        $insRi = $db->prepare(
            'INSERT INTO recipe_ingredients (id, recipe_id, ingredient_id, quantity_used, unit)
             VALUES (:id,:recipe_id,:ingredient_id,:quantity_used,:unit)'
        );
        foreach ($data['recipe_ingredients'] as $r) {
            $insRi->execute([
                ':id'            => (int) ($r['id'] ?? 0) ?: null,
                ':recipe_id'     => (int) ($r['recipe_id'] ?? 0),
                ':ingredient_id' => isset($r['ingredient_id']) && $r['ingredient_id'] !== '' && $r['ingredient_id'] !== null ? (int) $r['ingredient_id'] : null,
                ':quantity_used' => (float) ($r['quantity_used'] ?? 0),
                ':unit'          => ($r['unit'] ?? 'grams') === 'ml' ? 'ml' : 'grams',
            ]);
        }

        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        json_response(['error' => 'Import failed: ' . $e->getMessage()], 500);
    }

    json_response(['ok' => true, 'imported' => true]);
}

json_response(['error' => 'Unknown action'], 400);
