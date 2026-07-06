# 🥖 Bake Book

A warm, handcrafted **home baking cost tracker** for a single household. Track
what your pantry ingredients cost, work out the exact food cost of every recipe
(and the cost per muffin / loaf / slice), and do quick price checks while you
shop. Prices are in South African Rand (**R**) by default and everything works
beautifully on iPhone, iPad and desktop.

Built as a plain **PHP + MySQL + vanilla JavaScript** app — no Node.js, no
build step, no Composer. It's designed to drop straight onto a **GoDaddy cPanel
shared hosting** plan.

---

## What's in the box

```
bake-book/
├── index.html            The whole app (loads once, no page reloads)
├── config.php            ← you edit this: database details
├── set_password.php      ← run once in a browser, then DELETE it
├── setup.sql             ← run once in phpMyAdmin to create the tables
├── .htaccess             Basic hardening (blocks direct access to config/sql)
├── README.md             This file
├── assets/
│   ├── css/style.css     The notebook look & feel
│   └── js/app.js         All the app logic
└── api/                  The PHP REST API (returns JSON)
    ├── common.php        Shared: sessions, database, auth, CSRF
    ├── auth.php          Login / logout / change password / currency
    ├── ingredients.php   Pantry items
    ├── recipes.php       Recipes + live cost calculations
    ├── recipe_ingredients.php
    ├── export.php        Download all your data as JSON
    └── import.php        Restore from JSON / clear all data
```

---

## Features at a glance

- **Pantry** — add ingredients with brand, pack size (g or ml), price and stock.
  Each card auto-shows cost per g/ml, per 500, and per kg/L. Sort by name, most
  recent, or cheapest per kg. Low-stock warning when only 1 unit is left.
- **Recipes** — pick ingredients from your pantry, enter quantities, and see the
  total food cost, the cost per unit of yield, and a full breakdown table.
  Ingredients missing from the pantry are flagged in amber.
- **Cost Calculator** — a shopping-aisle tool: type a name, pack size and price
  and instantly see cost per g / 500 / kg. Nothing is saved unless you tap
  **Add to Pantry**. Works entirely offline in the browser.
- **Settings** — change the currency label, change your password, export/import
  your data as JSON, clear everything, and log out.
- **One shared password** for the whole household (no usernames).

---

# 📖 Deployment guide (GoDaddy cPanel — for non-techies)

Follow these steps in order. It takes about 15 minutes. You do **not** need to
know how to code.

## Step 1 — Create a MySQL database in cPanel

1. Log in to your GoDaddy account and open **cPanel** (Hosting → Manage → cPanel
   Admin).
2. In the **Databases** section, click **MySQL Databases**.
3. Under **Create New Database**, type a name (for example `bakebook`) and click
   **Create Database**. cPanel usually adds a prefix, so the full name becomes
   something like `cpanelusername_bakebook`. **Write the full name down.**
4. Scroll to **MySQL Users → Add New User**. Choose a username and a strong
   password. Click **Create User**. **Write both down.**
5. Scroll to **Add User To Database**. Select the user and the database you just
   made, click **Add**, then tick **ALL PRIVILEGES** and click **Make Changes**.

You now have four things — keep them handy:
- Database **host** (almost always `localhost` on GoDaddy)
- Database **name** (e.g. `cpanelusername_bakebook`)
- Database **user** (e.g. `cpanelusername_baker`)
- Database **password**

## Step 2 — Create the tables with `setup.sql` in phpMyAdmin

1. Back in cPanel, under **Databases**, click **phpMyAdmin**.
2. In the left-hand list, **click your database name** so it is selected
   (important — the script must run *inside* your database).
3. Click the **Import** tab at the top.
4. Click **Choose File** and select the `setup.sql` file from this project.
5. Leave all other options as they are and click **Import** (or **Go**).
6. You should see a green success message and three new tables appear on the
   left: `ingredients`, `recipes`, `recipe_ingredients`.

## Step 3 — Upload the app files

**Option A — File Manager (easiest):**

1. In cPanel, open **File Manager** (in the **Files** section).
2. Go to the folder where your website lives. For your **main domain** this is
   usually `public_html`. (To use a sub-folder like `public_html/bakebook`,
   create that folder and go into it — see Step 6.)
