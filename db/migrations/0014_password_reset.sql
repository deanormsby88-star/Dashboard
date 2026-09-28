-- Self-service password reset. The owner's password hash now lives in the
-- database so the app can change it (a reset can't edit Vercel env vars).
-- NULL means "not set in-app yet" — login then falls back to the
-- DEANOS_PASSWORD_HASH env var.
alter table users add column if not exists password_hash text;
