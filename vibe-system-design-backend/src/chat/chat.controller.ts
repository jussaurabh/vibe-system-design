import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ProtocolEvent } from '../utils/protocol-event.js';

import {
  chatStreamRequestSchema,
  renameSessionBodySchema,
} from './chat.dto.js';
import { ChatService } from './chat.service.js';
import type { SessionSummary, StoredMessage } from './chat.types.js';
import {
  formatDoneFrame,
  formatErrorFrame,
  formatEventFrame,
  SSE_HEADERS,
} from '../utils/sse.js';
import { AppLogger } from '../logging/app-logger.js';

function extractTokenUsage(event: ProtocolEvent): {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  inputTokenDetails: Record<string, unknown> | null;
  outputTokenDetails: Record<string, unknown> | null;
} {
  const params = event.params as Record<string, unknown> | undefined;
  const data = params?.['data'] as Record<string, unknown> | undefined;
  if (!data || typeof data !== 'object') {
    return {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      reasoningTokens: null,
      inputTokenDetails: null,
      outputTokenDetails: null,
    };
  }

  const sources: Array<Record<string, unknown>> = [
    data,
    (data['usage'] as Record<string, unknown>) ?? {},
    (data['usage_metadata'] as Record<string, unknown>) ?? {},
    ((data['chunk'] as Record<string, unknown>)?.['usage_metadata'] as Record<
      string,
      unknown
    >) ?? {},
  ];

  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let totalTokens: number | null = null;
  let reasoningTokens: number | null = null;
  let inputTokenDetails: Record<string, unknown> | null = null;
  let outputTokenDetails: Record<string, unknown> | null = null;

  for (const src of sources) {
    if (!src || typeof src !== 'object') continue;

    if (inputTokens === null) {
      const val = src['input_tokens'] ?? src['prompt_tokens'];
      if (typeof val === 'number') inputTokens = val;
    }
    if (outputTokens === null) {
      const val = src['output_tokens'] ?? src['completion_tokens'];
      if (typeof val === 'number') outputTokens = val;
    }
    if (totalTokens === null) {
      const val = src['total_tokens'];
      if (typeof val === 'number') totalTokens = val;
    }
    if (inputTokenDetails === null) {
      const val = src['input_token_details'];
      if (val && typeof val === 'object')
        inputTokenDetails = val as Record<string, unknown>;
    }
    if (outputTokenDetails === null) {
      const val = src['output_token_details'];
      if (val && typeof val === 'object') {
        outputTokenDetails = val as Record<string, unknown>;
        const reasoning = (val as Record<string, unknown>)['reasoning'];
        if (typeof reasoning === 'number') reasoningTokens = reasoning;
      }
    }
  }

  if (totalTokens === null && inputTokens !== null && outputTokens !== null) {
    totalTokens = inputTokens + outputTokens;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    reasoningTokens,
    inputTokenDetails,
    outputTokenDetails,
  };
}

@Controller('chat')
export class ChatController {
  private readonly logger = new AppLogger(ChatController.name);

  constructor(private readonly chat: ChatService) {}

  @Get('sessions')
  async listSessions(): Promise<{ sessions: SessionSummary[] }> {
    return { sessions: await this.chat.listSessions() };
  }

  @Post('sessions')
  @HttpCode(200)
  async createSession(): Promise<{ session: SessionSummary }> {
    return { session: await this.chat.createSession() };
  }

  @Get('sessions/:sessionId')
  async getSession(
    @Param('sessionId') sessionId: string,
  ): Promise<{ session: SessionSummary }> {
    return { session: await this.chat.getSession(sessionId) };
  }

  @Patch('sessions/:sessionId')
  async renameSession(
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
  ): Promise<{ session: SessionSummary }> {
    const parsed = renameSessionBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return {
      session: await this.chat.renameSession(sessionId, parsed.data.title),
    };
  }

