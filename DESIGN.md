# Claude Code Discord Bot — 설계서

> 자체 호스팅 Discord 봇으로, 사용자의 PC에서 실행 중인 `claude` CLI 세션에 명령을 위임한다. Anthropic API를 직접 호출하지 않고, 사용자의 기존 Claude Code 구독/세션을 그대로 활용한다.

---

## 0. 메타정보

| 항목 | 값 |
|---|---|
| 프로젝트 코드명 | `claude-discord-bot` (CDB) |
| 명령어 prefix | `/cdb` (설정으로 변경 가능) |
| 런타임 | Node.js ≥ 20 |
| 언어 | TypeScript |
| 핵심 라이브러리 | `discord.js` v14, `node-pty` 또는 `child_process`, `chokidar`, `dotenv`, `zod` |
| 배포 형태 | 셀프호스트 (사용자 PC에서 직접 실행) |
| 외부 의존 서비스 | Discord Gateway API, 로컬 `claude` CLI |
| 추가 과금 | 없음 (Claude Code 구독을 그대로 사용) |

---

## 1. 문제 정의 & 목표

### 1.1 해결하려는 문제
1. **이동 중 Claude Code 사용** — 데스크톱을 벗어났을 때도 폰의 Discord 앱으로 진행 중인 작업을 이어서 지시하고 싶다.
2. **세션 단절 문제** — 일시적으로 자리를 비웠을 때 진행 중인 대화를 잃지 않고 재개해야 한다.
3. **다중 프로젝트 동시 작업** — 여러 작업 디렉토리에서 동시에 Claude를 돌리고 싶다.
4. **명확한 상태 관찰** — 어떤 도구가 호출됐고, 무엇을 기다리고 있는지 한눈에 보여야 한다.

### 1.2 목표
- 기존 `claude` CLI 세션과 **완전 호환**되는 세션 관리(`~/.claude/projects/` JSONL 그대로 읽고 쓰기)
- **채널 = 세션** 1:1 매핑으로 다중 세션을 시각적으로 분리
- 도구 호출/권한 승인을 **Discord 버튼 UI**로 처리
- 토큰/비용 사용량을 **실시간으로 추적·표시**
- **플러그인 자동 로드** 기반의 확장 가능 구조

### 1.3 비목표 (이번 설계에서 제외)
- 클라우드 배포·멀티 유저 SaaS 형태
- Anthropic API 직접 호출 백업 경로
- 모바일 네이티브 앱

---

## 2. 시스템 아키텍처

### 2.1 전체 데이터 흐름

```
┌─────────────┐  Discord Gateway   ┌────────────────────────────┐
│   유저(폰)   │ ─────────────────▶ │   Discord (서버/채널)       │
└─────────────┘                    └─────────────┬──────────────┘
                                                 │ Webhook/Gateway 이벤트
                                                 ▼
                                   ┌────────────────────────────┐
                                   │ claude-discord-bot (Node)  │
                                   │  - command 라우터           │
                                   │  - session manager         │
                                   │  - tool approval UI        │
                                   │  - usage tracker           │
                                   └─────────────┬──────────────┘
                                                 │ stdin/stdout (JSONL stream)
                                                 ▼
                                   ┌────────────────────────────┐
                                   │   claude CLI (subprocess)   │
                                   │   --output-format stream-json│
                                   │   세션 데이터:                │
                                   │   ~/.claude/projects/...    │
                                   └────────────────────────────┘
```

### 2.2 핵심 선택: subprocess 방식

본 설계는 **Anthropic SDK가 아닌 `claude` CLI를 자식 프로세스로 spawn** 한다.

| 후보 | 장점 | 단점 | 선택 |
|---|---|---|---|
| **Claude Code CLI subprocess** | 사용자의 기존 구독·MCP·hook·도구 권한이 그대로 적용됨. 추가 비용 없음. JSONL이 CLI 세션과 완전 호환 | 프로세스 라이프사이클 관리 필요 | ✅ |
| Anthropic SDK 직접 호출 | API 레벨 통제 용이 | 별도 API 키·과금, 도구·MCP 재구성 부담, CLI 세션과 분리됨 | ❌ |
| 실행 중인 터미널에 IPC 주입 | "내 세션에서 처리"의 가장 직관적 의미 | tmux/screen 의존, race condition, 표준화 어려움 | ❌ |

**`claude` CLI 호출 방식**:
- 비대화형 모드 + 스트리밍: `claude -p "<prompt>" --output-format stream-json --input-format stream-json`
- 세션 재개: `claude --resume <sessionId>` (또는 JSONL 파일 직접 적재)
- 작업 디렉토리 지정: `cwd` 옵션으로 spawn

