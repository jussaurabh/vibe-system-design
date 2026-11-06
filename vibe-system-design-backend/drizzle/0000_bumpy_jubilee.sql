CREATE TABLE "chat_messages" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chat_messages_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"thread_id" uuid NOT NULL,
	"langgraph_id" text,
	"role" text NOT NULL,
	"status" text DEFAULT 'complete' NOT NULL,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_name" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"reasoning_tokens" integer,
	"latency_ms" integer,
	"run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_messages_role_check" CHECK (role = any(array['user'::text, 'assistant'::text, 'system'::text, 'tool'::text])),
	CONSTRAINT "chat_messages_status_check" CHECK (status = any(array['complete'::text, 'incomplete'::text, 'error'::text]))
);
--> statement-breakpoint
CREATE INDEX "chat_messages_thread_msg_idx" ON "chat_messages" USING btree ("thread_id","langgraph_id") WHERE langgraph_id is not null;--> statement-breakpoint
CREATE INDEX "chat_messages_thread_seq_idx" ON "chat_messages" USING btree ("thread_id","seq");