  @Delete('sessions/:sessionId')
  @HttpCode(204)
  async deleteSession(@Param('sessionId') sessionId: string): Promise<void> {
    await this.chat.deleteSession(sessionId);
  }

  @Get('sessions/:sessionId/messages')
  async listMessages(
    @Param('sessionId') sessionId: string,
  ): Promise<{ messages: StoredMessage[] }> {
    return { messages: await this.chat.listMessages(sessionId) };
  }

  @Post('sessions/:sessionId/stop')
  @HttpCode(204)
  async stop(@Param('sessionId') sessionId: string): Promise<void> {
    await this.chat.stopSession(sessionId);
  }

  @Post('stream')
  @HttpCode(200)
  async stream(
    @Body() body: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const parsed = chatStreamRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    // The session is loaded before the headers go out. A missing session is a
    // 404, and the answer never becomes an event stream.
    await this.chat.getSession(parsed.data.sessionId);

    for (const [key, value] of Object.entries(SSE_HEADERS))
      res.setHeader(key, value);
    res.flushHeaders();

    // The title lives in the thread metadata. A failed write never breaks
    // the stream.
    try {
      await this.chat.ensureTitle(parsed.data.sessionId, parsed.data.message);
    } catch (err) {
      this.logger.error(
        `The title of session ${parsed.data.sessionId} was not stored.`,
        err,
      );
    }

    const startedAt = performance.now();
    let peakInputTokens = 0;
    let peakOutputTokens = 0;
    let peakTotalTokens = 0;
    let peakReasoningTokens = 0;
    let lastInputTokenDetails: Record<string, unknown> | null = null;
    let lastOutputTokenDetails: Record<string, unknown> | null = null;

    try {
      for await (const event of this.chat.stream(
        parsed.data.sessionId,
        parsed.data.message,
      )) {
        const usage = extractTokenUsage(event);
        if (usage.inputTokens !== null && usage.inputTokens > peakInputTokens) {
          peakInputTokens = usage.inputTokens;
        }
        if (
          usage.outputTokens !== null &&
          usage.outputTokens > peakOutputTokens
        ) {
          peakOutputTokens = usage.outputTokens;
        }
        if (usage.totalTokens !== null && usage.totalTokens > peakTotalTokens) {
          peakTotalTokens = usage.totalTokens;
        }
        if (
          usage.reasoningTokens !== null &&
          usage.reasoningTokens > peakReasoningTokens
        ) {
          peakReasoningTokens = usage.reasoningTokens;
        }
        if (usage.inputTokenDetails !== null) {
          lastInputTokenDetails = usage.inputTokenDetails;
        }
        if (usage.outputTokenDetails !== null) {
          lastOutputTokenDetails = usage.outputTokenDetails;
        }

        if (res.writableEnded) break;
        res.write(formatEventFrame(event));
      }

      if (res.writableEnded) return;

      res.write(formatDoneFrame());
      res.end();

      const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
      this.logger.info('Chat stream completed with tokens', {
        sessionId: parsed.data.sessionId,
        durationMs,
        tokens: {
          inputTokens: peakInputTokens > 0 ? peakInputTokens : null,
          outputTokens: peakOutputTokens > 0 ? peakOutputTokens : null,
          totalTokens:
            peakTotalTokens > 0
              ? peakTotalTokens
              : peakInputTokens + peakOutputTokens > 0
                ? peakInputTokens + peakOutputTokens
                : null,
          reasoningTokens: peakReasoningTokens > 0 ? peakReasoningTokens : null,
          inputTokenDetails: lastInputTokenDetails,
          outputTokenDetails: lastOutputTokenDetails,
        },
      });
    } catch (err) {
      if (res.writableEnded) return;
      const message = err instanceof Error ? err.message : String(err);
      res.write(formatErrorFrame(message));
      res.end();

      const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
      this.logger.error('Chat stream failed', {
        sessionId: parsed.data.sessionId,
        durationMs,
        err,
      });
    }
  }
}
