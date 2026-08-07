-- Lets a user genuinely pause proactive Telegram pushes (briefs, reminders,
-- task nudges, watch alerts, etc.) until a given time. Previously "pause
-- notifications" was only ever acknowledged in chat — nothing actually
-- suppressed sends, so nudges kept arriving after the bot said it would stop.
alter table users add column if not exists notifications_paused_until timestamptz;
