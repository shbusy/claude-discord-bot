# Codex CLI Discord Bot 추가 계획

## 목적
기존 Claude Code Discord Bot 프로젝트를 새로 분리하지 않고, 같은 코드베이스 안에서
Codex CLI를 두 번째 agent로 추가한다. 최종 목표는 한 Discord 서버의 같은 채널 안에서
Claude 봇과 Codex 봇이 서로 멘션 기반으로 상호작용하며 협업할 수 있게 만드는 것이다.

## 기본 방향
- 새 프로젝트를 만들지 않는다.
- Discord 연결, slash command, streaming UI, permission UI, thread routing, session manager는 최대한 재사용한다.
- Claude 전용 runner를 공통 agent runner 구조로 분리한 뒤 Codex runner를 추가한다.
- 같은 채널 안에서 Claude 세션과 Codex 세션이 동시에 존재할 수 있도록 session key를 agent 단위로 분리한다.
- 봇끼리 대화는 허용하되, 멘션 기반 처리와 loop guard를 반드시 둔다.

## 제안 구조

```text
src/
  agents/
    types.ts
    claudeRunner.ts
    codexRunner.ts
  session/
    manager.ts
  bot/
    ...
```

### `src/agents/types.ts`
공통 runner 인터페이스와 이벤트 타입을 둔다.

```ts
export type AgentKind = 'claude' | 'codex';

export interface AgentRunner {
  start(): Promise<void>;
  send(prompt: string): Promise<void>;
  stop(signal?: NodeJS.Signals): Promise<void>;
  endInput(): void;
  sendPermission?(decision: PermissionDecision): void;
  readonly isRunning: boolean;
  readonly currentSessionId: string | null;
  readonly currentModel: string | null;
  readonly currentCwd: string | null;
}
```

공통 이벤트는 기존 Claude runner 이벤트를 기준으로 맞춘다.

- `init`
- `text`
- `thinking`
- `toolUse`
- `toolResult`
- `permission`
- `usage`
- `rateLimit`
- `raw`
- `end`
- `error`
- `exit`

## 변경 파일 목록

### 신규 생성
- `src/agents/types.ts` - 공통 agent 타입과 runner 이벤트 정의
- `src/agents/claudeRunner.ts` - 기존 `src/claude/runner.ts` 이동 또는 wrapper
- `src/agents/codexRunner.ts` - Codex CLI 실행 및 스트림 변환
- `test/agentTypes.test.ts` - 공통 타입/runner factory 단위 테스트
- `test/codexRunner.test.ts` - Codex runner 최소 동작 테스트
- `test/multiAgentSession.test.ts` - 같은 채널의 agent별 세션 분리 테스트

### 수정
- `src/session/manager.ts` - `ClaudeRunner` 직접 의존 제거, `AgentKind` 기반 session key 도입
- `src/session/topicCodec.ts` - agent별 metadata 저장 지원
- `src/config/schema.ts` - Codex 관련 설정 추가
- `src/config/load.ts` - Codex 환경변수 매핑 추가
- `src/bot/types.ts` - multi-agent context 지원
- `src/bot/events/messageCreate.ts` - peer bot 허용, loop guard, agent routing 추가
- `src/bot/commands/new.ts` - `agent` 옵션 추가
- `src/bot/commands/model.ts` - agent별 model 변경 지원
- `src/bot/commands/stop.ts` - agent별 stop 지원
- `src/bot/commands/status.ts` - agent별 세션 상태 표시
- `src/bot/commands/resume.ts` - agent별 resume 지원
- `README.md` - Codex bot 설정 및 운영 방법 문서화

## 설정 계획

기존 설정과 호환되도록 추가 필드를 도입한다.

```ts
defaultAgent: 'claude' | 'codex';
claudeBin: string;
codexBin: string;
defaultModel: string;
claudeModel?: string;
codexModel?: string;
allowedPeerBotIds: string[];
maxBotRelayDepth: number;
```

환경변수 예시:

