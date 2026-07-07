<?php
/**
 * Nunu's Bakery — Excel export
 * Produces a multi-sheet Excel workbook (SpreadsheetML 2003 format) that
 * opens natively in Excel, Numbers and Google Sheets — no libraries needed.
 * Sheets: Stock, Recipes, Costing, Suppliers.
 * GET only; requires an active session.
 */
require_once __DIR__ . '/common.php';
require_auth();

if (request_method() !== 'GET') {
    json_response(['error' => 'Method not allowed'], 405);
}

$db  = get_db();
$cur = CURRENCY_LABEL;

/** XML-escape a cell value. */
function xml($s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES | ENT_XML1, 'UTF-8');
}

/** One worksheet cell. Numbers use the Number type so Excel treats them as numeric. */
function cell($value, string $type = 'String', ?string $styleId = null): string
{
    $style = $styleId ? ' ss:StyleID="' . $styleId . '"' : '';
    if ($type === 'Number') {
        $num = is_numeric($value) ? (0 + $value) : 0;
        return '<Cell' . $style . '><Data ss:Type="Number">' . $num . '</Data></Cell>';
    }
    return '<Cell' . $style . '><Data ss:Type="String">' . xml($value) . '</Data></Cell>';
}

/** A row from an array of pre-built <Cell> strings. */
function row(array $cells): string
{
    return '<Row>' . implode('', $cells) . '</Row>';
}

/** Convenience: header row of string cells with the bold style. */
function header_row(array $labels): string
{
    return row(array_map(fn($l) => cell($l, 'String', 'hdr'), $labels));
}

$unitBig   = fn($u) => $u === 'ml' ? 'L' : ($u === 'units' ? 'units' : 'kg');
$unitShort = fn($u) => $u === 'ml' ? 'ml' : ($u === 'units' ? 'units' : 'g');

// -------------------- Sheet 1: Stock --------------------
$stockRows = [header_row(['Name', 'Category', 'Brand', 'Store', 'Pack size', 'Unit', 'Price paid (' . $cur . ')', 'In stock', 'Cost per unit (' . $cur . ')', 'Cost per kg/L (' . $cur . ')'])];
foreach ($db->query('SELECT * FROM ingredients ORDER BY category, name')->fetchAll() as $r) {
    $pack = (float) $r['pack_size'];
    $per  = $pack > 0 ? (float) $r['price_paid'] / $pack : 0;
    $per1000 = $r['pack_unit'] === 'units' ? null : $per * 1000;
    $stockRows[] = row([
        cell($r['name']),
        cell(ucfirst($r['category'])),
        cell($r['brand']),
        cell($r['store']),
        cell($r['pack_size'], 'Number'),
        cell($unitShort($r['pack_unit'])),
        cell($r['price_paid'], 'Number'),
        cell($r['quantity_in_stock'], 'Number'),
        cell(round($per, 4), 'Number'),
        $per1000 === null ? cell('—') : cell(round($per1000, 4), 'Number'),
    ]);
}

// -------------------- Recipes & Costing --------------------
$ingById = [];
foreach ($db->query('SELECT * FROM ingredients')->fetchAll() as $i) {
    $ingById[(int) $i['id']] = $i;
}

$recipeRows  = [header_row(['Recipe', 'Mode', 'Qty', 'Unit label', 'Total cost (' . $cur . ')', 'Cost each (' . $cur . ')', 'Batch total (' . $cur . ')'])];
$costingRows = [];

foreach ($db->query('SELECT * FROM recipes ORDER BY name')->fetchAll() as $rec) {
    $lines = $db->prepare('SELECT * FROM recipe_ingredients WHERE recipe_id = ? ORDER BY id');
    $lines->execute([$rec['id']]);
    $lines = $lines->fetchAll();

    $total = 0.0;
    $lineData = [];
    foreach ($lines as $l) {
        $ing  = $ingById[(int) $l['ingredient_id']] ?? null;
        $cost = 0.0;
        if ($ing && (float) $ing['pack_size'] > 0) {
            $cost = ((float) $ing['price_paid'] / (float) $ing['pack_size']) * (float) $l['quantity_used'];
        }
        $total += $cost;
        $lineData[] = [
            'name' => $ing ? $ing['name'] : '(not in stock)',
            'qty'  => (float) $l['quantity_used'],
            'unit' => $unitShort($l['unit']),
            'cost' => round($cost, 4),
        ];
    }

    $qty  = $rec['yield_quantity'] !== null ? (float) $rec['yield_quantity'] : null;
    $mode = ($rec['yield_mode'] ?? 'divide') === 'multiply' ? 'multiply' : 'divide';
    if ($mode === 'multiply') {
        $each  = round($total, 4);
        $batch = ($qty && $qty > 0) ? round($total * $qty, 4) : round($total, 4);
    } else {
        $each  = ($qty && $qty > 0) ? round($total / $qty, 4) : null;
        $batch = round($total, 4);
    }

    $recipeRows[] = row([
        cell($rec['name']),
        cell($mode === 'multiply' ? 'Makes 1, scale up' : 'Yields many'),
        $qty === null ? cell('—') : cell($qty, 'Number'),
        cell($rec['yield_text']),
        cell(round($total, 4), 'Number'),
        $each === null ? cell('—') : cell($each, 'Number'),
        cell($batch, 'Number'),
    ]);

    // Costing sheet block for this recipe
    $costingRows[] = row([cell($rec['name'], 'String', 'hdr')]);
    $costingRows[] = header_row(['Ingredient', 'Quantity', 'Unit', 'Cost (' . $cur . ')']);
    foreach ($lineData as $ld) {
        $costingRows[] = row([cell($ld['name']), cell($ld['qty'], 'Number'), cell($ld['unit']), cell($ld['cost'], 'Number')]);
    }
    $costingRows[] = row([cell('Total', 'String', 'hdr'), cell(''), cell(''), cell(round($total, 4), 'Number', 'hdr')]);
    if ($each !== null) {
        $costingRows[] = row([cell('Cost each'), cell(''), cell(''), cell($each, 'Number')]);
    }
    $costingRows[] = row([cell('')]); // spacer
}
if (!$costingRows) {
    $costingRows[] = row([cell('No recipes yet.')]);
}

// -------------------- Suppliers --------------------
$supRows = [header_row(['Name', 'Company', 'Phone', 'Email', 'Website', 'Notes'])];
foreach ($db->query('SELECT * FROM suppliers ORDER BY name')->fetchAll() as $s) {
    $supRows[] = row([cell($s['name']), cell($s['company']), cell($s['phone']), cell($s['email']), cell($s['website']), cell($s['notes'])]);
}

// -------------------- Assemble workbook --------------------
function worksheet(string $name, array $rows): string
{
    return '<Worksheet ss:Name="' . xml($name) . '"><Table>' . implode('', $rows) . '</Table></Worksheet>';
}

$filename = 'nunus-bakery-' . date('Y-m-d') . '.xls';
header('Content-Type: application/vnd.ms-excel; charset=utf-8');
header('Content-Disposition: attachment; filename="' . $filename . '"');

echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
echo '<?mso-application progid="Excel.Sheet"?>' . "\n";
echo '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"'
   . ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">';
echo '<Styles><Style ss:ID="hdr"><Font ss:Bold="1"/></Style></Styles>';
echo worksheet('Stock', $stockRows);
echo worksheet('Recipes', $recipeRows);
echo worksheet('Costing', $costingRows);
echo worksheet('Suppliers', $supRows);
echo '</Workbook>';
exit;