### 2.3 동시성 모델
- 봇 프로세스는 **단일 Node 프로세스**.
- 각 Discord 채널마다 **독립된 `claude` 자식 프로세스**가 (필요 시) 1개씩.
- 자식 프로세스는 idle 시간이 길면 종료하고, 다음 메시지에서 `--resume`으로 재기동 (메모리 절약).
- 메시지 수신은 채널별 큐로 직렬화. 동일 채널에 동시 입력이 와도 순차 처리.

---

## 3. 기능 명세

### 3.1 슬래시 커맨드

| 커맨드 | 인자 | 설명 |
|---|---|---|
| `/cdb init` | (없음) | 현 길드에 봇이 사용할 카테고리·채널 구조를 자동 생성. 권한 검사 포함 |
| `/cdb resume` | `[session_id?]` | 현 채널에 매핑된 세션 또는 지정한 세션을 재개. 마지막 N개 메시지 스레드에 요약 표시 |
| `/cdb new` | `[name?] [path?] [model?]` | 현 카테고리에 새 세션 채널 생성. 작업 디렉토리·모델 설정 |
| `/cdb model` | `<opus\|sonnet\|haiku>` | 현 채널의 기본 모델 변경 |
| `/cdb status` | (없음) | 현 채널의 세션 ID, cwd, 실행 중 도구, 누적 토큰/비용 표시 |
| `/cdb stop` | (없음) | 현재 진행 중인 응답 중단 (자식 프로세스 SIGINT) |
| `/cdb usage` | `[period?]` | 길드 전체 또는 본인 기준 사용량 리포트 |
| `/cdb plugin` | `list\|reload\|enable\|disable <name>` | 플러그인 관리 |
| `/cdb config` | (sub) | 봇 설정 (한국어 응답 강제 등) |

### 3.2 메시지 흐름 (세션 채널)

1. 유저가 세션 채널에 일반 텍스트 메시지를 보냄.
2. 봇이 메시지를 prompt로 변환, 채널의 세션과 연결된 `claude` 프로세스에 stream-json으로 입력.
3. CLI가 stream-json으로 토큰을 흘려보내면, 봇이 **단일 임베드 메시지를 점진적으로 edit**해서 실시간 표시 (rate limit 고려해 250–500ms throttle).
4. 도구 호출이 발생하면 별도 **스레드**(`🛠 tool: <name>`)로 분리해 입출력을 그곳에 표시.
5. 권한 요청이 발생하면 (3.4) 버튼 UI로 승인/거부.
6. 응답이 끝나면 임베드 footer에 사용 토큰·비용·소요시간을 갱신.

### 3.3 채널 구조 (`/cdb init` 산출물)

```
📁 Claude Code (category)
 ├─ #📋-control          # 봇 제어, /cdb 명령 결과 출력
 ├─ #📁-session          # 디렉토리 브라우저 / 세션 시작 진입점
 ├─ #📊-usage            # 사용량 리포트 자동 게시
 ├─ #🔔-alerts           # 권한 승인 요청 알림 (DM 미가능 시 fallback)
 └─ 📁 Sessions          # /cdb new 가 만드는 채널들이 들어가는 서브 카테고리
     ├─ #🟢-proj-frontend
     ├─ #🟢-proj-api
     └─ ...
```
- 각 세션 채널의 토픽에 `cwd`, `model`, `sessionId`, `lastActiveAt` 메타데이터 JSON을 저장.
- 봇 재시작 시 이 토픽을 읽어 세션 매핑 복원.

### 3.4 도구 권한 승인 UX

CLI가 `permission_request` 이벤트를 stream-json에 흘리면:

```
┌─────────────────────────────────────────┐
│ 🔐 도구 사용 권한 요청                    │
│ Tool: Bash                              │
│ Command: npm install lodash             │
│ Risk: medium (network access)           │
│                                         │
│ [✅ 승인] [🔁 한 번만] [❌ 거부] [📝 수정]│
└─────────────────────────────────────────┘
```
- 버튼 응답을 받으면 CLI에 permission decision JSON을 stdin으로 전달.
- `📝 수정` 은 모달을 띄워 명령어를 편집한 뒤 승인.
- 30초 무응답 시 기본값(거부) 적용 + 알림 채널 ping.

### 3.5 스트리밍 임베드

- **하나의 메시지를 계속 edit**하는 방식 (Discord rate limit: 채널당 5 edits / 5sec 정도).
- 토큰 단위가 아닌 **chunk 누적 + debounce**.
- 4096자(임베드 description 한도) 초과 시 자동으로 다음 메시지로 이어붙임. 코드블록은 분할 시 닫고 다시 여는 처리.
- 응답 종료 후, 긴 출력은 thread로 자동 이전 + 상위 메시지에는 요약만 남김.

