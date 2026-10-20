import { BadRequestException, Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { chatStreamRequestSchema, toLangChainMessages } from './chat.dto.js';
import { ChatService } from './chat.service.js';
import { formatDoneFrame, formatErrorFrame, formatEventFrame, SSE_HEADERS } from './sse.js';

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

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
        toLangChainMessages(parsed.data.messages),
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
