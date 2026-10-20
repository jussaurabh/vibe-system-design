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

import { chatStreamRequestSchema, renameSessionBodySchema } from './chat.dto.js';
import { ChatService } from './chat.service.js';
import type { SessionSummary, StoredMessage } from './chat.types.js';
import { formatDoneFrame, formatErrorFrame, formatEventFrame, SSE_HEADERS } from './sse.js';

@Controller('chat')
export class ChatController {
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
  async getSession(@Param('sessionId') sessionId: string): Promise<{ session: SessionSummary }> {
    return { session: await this.chat.getSession(sessionId) };
  }

  @Patch('sessions/:sessionId')
  async renameSession(
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
  ): Promise<{ session: SessionSummary }> {
    const parsed = renameSessionBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return { session: await this.chat.renameSession(sessionId, parsed.data.title) };
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

  @Delete('messages/:messageId')
  @HttpCode(204)
  async deleteMessage(@Param('messageId') messageId: string): Promise<void> {
    await this.chat.deleteMessage(messageId);
  }

  @Post('stream')
  @HttpCode(200)
  async stream(@Body() body: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const parsed = chatStreamRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    for (const [key, value] of Object.entries(SSE_HEADERS)) res.setHeader(key, value);
    res.flushHeaders();

    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });

    try {
      for await (const event of this.chat.stream(
        parsed.data.sessionId,
        parsed.data.message,
        abort.signal,
      )) {
        if (abort.signal.aborted || res.writableEnded) break;
        res.write(formatEventFrame(event));
      }

      if (abort.signal.aborted || res.writableEnded) return;

      res.write(formatDoneFrame());
      res.end();
    } catch (err) {
      if (abort.signal.aborted || res.writableEnded) return;
      const message = err instanceof Error ? err.message : String(err);
      res.write(formatErrorFrame(message));
      res.end();
    }
  }
}
