# Claude Discord Bot — Agent4Discord 기능 대조 보고서

> 작성일: 2026-05-16
> 기준: Velog 글 및 `raravel/Agent4Discord` README 기능표

## 목표

붙여넣은 링크의 기능대로 이 프로젝트가 동작하는지 검증하고, 로컬에서 확인 가능한 결함과 누락 기능을 수정한다.

## 기능 대조

| 기준 기능 | 현재 상태 | 증거 |
|---|---|---|
| Directory Browser | 구현 | `/cdb browse`, `src/ui/directoryBrowser.ts` |
| 폴더 생성 | 구현 | `폴더 생성` 모달, `sanitizeDirectoryName()` 테스트 |
| 모델 선택 | 구현 | `/cdb browse`, `/cdb new`, `/cdb model` |
| Permission mode 선택 | 구현 | `/cdb browse permission_mode`, `/cdb new permission_mode`, runner `--permission-mode` |
| 실시간 text/thinking streaming | 구현 | `--include-partial-messages`, `StreamingMessage.appendThinking()` |
| Tool call threads | 구현 | `ThreadRouter`, 첫 streaming message parent 연결 |
| Tool output thread posting | 구현 | `postToolResult()` |
| Safe tool auto allow | 구현 | `autoAllowSafeTool()` |
| Permission buttons | 구현 | `항상 허용 / 한 번만 / 거부`, 60초 timeout deny |
| Discord attachments -> Claude | 구현 | 첨부 다운로드 후 로컬 경로 프롬프트 전달 |
| Claude Write output -> Discord | 구현 | `Write.file_path` 추적 후 도구 스레드 첨부 |
| Completion notification | 구현 | 응답 종료 후 사용자 mention reply |
| Session resume | 구현 | `/cdb resume`, channel topic restore, CLI `--resume` |
| CLI JSONL interop | 구현 | `src/claude/sessionStore.ts`, `~/.claude/projects` 조회 |
| Usage/rate-limit tracker | 구현 | SQLite 저장, final usage 중복 방지, `/cdb usage`, usage 채널 자동 게시 |
| Plugin support/hot reload | 구현 | `PluginLoader`, chokidar, `/cdb plugin list/reload/enable/disable` |
| Setup wizard | 구현 | `cdb setup`, `.env` 생성, AttachFiles/threads 권한 포함 invite URL 출력 |
| Doctor | 구현 | `.env`, full config schema, Claude CLI, slash command schema 점검 |
| `/close` deletes session channel | 구현 | `/cdb close` |

## 검증 결과

로컬에서 실행한 검증:

```text
npm run typecheck -> passed
npm test          -> 15 files, 44 tests passed
npm run build     -> passed
npm run verify    -> passed
npm start         -> built cdb run entrypoint reached; prints setup/doctor guidance when .env is missing
npm run register  -> prints setup/doctor guidance when .env is missing
npm run e2e:manual -> runs doctor first; stops before checklist while .env is missing
node dist/bin/cdb.js doctor:
  FAIL .env: /Users/suhyl/Project/claude-discord-bot/.env not found; run cdb setup
  OK claude: 2.1.104 (Claude Code)
  OK slash commands: status, init, browse, new, resume, model, stop, close, usage, plugin, config
```

## 테스트 범위

| 테스트 파일 | 대상 |
|---|---|
| `test/attachments.test.ts` | 첨부 저장 경로, Write output attachment guard |
| `test/commandSchema.test.ts` | `/cdb` slash command schema |
| `test/configLoad.test.ts` | config error setup/doctor guidance |
| `test/directoryBrowser.test.ts` | 폴더 생성 입력 sanitize |
| `test/doctor.test.ts` | doctor checks, full runtime config schema validation |
| `test/e2eManual.test.ts` | manual e2e command exposure |
| `test/permissionPrompt.test.ts` | safe tool auto allow |
| `test/pluginLoader.test.ts` | named plugin load |
| `test/runner.test.ts` | Claude CLI args, partial text/thinking, tool result parsing, final usage flag |
| `test/setup.test.ts` | env rendering, invite URL scopes/file/thread permissions, next-step command text |
| `test/streamParser.test.ts` | stream-json line parser |
| `test/streamingMessage.test.ts` | embed chunking, first message callback |
| `test/threadRouter.test.ts` | 도구 결과 파일 첨부 전 파일 존재/크기 필터 |
| `test/topicCodec.test.ts` | channel topic encode/decode and empty session ID restore |
| `test/usageTracker.test.ts` | final result usage를 authoritative total로 처리 |

## 남은 미검증 항목

실제 Discord end-to-end는 현재 `.env`가 없어 실행하지 못했다. `node dist/bin/cdb.js doctor`가 이 차단 조건을 재현한다.

라이브 검증을 완료하려면 다음 값이 필요하다.

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `ALLOWED_USER_IDS`
- 가능하면 `DISCORD_GUILD_ID`

## 라이브 e2e 체크리스트

1. `npm run setup` 또는 `node dist/bin/cdb.js setup`으로 `.env` 작성
2. `npm run doctor` 또는 `node dist/bin/cdb.js doctor`가 모두 OK인지 확인
3. `npm run e2e:manual`로 수동 Discord 검증 체크리스트 출력
4. `npm run register` 또는 `node dist/bin/cdb.js register`
5. 개발 모드는 `npm run run:bot`, 빌드 산출물은 `npm start` 또는 `node dist/bin/cdb.js run`
6. Discord에서 `/cdb init` 실행 후 `📁-session`, `📊-usage`, Sessions category 생성 확인
7. `/cdb browse`에서 폴더 탐색, 폴더 생성 모달, 모델 버튼, permission mode 확인
8. 생성된 세션 채널에서 봇 mention으로 Claude 응답 streaming 확인
9. tool call thread와 tool result 확인
10. 위험 tool permission button 승인/거부 확인
11. Discord 첨부 파일을 보낸 뒤 Claude가 로컬 경로를 읽는지 확인
12. Claude `Write` 결과 파일이 tool thread에 첨부되는지 확인
13. 응답 완료 mention과 usage 채널 게시 확인
14. 봇 재시작 후 `/cdb status`/`/cdb resume`으로 topic restore 확인
15. `/cdb close`가 세션 중단 후 채널을 삭제하는지 확인

## 완료 판단

코드 구현과 로컬 검증은 링크 기능표 기준으로 가능한 범위까지 완료했다. 다만 목표 문장에는 “동작하는지 검증”이 포함되어 있으므로, 실제 Discord e2e가 완료되기 전에는 최종 완료로 판단하지 않는다.