### 3.6 사용량 트래커

- CLI stream-json에서 `usage` 필드를 읽어 누적.
- SQLite (`better-sqlite3`)에 `(sessionId, channelId, userId, model, inputTok, outputTok, cacheReadTok, costUsd, ts)` 저장.
- `/cdb usage` 는 일/주/월 집계, 모델별 분포, top 채널을 임베드로 출력.
- 임계치 초과 시 `#📊-usage` 채널에 알림.

### 3.7 플러그인 시스템

- `~/.claude-discord-bot/plugins/*.{js,ts}` 디렉토리를 부팅 시 스캔.
- 플러그인 인터페이스 (TypeScript):
  ```ts
  export interface Plugin {
    name: string;
    version: string;
    onLoad?(ctx: PluginContext): Promise<void>;
    commands?: SlashCommandSpec[];
    hooks?: {
      onUserMessage?(msg: Message, ctx: PluginContext): Promise<HookResult>;
      onToolCall?(tool: ToolCall, ctx: PluginContext): Promise<HookResult>;
      onClaudeOutput?(chunk: StreamChunk, ctx: PluginContext): Promise<void>;
    };
  }
  ```
- 핫 리로드: `chokidar`로 디렉토리 watch, 변경 시 `/cdb plugin reload` 자동 실행.

---

## 4. 모듈 / 파일 구조

```
~/Project/claude-discord-bot/
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
├── DESIGN.md                    ← 본 문서
├── bin/
│   └── cdb.ts                   # CLI 진입점 (--setup, run)
├── src/
│   ├── index.ts                 # 부트스트랩
│   ├── bot/
│   │   ├── client.ts            # discord.js Client 생성·로그인
│   │   ├── commands/
│   │   │   ├── index.ts         # 커맨드 레지스트라
│   │   │   ├── init.ts
│   │   │   ├── new.ts
│   │   │   ├── resume.ts
│   │   │   ├── model.ts
│   │   │   ├── status.ts
│   │   │   ├── stop.ts
│   │   │   ├── usage.ts
│   │   │   ├── plugin.ts
│   │   │   └── config.ts
│   │   ├── interactions/
│   │   │   ├── permission-buttons.ts
│   │   │   └── modals.ts
│   │   └── events/
│   │       ├── messageCreate.ts
│   │       └── ready.ts
│   ├── claude/
│   │   ├── runner.ts            # spawn / stdin·stdout 관리
│   │   ├── streamParser.ts      # stream-json 라인 파서
│   │   ├── sessionStore.ts      # ~/.claude/projects/ JSONL 어댑터
│   │   ├── permissions.ts       # CLI ↔ 봇 permission RPC
│   │   └── types.ts
│   ├── session/
│   │   ├── manager.ts           # 채널↔세션 매핑, 큐
│   │   ├── topicCodec.ts        # 채널 토픽에 메타 직렬화
│   │   └── lifecycle.ts         # idle 종료, 재개, 정리
│   ├── ui/
│   │   ├── embedBuilder.ts      # 응답 임베드
│   │   ├── streamingMessage.ts  # 점진적 edit 추상화
│   │   ├── threadRouter.ts      # 도구별 스레드 분리
│   │   └── permissionPrompt.ts
│   ├── usage/
│   │   ├── tracker.ts
│   │   ├── db.ts                # better-sqlite3
│   │   └── reports.ts
│   ├── plugins/
│   │   ├── loader.ts
│   │   ├── api.ts               # PluginContext / 인터페이스
│   │   └── registry.ts
│   ├── config/
│   │   ├── schema.ts            # zod 검증
│   │   ├── load.ts              # .env + ~/.claude-discord-bot/config.json
│   │   └── defaults.ts
│   ├── util/
│   │   ├── logger.ts
│   │   ├── rateLimit.ts
│   │   └── errors.ts
│   └── types/
│       └── global.d.ts
├── plugins/                     # 빌트인 예제 플러그인
│   ├── korean-default.ts        # 모든 응답 한국어로
│   └── git-status-on-load.ts
└── test/
    ├── streamParser.test.ts
    ├── sessionStore.test.ts
    └── manager.test.ts
```

각 파일의 책임은 100~300줄 수준으로 제한하고, 부수효과(파일 IO, 네트워크)는 가장 바깥쪽에서만 발생시킨다.

---

## 5. 핵심 모듈 상세

