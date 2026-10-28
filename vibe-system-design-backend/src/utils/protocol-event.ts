/**
 * The event envelope that the backend streams to the UI, copied structurally
 * from `@langchain/langgraph` `ProtocolEvent` so that `src/utils/sse.ts` can
 * format the frames without the langgraph dependency.
 */

/** Single envelope for a streamed protocol emission. */
export interface ProtocolEvent {
  /** Discriminator; always `"event"` for this shape. */
  readonly type: 'event';
  /** Monotonic sequence number for ordering within a run. */
  readonly seq: number;
  /** Logical stream channel, such as `messages`, `updates`, or `lifecycle`. */
  readonly method: string;
  /** Channel-specific payload and routing metadata. */
  readonly params: {
    /** Namespace of the node or scope that emitted this event. */
    readonly namespace: string[];
    /** Wall-clock timestamp for the emission in milliseconds. */
    readonly timestamp: number;
    /** Graph node id when the event belongs to one node. */
    readonly node?: string;
    /** Opaque channel payload; the shape depends on `method`. */
    readonly data: unknown;
  };
}

/** Token usage of one model call, as the agent reports it. */
export interface UsageInfo {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_token_details?: Record<string, number>;
  output_token_details?: Record<string, number>;
}
