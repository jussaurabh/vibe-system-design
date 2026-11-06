alter table public.chat_messages enable row level security;
revoke all on table public.chat_messages from anon, authenticated;