```env
DEFAULT_AGENT=claude
CLAUDE_BIN=claude
CODEX_BIN=codex
CLAUDE_MODEL=sonnet
CODEX_MODEL=gpt-5.3-codex
ALLOWED_PEER_BOT_IDS=123456789012345678,234567890123456789
MAX_BOT_RELAY_DEPTH=4
```

## 세션 구조 변경

현재는 채널 하나에 세션 하나가 연결된다.

```ts
Map<channelId, ChannelSession>
```

multi-agent 구조에서는 agent와 channel을 함께 키로 사용한다.

```ts
Map<`${AgentKind}:${channelId}`, ChannelSession>
```

예:

```text
claude:123456789012345678
codex:123456789012345678
```

이렇게 해야 같은 Discord 채널에서 Claude와 Codex가 각각 독립적인 cwd, model, session id를 유지할 수 있다.

## 채널 토픽 metadata 변경

현재 토픽 metadata가 단일 세션 기준이면, 여러 agent 세션을 담을 수 있도록 확장한다.

```json
{
  "sessions": {
    "claude": {
      "sessionId": "...",
      "cwd": "...",
      "model": "sonnet",
      "permissionMode": "default",
      "lastActiveAt": 1779000000000
    },
    "codex": {
      "sessionId": "...",
      "cwd": "...",
      "model": "gpt-5.3-codex",
      "permissionMode": "default",
      "lastActiveAt": 1779000000000
    }
  }
}
```

기존 단일 metadata도 decode할 수 있게 하여 migration 없이 동작하게 한다.

## CodexRunner 1차 범위

처음부터 Claude runner와 완전 동일 기능을 목표로 하지 않는다. 먼저 Discord에서 Codex CLI와 대화가 되는 최소 기능을 구현한다.

- `codex` CLI 실행
- `cwd` 지정
- 초기 prompt 전달
- 후속 prompt 전달
- stdout/stderr streaming
- Discord `text` 이벤트로 변환
- stop 처리
- 종료 이벤트 처리

## CodexRunner 2차 범위

Codex CLI 출력 형식과 기능 지원 여부를 확인한 뒤 확장한다.

- tool use 표시
- tool result 표시
- permission prompt 연결
- usage/cost 표시
- session id 캡처
- resume 지원
- partial thinking 또는 reasoning 표시

## 봇끼리 대화 허용

현재 메시지 핸들러는 봇 메시지를 모두 무시한다.

```ts
if (msg.author.bot) return;
```

변경 방향:

```ts
if (msg.author.bot && !ctx.config.allowedPeerBotIds.includes(msg.author.id)) return;
```

필수 guard:

- 자기 자신의 메시지는 항상 무시한다.
- 허용된 peer bot ID만 처리한다.
- 반드시 현재 bot이 멘션된 메시지만 처리한다.
- 같은 메시지 ID에 중복 응답하지 않는다.
- relay depth 또는 hop counter를 둬서 무한 왕복을 차단한다.
- active runner가 있으면 기존처럼 거절하거나 queue 정책을 명확히 한다.

## 협업용 시스템 프롬프트

agent별 system prompt suffix를 지원한다.

Claude 예시:

```text
너는 Claude Code Discord Bot이다. 같은 채널의 Codex 봇과 협업한다.
Codex에게 작업을 넘길 때는 목표, 파일 범위, 검증 방법을 명확히 적어라.
```

Codex 예시:

```text
너는 Codex CLI Discord Bot이다. 같은 채널의 Claude 봇과 협업한다.
Claude의 요청을 코드 구현, 검증, 리뷰 관점에서 처리하고 결과를 간결하게 보고하라.
```

## Slash command 변경

agent 옵션을 추가한다.

```text
/cdb new agent:claude
/cdb new agent:codex
/cdb model agent:codex model:gpt-5.3-codex
/cdb stop agent:codex
/cdb resume agent:claude session_id:...
/cdb status
```

