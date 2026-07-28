-- Per-user Telegram. Each user links their own Telegram chat so the shared bot
-- can route inbound messages to the right user and deliver each user's proactive
-- messages (briefs, reminders, nudges) to their own chat.

alter table users add column if not exists telegram_chat_id text;

-- One chat maps to at most one user.
create unique index if not exists users_telegram_chat_id_key
  on users (telegram_chat_id) where telegram_chat_id is not null;