3. Click **Upload** and upload **all** the files and folders from this project
   (`index.html`, `config.php`, `set_password.php`, `setup.sql`, `.htaccess`,
   and the `assets` and `api` folders).
   - Tip: the simplest way is to zip the whole `bake-book` folder on your
     computer, upload the single `.zip`, then use File Manager's **Extract**
     option. Make sure the files end up directly in your target folder (not
     nested inside an extra `bake-book` folder).

**Option B — FTP:** connect with an FTP client (e.g. FileZilla) using your cPanel
FTP details and drag the files into `public_html` (or your chosen sub-folder).

> **Note about `.htaccess`:** it's a hidden file. In File Manager, click
> **Settings** (top right) and tick **Show Hidden Files (dotfiles)** so you can
> see and upload it. It's optional but recommended.

## Step 4 — Fill in your database details in `config.php`

1. In File Manager, click **`config.php`**, then click **Edit** (top toolbar).
2. Replace the placeholder values with the four things from Step 1:

   ```php
   define('DB_HOST', 'localhost');
   define('DB_NAME', 'cpanelusername_bakebook');
   define('DB_USER', 'cpanelusername_baker');
   define('DB_PASS', 'your_database_password');
   ```

3. Leave `APP_PASSWORD_HASH` **empty** — the next step fills it in for you.
4. Click **Save Changes**.

## Step 5 — Set your app password (then delete the setup file)

1. In your web browser, go to the `set_password.php` file on your site. For
   example:
   - Main domain: `https://yourdomain.com/set_password.php`
   - Sub-folder:  `https://yourdomain.com/bakebook/set_password.php`
2. Type your chosen household password twice and click **Set Password**.
   You'll see a green “Password set successfully” message.
3. **VERY IMPORTANT:** go back to cPanel **File Manager**, select
   `set_password.php`, and **Delete** it. Leaving it on the server would let
   anyone reset your password.

## Step 6 — Open the app (and point your domain if needed)

- If you uploaded to `public_html`, just visit **`https://yourdomain.com/`**.
- If you uploaded to a **sub-folder** (e.g. `public_html/bakebook`), visit
  **`https://yourdomain.com/bakebook/`**.

Enter your password on the welcome screen and start baking! 🧁

**Want it on its own web address (like `bakebook.yourdomain.com`)?**
In cPanel go to **Domains → Subdomains**, create a subdomain (e.g. `bakebook`),
and set its **Document Root** to the folder where you uploaded the files. Then
visit the subdomain directly.

---

## Using the app day to day

- **Add ingredients** in **Pantry** as you buy them. When a price changes, just
  **Edit** the ingredient — every recipe using it updates its cost automatically.
- **Build recipes** in **Recipes**. Enter the yield as free text like
  `12 muffins` or `1 loaf`; if it starts with a number, the app works out the
  cost **per unit** for you.
- Use the **Cost Calculator** tab while shopping to compare pack prices without
  saving anything.
- Back up regularly from **Settings → Export as JSON**. You can restore it later
  with **Import**.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| “Database connection failed. Check config.php.” | Re-check the four values in `config.php`. On GoDaddy the host is nearly always `localhost`. Make sure the user is added to the database with **ALL PRIVILEGES** (Step 1.5). |
| “No password has been set.” | You skipped Step 5. Re-upload `set_password.php`, run it, then delete it again. |
| Login says “Incorrect password.” | You may have set a different password. Re-upload `set_password.php`, set a new one, delete it. |
| Blank page or the app doesn't load | Make sure the `assets` and `api` folders uploaded fully, and that `index.html` is in the folder you're visiting. |
| Changing the password or currency fails | `config.php` must be writable by PHP. In File Manager, right-click `config.php` → **Change Permissions** and set it to **644**. |
| A recipe shows an amber “not in pantry” warning | That ingredient was deleted from the Pantry. Add it back (same name) to include its cost again. |

---

## Security notes

- The password is stored only as a **bcrypt hash** in `config.php`, never in the
  database and never in plain text.
- All API calls require an active server-side **PHP session**; unauthenticated
  requests get a `401`.
- All data-changing requests (add/edit/delete/import) require a **CSRF token**,
  which protects you from malicious cross-site requests.
- Every database query uses **PDO prepared statements**, so your inputs are never
  interpolated into raw SQL.
- Use **https** for your domain if you can (GoDaddy offers free SSL). You can
  force it by uncommenting the redirect block at the bottom of `.htaccess`.

---

Made with flour-dusted hands. Happy baking. 🥐
