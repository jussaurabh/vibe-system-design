import { describe, it, expect } from 'vitest';
import { AssistantRecorder } from './assistant-recorder.js';

describe('AssistantRecorder', () => {
  it('records assistant parts, runId, modelName, and summed usage', () => {
    const recorder = new AssistantRecorder();

    recorder.consume({ event: 'metadata', data: { run_id: 'run-1' } });
    recorder.consume({
      event: 'messages',
      data: [
        {
          type: 'ai',
          id: 'ai-2',
          response_metadata: { model_name: 'openai/gpt-5' },
          content: [
            { type: 'reasoning', reasoning: 'Think.' },
            { type: 'text', text: 'Hello' },
          ],
          tool_calls: [
            { id: 'call-1', name: 'search', args: '{"q":' },
          ],
          usage_metadata: {
            input_tokens: 10,
            output_tokens: 5,
            output_token_details: { reasoning: 2 },
          },
        },
        { langgraph_node: 'agent' },
      ],
    });
    recorder.consume({
      event: 'messages',
      data: [
        {
          type: 'ai',
          id: 'ai-2',
          content: ' world',
          tool_calls: [{ id: 'call-1', name: 'search', args: '"x"}' }],
          usage_metadata: {
            input_tokens: 16,
            output_tokens: 10,
            output_token_details: { reasoning: 3 },
          },
        },
        { langgraph_node: 'agent' },
      ],
    });
    recorder.consume({
      event: 'messages',
      data: [
        {
          type: 'tool',
          tool_call_id: 'call-1',
          content: 'ok',
        },
        { langgraph_node: 'tools' },
      ],
    });

    const result = recorder.finish('complete');

    expect(result).toEqual({
      langgraphId: 'ai-2',
      runId: 'run-1',
      modelName: 'openai/gpt-5',
      parts: [
        { type: 'reasoning', text: 'Think.' },
        { type: 'text', text: 'Hello world' },
        {
          type: 'tool',
          toolCallId: 'call-1',
          name: 'search',
          input: { q: 'x' },
          output: 'ok',
          status: 'complete',
        },
      ],
      inputTokens: 16,
      outputTokens: 10,
      reasoningTokens: 3,
    });
  });

  it('marks tool-only or incomplete tool calls as incomplete', () => {
    const recorder = new AssistantRecorder();
    recorder.consume({
      event: 'messages',
      data: [
        {
          type: 'ai',
          id: 'ai-1',
          tool_calls: [{ id: 'call-2', name: 'fetch', args: '{"id":1}' }],
        },
        { langgraph_node: 'agent' },
      ],
    });

    const result = recorder.finish('incomplete');
    expect(result.parts[0]).toMatchObject({
      type: 'tool',
      toolCallId: 'call-2',
      status: 'incomplete',
      output: undefined,
    });
  });

  it('returns null tokens when no usage metadata arrives', () => {
    const recorder = new AssistantRecorder();
    recorder.consume({
      event: 'messages',
      data: [{ type: 'ai', id: 'ai-1', content: 'Hi' }, { langgraph_node: 'agent' }],
    });

    const result = recorder.finish('complete');
    expect(result.inputTokens).toBeNull();
    expect(result.outputTokens).toBeNull();
    expect(result.reasoningTokens).toBeNull();
  });
});