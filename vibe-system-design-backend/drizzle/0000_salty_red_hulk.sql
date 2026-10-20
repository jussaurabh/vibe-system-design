-- drizzle-kit does not model a Postgres schema namespace, so the namespace
-- statement is the one hand written line of this migration. The tables below
-- are generated from src/db/schema.ts.
CREATE SCHEMA IF NOT EXISTS "vibe_system_design_ai_chat";
--> statement-breakpoint
CREATE TABLE "vibe_system_design_ai_chat"."chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	"seq" integer NOT NULL,
	"sender_type" text NOT NULL,
	"content" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'complete' NOT NULL,
	"token_count" integer,
	"model_name" text,
	"latency_ms" integer,
	CONSTRAINT "chat_messages_session_seq_key" UNIQUE("session_id","seq"),
	CONSTRAINT "chat_messages_sender_type_check" CHECK ("vibe_system_design_ai_chat"."chat_messages"."sender_type" in ('user', 'assistant', 'system', 'tool')),
	CONSTRAINT "chat_messages_status_check" CHECK ("vibe_system_design_ai_chat"."chat_messages"."status" in ('complete', 'incomplete', 'error')),
	CONSTRAINT "chat_messages_id_prefix_check" CHECK (starts_with("vibe_system_design_ai_chat"."chat_messages"."id", 'msg_'))
);
--> statement-breakpoint
CREATE TABLE "vibe_system_design_ai_chat"."chat_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"last_message_at" bigint,
	CONSTRAINT "chat_sessions_id_prefix_check" CHECK (starts_with("vibe_system_design_ai_chat"."chat_sessions"."id", 'ses_'))
);
--> statement-breakpoint
ALTER TABLE "vibe_system_design_ai_chat"."chat_messages" ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "vibe_system_design_ai_chat"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_sessions_user_recent_idx" ON "vibe_system_design_ai_chat"."chat_sessions" USING btree ("user_id","last_message_at" DESC NULLS LAST);