### 5.1 `claude/runner.ts`
- 책임: `claude` 자식 프로세스 1개의 라이프사이클.
- 인터페이스
  ```ts
  class ClaudeRunner extends EventEmitter {
    constructor(opts: { cwd: string; model?: string; sessionId?: string });
    start(): Promise<void>;
    send(prompt: string): Promise<void>;        // stdin write
    sendPermission(decision: PermissionDecision): void;
    stop(signal?: NodeJS.Signals): Promise<void>;
    on(event: 'chunk', cb: (c: StreamChunk) => void): this;
    on(event: 'permission', cb: (p: PermissionRequest) => void): this;
    on(event: 'usage', cb: (u: UsageDelta) => void): this;
    on(event: 'end', cb: (final: FinalResult) => void): this;
    on(event: 'error', cb: (e: Error) => void): this;
  }
  ```
- 내부적으로 stdout을 라인 단위로 파싱(`streamParser`)해 이벤트로 흘려보냄.

### 5.2 `session/manager.ts`
- 채널 ID ↔ `ClaudeRunner` 매핑.
- 채널별 작업 큐(`p-queue`).
- idle 5분 시 runner.stop() 호출, 다음 메시지에서 `--resume`으로 자동 재기동.
- 봇 재시작 시 모든 세션 채널 토픽을 읽어 매핑 재구성 (lazy: 메시지 들어올 때까지 spawn 안 함).

### 5.3 `claude/sessionStore.ts`
- `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` 위치 추적.
- 새 세션 ID 발급·기존 세션 메타 조회.
- CLI가 갱신하는 파일을 우리는 **읽기만** 함. 쓰기는 항상 CLI에 위임 (호환성 깨지지 않도록).

### 5.4 `ui/streamingMessage.ts`
- 추상 인터페이스
  ```ts
  class StreamingMessage {
    constructor(channel: TextChannel);
    appendText(s: string): void;     // 누적 + debounce flush
    setTool(toolName: string | null): void;
    setUsage(u: Usage): void;
    finalize(): Promise<void>;
  }
  ```
- 내부 flush는 `setTimeout(throttle, 350)` 기반.
- 4096자 초과 시 새 메시지로 분기, 코드블록 fence는 자동 닫고 열기.

### 5.5 `claude/permissions.ts`
- CLI의 stream-json `permission_request` 이벤트를 받아 UI에 prompt 띄움.
- 사용자 응답을 받아 stdin에 `{"type":"permission_decision","id":"...","decision":"allow"}` 같은 라인을 보냄.
- 30초 timeout → 자동 거부, 알림 채널 ping.

### 5.6 `usage/tracker.ts`
- `runner.on('usage')` 구독.
- SQLite에 batched insert (1초 단위).
- `/cdb usage` 호출 시 집계 쿼리 실행.

### 5.7 `plugins/loader.ts`
- chokidar로 `~/.claude-discord-bot/plugins` 감시.
- import는 `await import(pathToFileURL(file).href + '?v=' + Date.now())`로 캐시 무효화 (핫 리로드).
- 잘못된 플러그인은 격리(try/catch)하고 `#📋-control`에 에러 알림.

---

## 6. 설정 / 보안

### 6.1 `.env`
```
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_GUILD_ID=...           # 개발용. 비우면 글로벌 등록
ALLOWED_USER_IDS=123,456       # 화이트리스트
DEFAULT_MODEL=sonnet
DEFAULT_LANG=ko
CLAUDE_BIN=claude              # PATH 또는 절대경로
```

### 6.2 `~/.claude-discord-bot/config.json`
- 길드별 prefix·기본 모델·기본 cwd·플러그인 enable 목록 등.

### 6.3 보안 가드
- **유저 화이트리스트 강제** (default-deny). DM/길드 모두 적용.
- 슬래시 커맨드는 `default_member_permissions = ManageChannels` 등으로 추가 보호.
- Discord 메시지를 그대로 shell에 넣지 않음. 모든 prompt는 stdin write로만 전달 (인자 주입 차단).
- `.env`·`config.json`·DB는 모두 `~/.claude-discord-bot/`에 0600 퍼미션으로 저장.
- 도구 권한 승인 결정은 절대 자동화하지 않음 (timeout = 거부).
- Discord에서 지정하는 세션 cwd와 디렉토리 브라우저 탐색은 `DEFAULT_CWD` 아래로 제한.
- Discord 첨부 파일은 HTTPS Discord CDN URL, 개수 제한, 크기 제한을 통과해야 저장.
- `/cdb plugin enable`은 안전한 플러그인 이름만 허용하고 플러그인 디렉토리 밖의 파일 로드를 거부.
- 로그에 토큰·민감 stdout 마스킹.

---

## 7. 에러 처리 & 관찰성

