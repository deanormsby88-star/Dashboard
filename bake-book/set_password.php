<?php
/**
 * Nunu's Bakery — ONE-TIME password setup
 * ------------------------------------------------------------------
 * Open this file in your browser (e.g. https://yourdomain.com/set_password.php),
 * choose a password, submit — it writes a secure bcrypt hash into config.php.
 *
 *  >>> IMPORTANT: DELETE THIS FILE FROM YOUR SERVER AFTERWARDS. <<<
 *
 * Leaving it in place would let anyone reset your password.
 * ------------------------------------------------------------------
 */

$configPath = __DIR__ . '/config.php';
$message = '';
$success = false;

if (!file_exists($configPath)) {
    $message = 'config.php not found. Create it first (copy the sample and add your DB details).';
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $pw  = (string) ($_POST['password'] ?? '');
    $pw2 = (string) ($_POST['password_confirm'] ?? '');

    if (strlen($pw) < 6) {
        $message = 'Password must be at least 6 characters.';
    } elseif ($pw !== $pw2) {
        $message = 'The two passwords do not match.';
    } else {
        $hash     = password_hash($pw, PASSWORD_BCRYPT);
        $contents = file_get_contents($configPath);
        $escaped  = str_replace("'", "\\'", $hash);
        $pattern  = "/define\\(\\s*'APP_PASSWORD_HASH'\\s*,\\s*'.*?'\\s*\\)\\s*;/s";
        // Callback replacement: the bcrypt hash contains "$2y$10$" which would
        // otherwise be treated as regex backreferences and corrupt the value.
        $new = preg_replace_callback($pattern, function () use ($escaped) {
            return "define('APP_PASSWORD_HASH', '" . $escaped . "');";
        }, $contents, 1, $count);

        if ($count === 0 || $new === null) {
            $message = 'Could not find APP_PASSWORD_HASH in config.php. Make sure the line exists.';
        } elseif (file_put_contents($configPath, $new) === false) {
            $message = 'Could not write to config.php. Check the file permissions (try 644).';
        } else {
            $success = true;
            $message = 'Password set successfully! Now DELETE this file (set_password.php) from your server, then open the app.';
        }
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nunu's Bakery — Set Password</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Playfair+Display:wght@600;700&display=swap');
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: 'DM Sans', system-ui, sans-serif; color: #402A19;
    background: #F7F0E8;
    background-image: repeating-linear-gradient(#F7F0E8, #F7F0E8 31px, #E7DDCB 32px);
    padding: 24px;
  }
  .card {
    background: #FFFFFF; border: 1px solid #E7DDCB; border-radius: 18px;
    padding: 32px; max-width: 420px; width: 100%; text-align: center;
    box-shadow: 0 12px 40px rgba(59,42,26,0.10);
  }
  .logo { width: 132px; height: 132px; display: block; margin: 0 auto 8px; }
  h1 { font-family: 'Playfair Display', serif; margin: 0 0 4px; font-size: 26px; }
  p.sub { margin: 0 0 20px; color: #8a7a63; font-size: 14px; }
  form { text-align: left; }
  label { display: block; font-weight: 600; font-size: 14px; margin: 14px 0 6px; }
  input {
    width: 100%; padding: 12px 14px; border: 1px solid #C4A882; border-radius: 10px;
    font-family: inherit; font-size: 16px; background: #FFFDF9;
  }
  button {
    margin-top: 22px; width: 100%; padding: 13px; border: 0; border-radius: 10px;
    background: #C98E8E; color: #fff; font-family: inherit; font-weight: 600; font-size: 16px;
    cursor: pointer;
  }
  button:hover { background: #B27575; }
  .msg { margin-top: 18px; padding: 12px 14px; border-radius: 10px; font-size: 14px; text-align: left; }
  .msg.ok  { background: #F6E9E9; color: #8a4a4a; border: 1px solid #C98E8E; }
  .msg.err { background: #FBEEE3; color: #8a4b1f; border: 1px solid #E0A86A; }
  .warn { margin-top: 16px; font-size: 13px; color: #a33; font-weight: 600; }
</style>
</head>
<body>
  <div class="card">
    <img class="logo" src="assets/img/logo.png" alt="Nunu's Bakery">
    <h1>Nunu's Bakery</h1>
    <p class="sub">One-time password setup</p>

    <?php if ($message): ?>
      <div class="msg <?php echo $success ? 'ok' : 'err'; ?>"><?php echo htmlspecialchars($message); ?></div>
    <?php endif; ?>

    <?php if (!$success): ?>
    <form method="post" autocomplete="off">
      <label for="password">Choose a password</label>
      <input type="password" id="password" name="password" required minlength="6" placeholder="At least 6 characters">
      <label for="password_confirm">Confirm password</label>
      <input type="password" id="password_confirm" name="password_confirm" required minlength="6" placeholder="Type it again">
      <button type="submit">Set Password</button>
    </form>
    <p class="warn">After setting your password, delete this file from your server.</p>
    <?php endif; ?>
  </div>
</body>
</html>
