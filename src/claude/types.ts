/**
 * Subset of `claude --output-format stream-json` event shapes.
 * Captured against claude-code 2.1.138; unknown fields are tolerated.
 */

export type ModelName = string;

export interface UsageDelta {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  costUsd?: number;
  final?: boolean;
}

export interface SystemInitEvent {
  type: 'system';
  subtype: 'init';
  session_id: string;
  cwd: string;
  model: ModelName;
  tools: string[];
  permissionMode?: string;
  claude_code_version?: string;
}

export interface AssistantContentBlockText {
  type: 'text';
  text: string;
}
export interface AssistantContentBlockThinking {
  type: 'thinking';
  thinking: string;
}
export interface AssistantContentBlockToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export type AssistantContentBlock =
  | AssistantContentBlockText
  | AssistantContentBlockThinking
  | AssistantContentBlockToolUse
  | { type: string; [k: string]: unknown };

export interface AssistantEvent {
  type: 'assistant';
  message: {
    id: string;
    role: 'assistant';
    model: ModelName;
    content: AssistantContentBlock[];
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  session_id: string;
  parent_tool_use_id?: string | null;
}

export interface UserEvent {
  type: 'user';
  message: {
    role: 'user';
    content: unknown;
  };
  session_id: string;
}

export interface ResultEvent {
  type: 'result';
  subtype: 'success' | 'error_during_execution' | 'error_max_turns' | string;
  is_error: boolean;
  duration_ms: number;
  duration_api_ms?: number;
  num_turns: number;
  result?: string;
  session_id: string;
  /** Cost of this turn only (the runner converts the SDK's process-cumulative value). */
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface RateLimitEvent {
  type: 'rate_limit_event';
  rate_limit_info: {
    status: string;
    resetsAt: number;
    rateLimitType: string;
    utilization: number;
    isUsingOverage: boolean;
    surpassedThreshold?: number;
  };
  session_id: string;
}

/** Partial streaming chunks; only present with `--include-partial-messages`. */
export interface StreamEventEvent {
  type: 'stream_event';
  event:
    | { type: 'message_start'; message: unknown }
    | { type: 'content_block_start'; index: number; content_block: { type: string; [k: string]: unknown } }
    | { type: 'content_block_delta'; index: number; delta: { type: string; text?: string; thinking?: string; partial_json?: string } }
    | { type: 'content_block_stop'; index: number }
    | { type: 'message_delta'; delta: unknown; usage?: unknown }
    | { type: 'message_stop' }
    | { type: string; [k: string]: unknown };
  session_id: string;
}

/** Permission request — exact shape pending real capture; placeholder until verified. */
export interface PermissionRequestEvent {
  type: 'permission_request';
  id: string;
  tool: { name: string; input: unknown };
  risk?: string;
  session_id: string;
}

export interface AskUserQuestionOption {
  label: string;
  description: string;
  preview?: string;
}

export interface AskUserQuestionItem {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect?: boolean;
}

export interface AskUserQuestionEvent {
  type: 'ask_user_question';
  id: string;
  questions: AskUserQuestionItem[];
  session_id: string;
}

export interface AskUserQuestionAnswer {
  type: 'ask_user_question_answer';
  id: string;
  answers: { [question: string]: string };
  interrupted: boolean;
}

export type StreamEvent =
  | SystemInitEvent
  | AssistantEvent
  | UserEvent
  | ResultEvent
  | RateLimitEvent
  | StreamEventEvent
  | PermissionRequestEvent
  | { type: string; [k: string]: unknown };

export interface PermissionDecision {
  type: 'permission_decision';
  id: string;
  decision: 'allow' | 'deny' | 'allow_once';
  modifiedInput?: unknown;
}

export type FinalResult = ResultEvent;

export interface RunnerStartOptions {
  cwd: string;
  model?: ModelName;
  resumeSessionId?: string;
  /** Optional first turn — if provided, sent to stdin immediately after spawn. */
  initialPrompt?: string;
  bin: string;
  extraArgs?: string[];
  permissionMode?: string;
  includePartialMessages?: boolean;
  /** Appended to Claude Code's default system prompt (e.g. force thinking/response language). */
  appendSystemPrompt?: string;
}
