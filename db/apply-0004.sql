-- Apply migration 0004 (conversation_messages) to an existing DeanOS database.

-- Conversational memory for the Assistant (Telegram + web).
-- Short rolling history per channel so multi-turn natural-language chat works.

create table conversation_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  channel     text not null check (channel in ('telegram', 'web')),
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  created_at  timestamptz not null default now()
);
create index conversation_channel_idx on conversation_messages (user_id, channel, created_at desc);

insert into schema_migrations (filename) values ('0004_conversations.sql') on conflict (filename) do nothing;
