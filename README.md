# Claude Discord Bot (CDB)

폰에서도, 외출 중에도 — Discord 채널에서 내 PC의 Claude Code를 그대로 쓴다.

로컬에서 실행 중인 `claude` CLI를 Discord 봇이 자식 프로세스로 호출한다. Anthropic API 키가 필요 없고, 기존 Claude Code 구독을 그대로 활용한다.

```
폰(Discord 앱) ──▶ Discord 서버 ──▶ 봇(내 PC) ──▶ claude CLI
```

---

## 목차

- [주요 기능](#주요-기능)
- [사전 준비](#사전-준비)
- [1단계: Discord 봇 생성](#1단계-discord-봇-생성)
- [2단계: 프로젝트 설치](#2단계-프로젝트-설치)
- [3단계: 환경 설정](#3단계-환경-설정)
- [4단계: 슬래시 커맨드 등록](#4단계-슬래시-커맨드-등록)
- [5단계: 봇 실행](#5단계-봇-실행)
- [사용법](#사용법)
- [커맨드 레퍼런스](#커맨드-레퍼런스)
- [플러그인](#플러그인)
- [설정 옵션 전체](#설정-옵션-전체)
- [아키텍처](#아키텍처)
- [문제 해결](#문제-해결)

---

## 주요 기능

| 기능 | 설명 |
|---|---|
| **채널 = 세션** | 각 Discord 채널이 독립된 Claude 세션. 다중 프로젝트 동시 작업 |
| **디렉토리 브라우저** | `/cdb browse`에서 셀렉트 메뉴로 폴더를 탐색·생성하고 모델·권한 모드를 골라 세션 시작 |
| **실시간 스트리밍** | 응답을 임베드로 점진적 표시. 토큰 단위가 아닌 chunk+debounce |
| **도구 스레드 분리** | `Bash`, `Edit` 등 도구 호출을 별도 스레드로 분리해 메인 채널 깔끔 유지 |
| **권한 승인 버튼** | 안전한 읽기 도구는 자동 허용, 위험 도구는 Discord 버튼으로 승인/거부. 60초 무응답 시 자동 거부 |
| **파일 첨부 전달** | Discord 첨부 파일을 로컬에 저장하고 Claude에게 파일 경로를 전달. Claude가 `Write`로 만든 파일은 도구 스레드에 첨부 |
| **사용량 추적** | SQLite에 토큰/비용 저장. `#usage` 채널 게시와 일/주/월 단위 리포트 |
| **세션 재개** | `--resume`으로 이전 대화 이어가기. 봇 재시작 후에도 채널 토픽에서 복원 |
| **idle 자동 종료** | 5분 무응답 시 프로세스 종료. 다음 메시지에서 자동 재기동 |
| **플러그인 핫 리로드** | `~/.claude-discord-bot/plugins/`에 파일 추가하면 즉시 반영 |
| **채널 자동 구성** | `/cdb init` 한 번으로 카테고리·채널 구조 생성 |

---

## 사전 준비

| 항목 | 요구사항 |
|---|---|
| **Node.js** | v20 이상 |
| **claude CLI** | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 설치 및 로그인 완료 |
| **Discord 계정** | 봇을 추가할 서버의 관리자 권한 |

```bash
# claude CLI가 정상 동작하는지 확인
claude --version
claude -p "hello" --output-format stream-json
```

---

## 1단계: Discord 봇 생성

### 1-1. 애플리케이션 생성

1. [Discord Developer Portal](https://discord.com/developers/applications) 접속
2. **New Application** 클릭 → 이름 입력 (예: `Claude Code Bot`)
3. 왼쪽 **General Information**에서 **Application ID** 복사 → 메모

### 1-2. 봇 토큰 발급

1. 왼쪽 메뉴 **Bot** 클릭
2. **Reset Token** → 토큰 복사 → 메모 (이후 다시 볼 수 없음)
3. 아래 **Privileged Gateway Intents** 섹션에서 다음 3개를 **ON**:
   - `PRESENCE INTENT` — 선택 사항
   - `SERVER MEMBERS INTENT` — 선택 사항
   - **`MESSAGE CONTENT INTENT` — 필수** (봇이 메시지 본문을 읽어야 함)

### 1-3. 봇을 서버에 초대

1. 왼쪽 **OAuth2** → **URL Generator**
2. **Scopes**: `bot`, `applications.commands` 체크
3. **Bot Permissions**:
   - `Send Messages`
   - `Send Messages in Threads`
   - `Embed Links`
   - `Attach Files`
   - `Manage Channels`
   - `Manage Threads`
   - `Read Message History`
   - `Use Slash Commands`
   - `Add Reactions`
4. 생성된 URL을 브라우저에 붙여넣고 서버 선택 → **승인**

### 1-4. 내 사용자 ID 확인

1. Discord 설정 → 고급 → **개발자 모드** ON
2. 내 프로필 우클릭 → **ID 복사** → 메모

---

## 2단계: 프로젝트 설치

```bash
git clone https://github.com/<your-repo>/claude-discord-bot.git
cd claude-discord-bot
npm install
```

---

## 3단계: 환경 설정

```bash
npm run setup
```

설정 마법사는 `.env`를 만들고 Discord 봇 초대 URL을 출력한다. Discord Developer Portal에서 **Message Content Intent**를 켜야 메시지 본문을 읽을 수 있다.

이미 `.env`를 직접 관리하고 싶다면:

```bash
cp .env.example .env
```

`.env` 파일을 열어 값을 채운다:

```env
# [필수] 1단계에서 복사한 값들
DISCORD_TOKEN=MTIzNDU2Nzg5MDEyMzQ1Njc4OQ.XXXXXX.XXXXXXXXXXXXXXXXXXXXXXXX
DISCORD_CLIENT_ID=123456789012345678

# [필수] 봇을 사용할 Discord 사용자 ID (콤마 구분)
ALLOWED_USER_IDS=987654321098765432

# [권장] 길드(서버) ID — 커맨드가 즉시 반영됨 (개발용)
DISCORD_GUILD_ID=111222333444555666

# [선택] 기본값이 적절하면 생략 가능
CLAUDE_BIN=claude
DEFAULT_MODEL=sonnet
DEFAULT_CWD=/Users/me/projects
PERMISSION_MODE=default
IDLE_TIMEOUT_MS=3300000
```

> **보안**: `ALLOWED_USER_IDS`가 비어있으면 봇이 부팅을 거부한다. 반드시 본인 ID를 넣어야 한다. Discord에서 지정하는 세션 경로와 폴더 탐색은 `DEFAULT_CWD` 아래로 제한된다.

사전조건을 확인하려면:

```bash
npm run doctor
```

---

## 4단계: 슬래시 커맨드 등록

Discord에 `/cdb`와 Agent4Discord 호환 `/a4d` 슬래시 커맨드를 등록한다. **최초 1회** 또는 커맨드가 변경될 때 실행:

```bash
npm run register
```

- `DISCORD_GUILD_ID`가 설정되어 있으면 **해당 서버에만 즉시 등록**
- 비어있으면 **글로벌 등록** (전파에 최대 1시간 소요)

---

## 5단계: 봇 실행

```bash
# 개발 모드 (tsx로 직접 실행)
npm run run:bot

# 또는 빌드 후 실행
npm run build
npm start
```

정상 부팅 시 다음 로그가 출력된다:

```
{"level":30,"msg":"✅ Discord 로그인 완료","tag":"Claude Code Bot#1234","id":"..."}
```

실제 Discord 동작 검증 체크리스트를 보려면:

```bash
npm run e2e:manual
```

---

## 사용법

### 기본 대화

세션 채널에 메시지를 보내면 대화가 시작된다 (멘션 불필요, `usage` 채널 제외):

```
이 프로젝트의 README를 작성해줘
```

`REQUIRE_MENTION=true`로 두면 예전처럼 `@봇` 멘션한 메시지에만 반응한다.

봇이 `claude` CLI를 spawn하고, 응답을 임베드로 실시간 스트리밍한다.

### 채널 구조 자동 생성

```
/cdb init
```

다음 구조가 자동으로 만들어진다:

```
General
 ├─ #general
 ├─ #session
 └─ #usage

Sessions
 ├─ #frontend
 ├─ #api
 └─ ...
```

### 세션 채널 만들기

셀렉트 메뉴로 폴더를 탐색하려면:

```
/cdb browse path:/Users/me/projects permission_mode:default
```

폴더를 선택한 뒤 `sonnet`, `opus`, `haiku` 버튼 중 하나를 누르면 Sessions 카테고리에 세션 채널이 생성된다. `폴더 생성` 버튼으로 현재 경로 아래에 하위 폴더를 만들 수 있다. `permission_mode`는 `default`, `acceptEdits`, `auto`, `dontAsk`, `plan` 중에서 고를 수 있다.

경로를 직접 지정하려면:

```
/cdb new name:frontend path:/Users/me/project/frontend model:opus permission_mode:default
```

Sessions 카테고리에 `#frontend` 채널이 생성되고, 해당 채널에서 봇을 멘션하면 지정한 디렉토리에서 Claude가 동작한다.

### 도구 권한 승인

Claude가 `Bash`, `Write` 등 도구를 호출하면 승인 프롬프트가 표시된다:

```
┌────────────────────────────────────┐
│ 🔐 도구 사용 권한 요청              │
│ Tool: Bash                         │
│ Risk: medium                       │
│                                    │
│ {"command": "npm install lodash"}  │
│                                    │
│ [✅ 승인] [🔁 한 번만] [❌ 거부]    │
│                                    │
│ 60초 내 응답 없으면 자동 거부       │
└────────────────────────────────────┘
```

- **✅ 승인** — 이 도구를 허용
- **🔁 한 번만** — 이번 호출만 허용
- **❌ 거부** — 실행 거부
- **타임아웃** — 60초 무응답 시 자동 거부

### 세션 재개

봇을 재시작하거나 idle로 종료된 후에도 대화를 이어갈 수 있다. `session_id`를 생략하면 현재 채널 메타데이터 또는 현재 cwd의 최신 Claude JSONL 세션을 사용한다:

```
/cdb resume
/cdb resume session_id:abc-123-def
```

### 사용량 확인

```
/cdb usage period:week
```

```
📊 사용량 리포트 — 이번 주
Input 토큰: 125,430
Output 토큰: 43,210
총 비용: $1.2340
요청 수: 47

모델별 분포:
  sonnet: in 100,000 / out 35,000 ($0.8500)
  opus: in 25,430 / out 8,210 ($0.3840)
```

---

## 커맨드 레퍼런스

Agent4Discord 호환을 위해 아래 `/cdb ...` 명령은 `/a4d ...`로도 동일하게 사용할 수 있다.

| 커맨드 | 인자 | 설명 |
|---|---|---|
| `/cdb status` | — | 봇 업타임, 현재 채널의 세션 정보, runner 상태 |
| `/cdb init` | — | 길드에 카테고리·채널 구조 자동 생성 |
| `/cdb browse` | `path?` `permission_mode?` | 셀렉트 메뉴로 작업 폴더 탐색 후 모델 선택과 세션 채널 생성 |
| `/cdb new` | `name?` `path?` `model?` `permission_mode?` | Sessions 카테고리에 새 세션 채널 생성 |
| `/cdb resume` | `session_id?` | 채널의 세션 재개 (미지정 시 채널 메타데이터 또는 현재 cwd의 최신 세션) |
| `/cdb model` | `model` | 채널 기본 모델 변경 (`opus` / `sonnet` / `haiku`). 실행 중 응답에는 영향 없고 다음 메시지부터 적용 |
| `/cdb stop` | — | 진행 중인 응답 중단 (SIGINT) |
| `/cdb close` | — | 세션 중단 후 현재 세션 채널 삭제 |
| `/cdb usage` | `period?` | 사용량 리포트 (`day` / `week` / `month`) |
| `/cdb plugin` | `action` `name?` | 플러그인 관리 (`list` / `reload` / `enable` / `disable`) |
| `/cdb config` | — | 현재 봇 설정 조회 |

---

## 플러그인

### 플러그인 디렉토리

```
~/.claude-discord-bot/plugins/
```

이 디렉토리에 `.js` 또는 `.ts` 파일을 추가하면 자동으로 로드된다. 파일을 수정하면 핫 리로드된다. 빌드된 `node dist/...` 런타임에서는 `.js` 플러그인을 권장한다.

### 플러그인 인터페이스

```ts
import type { Plugin } from 'claude-discord-bot/src/plugins/api';

const plugin: Plugin = {
  name: 'my-plugin',
  version: '1.0.0',

  async onLoad(ctx) {
    ctx.log.info('플러그인 로드됨');
  },

  async onUnload() {
    // 정리 작업
  },

  hooks: {
    async onUserMessage(msg, ctx) {
      // 메시지 전처리
      return { handled: false };
    },
  },
};

export default plugin;
```

### 관리 커맨드

```
/cdb plugin action:list        # 로드된 플러그인 목록
/cdb plugin action:reload      # 전체 다시 로드
```

---

## 설정 옵션 전체

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `DISCORD_TOKEN` | — | **(필수)** Discord 봇 토큰 |
| `DISCORD_CLIENT_ID` | — | **(필수)** Discord 애플리케이션 ID |
| `ALLOWED_USER_IDS` | — | **(필수)** 허용 사용자 ID, 콤마 구분 |
| `DISCORD_GUILD_ID` | — | 길드 ID. 지정 시 커맨드 즉시 등록 |
| `CLAUDE_BIN` | `claude` | claude CLI 경로 또는 바이너리명 |
| `DEFAULT_MODEL` | `sonnet` | 기본 모델 (`opus` / `sonnet` / `haiku`) |
| `PERMISSION_MODE` | `default` | Claude 권한 모드 (`acceptEdits` / `auto` / `default` / `dontAsk` / `plan`) |
| `DEFAULT_LANG` | `ko` | 답변 언어 |
| `THINKING_LANG` | `off` | thinking 언어 강제. `off`면 모델에 맡김(권장). `ko`로 두면 thinking도 한국어가 되지만 출력 토큰이 늘어난다 |
| `REQUIRE_MENTION` | `false` | `true`면 `@멘션`한 메시지에만 반응. `false`면 허용된 사용자의 모든 메시지에 반응(usage 채널 제외) |
| `DEFAULT_CWD` | `$HOME` | 기본 작업 디렉토리. Discord에서 지정하는 세션 경로는 이 경로 아래로 제한 |
| `IDLE_TIMEOUT_MS` | `3300000` | 대기 중인 Claude 프로세스 종료 시간 (ms). 프롬프트 캐시 TTL(1h)보다 짧게 유지 |
| `CDB_HOME` | `~/.claude-discord-bot` | 데이터·로그·플러그인 디렉토리 |
| `LOG_LEVEL` | `info` | 로그 레벨 (`debug` / `info` / `warn` / `error`) |

---

## 아키텍처

```
┌─────────────┐     Discord Gateway     ┌──────────────────────────┐
│  유저 (폰)   │ ──────────────────────▶ │    Discord 서버/채널      │
└─────────────┘                         └────────────┬─────────────┘
                                                     │
                                                     ▼
                                        ┌──────────────────────────┐
                                        │   claude-discord-bot     │
                                        │                          │
                                        │  ┌─ SessionManager       │
                                        │  │   채널↔Runner 매핑    │
                                        │  │   메시지 큐 (직렬화)   │
                                        │  │   idle 타이머          │
                                        │  │                       │
                                        │  ├─ StreamingMessage     │
                                        │  │   임베드 점진적 편집   │
                                        │  │                       │
                                        │  ├─ ThreadRouter         │
                                        │  │   도구별 스레드 분리   │
                                        │  │                       │
                                        │  ├─ PermissionPrompt     │
                                        │  │   버튼 UI + 타임아웃   │
                                        │  │                       │
                                        │  ├─ UsageTracker         │
                                        │  │   SQLite 저장          │
                                        │  │                       │
                                        │  └─ PluginLoader         │
                                        │      핫 리로드            │
                                        └────────────┬─────────────┘
                                                     │ stdin/stdout
                                                     │ (stream-json)
                                                     ▼
                                        ┌──────────────────────────┐
                                        │     claude CLI           │
                                        │     (자식 프로세스)        │
                                        └──────────────────────────┘
```

### 핵심 설계 결정

- **CLI subprocess 방식**: Anthropic SDK가 아닌 `claude` CLI를 호출. 기존 구독·MCP·hook·도구 권한이 그대로 적용됨
- **채널 토픽에 세션 메타 저장**: 봇 재시작 시 외부 DB 없이 복원
- **per-channel 직렬 큐**: 동일 채널 동시 입력은 순차 처리, 채널 간은 독립
- **lazy spawn**: 메시지가 올 때까지 프로세스 생성 안 함

---

## 문제 해결

### `claude` 바이너리를 찾을 수 없음

```
Error: spawn claude ENOENT
```

→ `claude` CLI가 PATH에 있는지 확인. 절대 경로를 `.env`의 `CLAUDE_BIN`에 지정:

```env
CLAUDE_BIN=/usr/local/bin/claude
```

### ALLOWED_USER_IDS 부팅 거부

```
ALLOWED_USER_IDS가 비어 있습니다. 보안상 부팅을 거부합니다.
```

→ `.env`에 본인 Discord 사용자 ID를 넣어야 한다. 여러 명이면 콤마로 구분.

### 슬래시 커맨드가 안 보임

- `npm run register` 실행했는지 확인
- `DISCORD_GUILD_ID`가 없으면 글로벌 등록 → 최대 1시간 소요
- 봇에 `applications.commands` 스코프로 초대했는지 확인

### MESSAGE CONTENT INTENT 에러

봇이 메시지를 읽지 못하는 경우:

→ [Developer Portal](https://discord.com/developers/applications) → Bot → **MESSAGE CONTENT INTENT** ON

### 봇이 메시지에 반응 안 함

1. 봇이 해당 채널을 볼 수 있는지 확인 (권한)
2. `ALLOWED_USER_IDS`에 본인 ID가 있는지 확인
3. `REQUIRE_MENTION=true`라면 봇을 `@멘션`했는지 확인

### idle 후 세션이 끊겼다

정상 동작이다. 5분(기본값) 무응답 시 프로세스를 종료하고, 다음 메시지에서 `--resume`으로 자동 재기동한다. 체감상 차이 없이 대화가 이어진다.

---

## 개발

```bash
npm run run:bot             # tsx로 봇 실행
npm run doctor              # 로컬 사전조건 점검
npm run e2e:manual          # doctor 후 수동 Discord e2e 체크리스트 출력
npm run verify              # typecheck + test + build
npm run typecheck           # 타입 체크
npm test                    # vitest 실행
npm run build               # tsc 빌드
```

기술 스택: TypeScript, discord.js v14, better-sqlite3, p-queue, chokidar, pino, zod

설계 상세: [DESIGN.md](./DESIGN.md) | 구현 보고서: [docs/IMPLEMENTATION_REPORT.md](./docs/IMPLEMENTATION_REPORT.md)

---

## 라이선스

MIT
