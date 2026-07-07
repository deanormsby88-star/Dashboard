<?php
/**
 * Nunu's Bakery — stock (pantry) endpoint
 * Handles all stock items across categories: ingredient, packaging, consumable.
 * GET    list all items (with computed per-unit cost fields)
 * POST   create item
 * PUT    update item (id in body)
 * DELETE delete item (id in query ?id= or body)
 */
require_once __DIR__ . '/common.php';
require_auth();
require_csrf();

$db     = get_db();
$method = request_method();

const UNITS      = ['grams', 'ml', 'units'];
const CATEGORIES = ['ingredient', 'packaging', 'consumable'];

/** Normalise a submitted unit to an allowed value. */
function clean_unit($u): string
{
    return in_array($u, UNITS, true) ? $u : 'grams';
}
/** Normalise a submitted category to an allowed value. */
function clean_category($c): string
{
    return in_array($c, CATEGORIES, true) ? $c : 'ingredient';
}

/** Attach computed per-unit cost fields to a stock row. */
function with_costs(array $row): array
{
    $pack  = (float) $row['pack_size'];
    $price = (float) $row['price_paid'];
    $per   = ($pack > 0) ? $price / $pack : 0.0;
    $row['cost_per_unit'] = round($per, 6);        // per gram / ml / item
    $row['cost_per_1000'] = round($per * 1000, 4); // per kg / litre (n/a for 'units')
    return $row;
}

if ($method === 'GET') {
    $stmt = $db->query('SELECT * FROM ingredients ORDER BY name ASC');
    $rows = array_map('with_costs', $stmt->fetchAll());
    json_response(['ingredients' => $rows]);
}

if ($method === 'POST') {
    $b    = read_json_body();
    $name = trim((string) ($b['name'] ?? ''));
    if ($name === '') {
        json_response(['error' => 'Name is required'], 422);
    }

    $stmt = $db->prepare(
        'INSERT INTO ingredients
          (name, brand, store, category, pack_size, pack_unit, price_paid, quantity_in_stock)
         VALUES (:name, :brand, :store, :category, :pack_size, :pack_unit, :price_paid, :qty)'
    );
    $stmt->execute([
        ':name'      => $name,
        ':brand'     => trim((string) ($b['brand'] ?? '')) ?: null,
        ':store'     => trim((string) ($b['store'] ?? '')) ?: null,
        ':category'  => clean_category($b['category'] ?? 'ingredient'),
        ':pack_size' => (float) ($b['pack_size'] ?? 0),
        ':pack_unit' => clean_unit($b['pack_unit'] ?? 'grams'),
        ':price_paid'=> (float) ($b['price_paid'] ?? 0),
        ':qty'       => (float) ($b['quantity_in_stock'] ?? 0),
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
        json_response(['error' => 'Name is required'], 422);
    }

    $stmt = $db->prepare(
        'UPDATE ingredients SET
            name = :name, brand = :brand, store = :store, category = :category,
            pack_size = :pack_size, pack_unit = :pack_unit, price_paid = :price_paid,
            quantity_in_stock = :qty
         WHERE id = :id'
    );
    $stmt->execute([
        ':name'      => $name,
        ':brand'     => trim((string) ($b['brand'] ?? '')) ?: null,
        ':store'     => trim((string) ($b['store'] ?? '')) ?: null,
        ':category'  => clean_category($b['category'] ?? 'ingredient'),
        ':pack_size' => (float) ($b['pack_size'] ?? 0),
        ':pack_unit' => clean_unit($b['pack_unit'] ?? 'grams'),
        ':price_paid'=> (float) ($b['price_paid'] ?? 0),
        ':qty'       => (float) ($b['quantity_in_stock'] ?? 0),
        ':id'        => $id,
    ]);
    $row = $db->prepare('SELECT * FROM ingredients WHERE id = ?');
    $row->execute([$id]);
    $found = $row->fetch();
    if (!$found) {
        json_response(['error' => 'Item not found'], 404);
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
