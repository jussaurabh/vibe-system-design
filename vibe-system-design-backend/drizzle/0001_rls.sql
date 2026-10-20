alter table vibe_system_design_ai_chat.chat_sessions enable row level security;
alter table vibe_system_design_ai_chat.chat_messages enable row level security;
revoke all on table vibe_system_design_ai_chat.chat_sessions from anon, authenticated;
revoke all on table vibe_system_design_ai_chat.chat_messages from anon, authenticated;