처음에는 기존 `/cdb` 명령어를 유지하고, agent 옵션만 추가한다. 별도 `/xdb` prefix는 나중에 필요할 때 검토한다.

## 구현 순서

1. `src/agents/types.ts` 추가
2. 기존 `ClaudeRunner`를 `src/agents/claudeRunner.ts`로 이동하거나 wrapper 추가
3. 기존 테스트가 깨지지 않도록 import 정리
4. `SessionManager`에서 `ClaudeRunner` 직접 의존 제거
5. `SessionManager`에 `AgentKind`와 agent-aware session key 도입
6. `topicCodec`을 multi-agent metadata 구조로 확장
7. 설정에 `codexBin`, `defaultAgent`, `allowedPeerBotIds`, `maxBotRelayDepth` 추가
8. `CodexRunner` 최소 기능 구현
9. `/cdb new`, `/cdb stop`, `/cdb model`, `/cdb status`, `/cdb resume`에 agent 옵션 추가
10. Discord 메시지 라우팅에서 agent 선택 지원
11. 허용된 peer bot 메시지 처리 추가
12. loop guard 구현
13. 협업용 system prompt suffix 추가
14. Codex tool/permission/usage/resume 기능을 가능한 범위에서 확장

## 테스트 계획

- 기존 Claude 단독 메시지 처리 유지
- 기존 `/cdb new`, `/cdb stop`, `/cdb model`, `/cdb resume`, `/cdb status` 동작 유지
- 같은 채널에서 `claude:<channelId>`와 `codex:<channelId>` 세션이 분리되는지 확인
- channel topic encode/decode가 기존 단일 metadata와 신규 multi-agent metadata를 모두 처리하는지 확인
- Codex runner가 stdout streaming을 `text` 이벤트로 변환하는지 확인
- Codex runner stop 시 프로세스가 정상 종료되는지 확인
- peer bot이 아니면 bot message를 무시하는지 확인
- peer bot이어도 멘션이 없으면 무시하는지 확인
- 같은 message id에 중복 응답하지 않는지 확인
- relay depth 초과 시 응답을 중단하는지 확인

## 체크리스트

- [ ] `AgentRunner` 공통 타입 추가
- [ ] `ClaudeRunner` 이동 또는 wrapper 적용
- [ ] 기존 Claude 테스트 통과
- [ ] `SessionManager` agent-aware 구조로 변경
- [ ] `topicCodec` multi-agent metadata 지원
- [ ] Codex 설정 추가
- [ ] `CodexRunner` 최소 구현
- [ ] Codex 단독 대화 동작
- [ ] agent별 slash command 옵션 추가
- [ ] 같은 채널 내 Claude/Codex 세션 분리
- [ ] peer bot allowlist 추가
- [ ] loop guard 추가
- [ ] 협업용 system prompt 추가
- [ ] Codex tool/permission/usage/resume 지원 범위 검증
- [ ] typecheck 통과
- [ ] test 통과
- [ ] README 업데이트

## 리스크

- Codex CLI의 안정적인 stream/json 출력 형식 지원 여부가 핵심이다.
- Claude SDK 기반 runner와 Codex CLI process runner의 이벤트 품질이 다를 수 있다.
- permission prompt는 Codex CLI가 외부에서 승인/거절을 받을 수 있는 방식이 있는지 확인해야 한다.
- usage/cost 정보는 Codex CLI가 제공하지 않으면 표시하지 못할 수 있다.
- 봇끼리 대화는 loop guard가 없으면 채널 스팸이나 비용 증가로 이어질 수 있다.

## 완료 기준

- 기존 Claude Discord Bot 기능이 유지된다.
- 같은 채널에서 Claude agent와 Codex agent 세션을 각각 만들 수 있다.
- Codex agent에게 Discord 메시지를 보내고 streaming 응답을 받을 수 있다.
- Claude 봇과 Codex 봇이 allowlist와 멘션 조건 안에서 서로 응답할 수 있다.
- 무한 응답 루프가 방지된다.
- 핵심 테스트와 typecheck가 통과한다.