| 시나리오 | 처리 |
|---|---|
| `claude` 바이너리 없음 | 부팅 시 `which claude` 검사, 실패 시 명확한 안내 후 종료 |
| 자식 프로세스 비정상 종료 | exit code·stderr 마지막 50줄을 채널에 임베드로 보고 후 자동 재기동 (3회 backoff) |
| Discord rate limit 429 | `discord.js` 내장 큐 + 우리 throttle. 50% 사용 시 경고 로그 |
| 메시지 4096 초과 | 새 메시지로 분기, 코드블록 fence 자동 처리 |
| 권한 응답 timeout | 거부 + alerts 채널 ping |
| SQLite write 실패 | 인메모리 버퍼로 fallback, 다음 성공 시 flush |

로그는 `pino` 또는 표준 `console`로 JSON 라인 출력, `~/.claude-discord-bot/logs/` 회전.

---

## 8. 테스트 전략

- **단위 테스트** (`vitest`): `streamParser`, `sessionStore`, `topicCodec`, `rateLimit`.
- **통합 테스트**: 실제 `claude` 바이너리 대신 fake binary 스크립트(`test/fixtures/fake-claude.ts`)를 spawn 하여 stream-json 시뮬레이션.
- **Discord 측은 모킹** (`discord.js` Client mock). 봇 토큰 없이도 CI 가능.
- 수동 검증 체크리스트(`test/MANUAL.md`)에 권한 버튼·스트리밍·다중 채널 시나리오 명세.

---

## 9. 단계별 구현 로드맵

| 단계 | 산출물 | 검증 |
|---|---|---|
| **M0. Skeleton** | `package.json`, tsconfig, lint, `.env.example`, `bin/cdb.ts` 부팅 가능 | `npx cdb --version` |
| **M1. Discord 연결** | 클라이언트 로그인, `/cdb status` 만 동작 | 슬래시 커맨드 응답 OK |
| **M2. claude runner** | 단일 채널에서 prompt 전송, stream-json 파싱, 임베드에 출력 | 한 채널에서 1턴 대화 성공 |
| **M3. 세션 매니저** | 채널 1:1 세션, idle 종료/재개, 토픽 인코딩 | 봇 재시작 후 `/cdb resume` 으로 이어지기 |
| **M4. 권한 UI** | 버튼 4종 + 모달 편집, timeout 처리 | Bash 도구 승인 플로우 통과 |
| **M5. 도구 스레드 분리** | `messageCreate` → 도구별 thread 라우팅 | 두 도구 동시 호출 시 분리 표시 |
| **M6. 사용량 트래커** | SQLite, `/cdb usage` | 일/주/월 리포트 정확성 |
| **M7. `/cdb init` 채널 자동 구성** | 카테고리·채널 생성, 권한 설정 | 빈 길드에서 1커맨드로 셋업 |
| **M8. 플러그인 시스템** | 로더, 핫 리로드, 빌트인 한국어 플러그인 | 플러그인 추가/삭제 핫 반영 |
| **M9. 다듬기** | 에러 메시지 한국어화, README, 셋업 가이드 | 처음 사용자가 30분 내 셋업 |

각 단계는 별도 PR/커밋으로 분리하고, M2까지가 가장 먼저 동작 가능한 MVP 컷이다.

---

## 10. 열린 질문 (구현 전 결정 필요)

1. **`claude` 의 stream-json 입출력 스키마는 버전마다 다를 수 있다.** 호환되는 최소 버전을 명시하고, 부팅 시 `claude --version`으로 검사할지?
2. **세션 ID를 우리가 생성할지, CLI가 발급한 것을 받을지?** — CLI 발급 ID를 사용하는 쪽이 호환성에 안전. runner 시작 후 첫 이벤트에서 ID를 캡처하는 방식 권장.
3. **권한 요청을 채널·스레드·DM 중 어디에 띄울지?** — 디폴트는 세션 채널. 옵션으로 DM fallback.
4. **여러 길드 지원 여부** — 본 설계는 단일 사용자 셀프호스트 가정. 멀티 길드는 가능하지만 화이트리스트가 길드별로 분리돼야 함.
5. **MCP 서버를 봇 쪽에서도 다룰지** — 이번 단계에서는 비포함, CLI에 위임.

---

## 11. 다음 액션

1. 본 설계서 검토 후 피드백 반영.
2. M0 (Skeleton) 부터 구현 시작 — `package.json`, tsconfig, `bin/cdb.ts`, 디렉토리 골격.
3. 실제 `claude --output-format stream-json` 의 정확한 스키마 샘플을 캡처해 `claude/types.ts` 확정.
