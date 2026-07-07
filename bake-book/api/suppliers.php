<?php
/**
 * Nunu's Bakery — suppliers (contacts) endpoint
 * A simple address book of supplier contacts.
 * GET    list all suppliers
 * POST   create supplier
 * PUT    update supplier (id in body)
 * DELETE delete supplier (id in query ?id= or body)
 */
require_once __DIR__ . '/common.php';
require_auth();
require_csrf();

$db     = get_db();
$method = request_method();

if ($method === 'GET') {
    $rows = $db->query('SELECT * FROM suppliers ORDER BY name ASC')->fetchAll();
    json_response(['suppliers' => $rows]);
}

if ($method === 'POST') {
    $b    = read_json_body();
    $name = trim((string) ($b['name'] ?? ''));
    if ($name === '') {
        json_response(['error' => 'Contact name is required'], 422);
    }
    $stmt = $db->prepare(
        'INSERT INTO suppliers (name, company, phone, email, website, notes)
         VALUES (:name, :company, :phone, :email, :website, :notes)'
    );
    $stmt->execute([
        ':name'    => $name,
        ':company' => trim((string) ($b['company'] ?? '')) ?: null,
        ':phone'   => trim((string) ($b['phone'] ?? '')) ?: null,
        ':email'   => trim((string) ($b['email'] ?? '')) ?: null,
        ':website' => trim((string) ($b['website'] ?? '')) ?: null,
        ':notes'   => trim((string) ($b['notes'] ?? '')) ?: null,
    ]);
    $id  = (int) $db->lastInsertId();
    $row = $db->prepare('SELECT * FROM suppliers WHERE id = ?');
    $row->execute([$id]);
    json_response(['supplier' => $row->fetch()], 201);
}

if ($method === 'PUT') {
    $b  = read_json_body();
    $id = (int) ($b['id'] ?? 0);
    if ($id <= 0) {
        json_response(['error' => 'Valid id is required'], 422);
    }
    $name = trim((string) ($b['name'] ?? ''));
    if ($name === '') {
        json_response(['error' => 'Contact name is required'], 422);
    }
    $stmt = $db->prepare(
        'UPDATE suppliers SET name = :name, company = :company, phone = :phone,
            email = :email, website = :website, notes = :notes WHERE id = :id'
    );
    $stmt->execute([
        ':name'    => $name,
        ':company' => trim((string) ($b['company'] ?? '')) ?: null,
        ':phone'   => trim((string) ($b['phone'] ?? '')) ?: null,
        ':email'   => trim((string) ($b['email'] ?? '')) ?: null,
        ':website' => trim((string) ($b['website'] ?? '')) ?: null,
        ':notes'   => trim((string) ($b['notes'] ?? '')) ?: null,
        ':id'      => $id,
    ]);
    $row = $db->prepare('SELECT * FROM suppliers WHERE id = ?');
    $row->execute([$id]);
    $found = $row->fetch();
    if (!$found) {
        json_response(['error' => 'Contact not found'], 404);
    }
    json_response(['supplier' => $found]);
}

if ($method === 'DELETE') {
    $b  = read_json_body();
    $id = (int) ($_GET['id'] ?? $b['id'] ?? 0);
    if ($id <= 0) {
        json_response(['error' => 'Valid id is required'], 422);
    }
    $db->prepare('DELETE FROM suppliers WHERE id = ?')->execute([$id]);
    json_response(['ok' => true]);
}

json_response(['error' => 'Method not allowed'], 405);
