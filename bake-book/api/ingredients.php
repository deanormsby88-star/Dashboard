<?php
/**
 * Bake Book — ingredients (pantry) endpoint
 * GET    list all ingredients (with computed cost fields)
 * POST   create ingredient
 * PUT    update ingredient (id in body)
 * DELETE delete ingredient (id in query ?id= or body)
 */
require_once __DIR__ . '/common.php';
require_auth();
require_csrf();

$db     = get_db();
$method = request_method();

/** Attach computed per-unit cost fields to an ingredient row. */
function with_costs(array $row): array
{
    $pack  = (float) $row['pack_size'];
    $price = (float) $row['price_paid'];
    $per   = ($pack > 0) ? $price / $pack : 0.0;
    $row['cost_per_unit'] = round($per, 6);        // per gram or per ml
    $row['cost_per_500']  = round($per * 500, 4);
    $row['cost_per_1000'] = round($per * 1000, 4); // per kg or per litre
    return $row;
}

if ($method === 'GET') {
    $stmt = $db->query('SELECT * FROM ingredients ORDER BY name ASC');
    $rows = array_map('with_costs', $stmt->fetchAll());
    json_response(['ingredients' => $rows]);
}

if ($method === 'POST') {
    $b = read_json_body();

    $name  = trim((string) ($b['name'] ?? ''));
    $unit  = ($b['pack_unit'] ?? 'grams') === 'ml' ? 'ml' : 'grams';
    if ($name === '') {
        json_response(['error' => 'Ingredient name is required'], 422);
    }

    $stmt = $db->prepare(
        'INSERT INTO ingredients
          (name, brand, pack_size, pack_unit, price_paid, date_purchased, quantity_in_stock)
         VALUES (:name, :brand, :pack_size, :pack_unit, :price_paid, :date_purchased, :qty)'
    );
    $stmt->execute([
        ':name'           => $name,
        ':brand'          => trim((string) ($b['brand'] ?? '')) ?: null,
        ':pack_size'      => (float) ($b['pack_size'] ?? 0),
        ':pack_unit'      => $unit,
        ':price_paid'     => (float) ($b['price_paid'] ?? 0),
        ':date_purchased' => ($b['date_purchased'] ?? '') ?: null,
        ':qty'            => (float) ($b['quantity_in_stock'] ?? 0),
    ]);
    $id  = (int) $db->lastInsertId();
    $row = $db->prepare('SELECT * FROM ingredients WHERE id = ?');
    $row->execute([$id]);
    json_response(['ingredient' => with_costs($row->fetch())], 201);
}

if ($method === 'PUT') {
    $b  = read_json_body();
    $id = (int) ($b['id'] ?? 0);
    if ($id <= 0) {
        json_response(['error' => 'Valid id is required'], 422);
    }
    $name = trim((string) ($b['name'] ?? ''));
    if ($name === '') {
        json_response(['error' => 'Ingredient name is required'], 422);
    }
    $unit = ($b['pack_unit'] ?? 'grams') === 'ml' ? 'ml' : 'grams';

    $stmt = $db->prepare(
        'UPDATE ingredients SET
            name = :name, brand = :brand, pack_size = :pack_size,
            pack_unit = :pack_unit, price_paid = :price_paid,
            date_purchased = :date_purchased, quantity_in_stock = :qty
         WHERE id = :id'
    );
    $stmt->execute([
        ':name'           => $name,
        ':brand'          => trim((string) ($b['brand'] ?? '')) ?: null,
        ':pack_size'      => (float) ($b['pack_size'] ?? 0),
        ':pack_unit'      => $unit,
        ':price_paid'     => (float) ($b['price_paid'] ?? 0),
        ':date_purchased' => ($b['date_purchased'] ?? '') ?: null,
        ':qty'            => (float) ($b['quantity_in_stock'] ?? 0),
        ':id'             => $id,
    ]);
    $row = $db->prepare('SELECT * FROM ingredients WHERE id = ?');
    $row->execute([$id]);
    $found = $row->fetch();
    if (!$found) {
        json_response(['error' => 'Ingredient not found'], 404);
    }
    json_response(['ingredient' => with_costs($found)]);
}

if ($method === 'DELETE') {
    $b  = read_json_body();
    $id = (int) ($_GET['id'] ?? $b['id'] ?? 0);
    if ($id <= 0) {
        json_response(['error' => 'Valid id is required'], 422);
    }
    $stmt = $db->prepare('DELETE FROM ingredients WHERE id = ?');
    $stmt->execute([$id]);
    json_response(['ok' => true]);
}

json_response(['error' => 'Method not allowed'], 405);
