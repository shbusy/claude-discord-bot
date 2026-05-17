# M3: 세션 매니저 구현

## 목적
채널 1:1 세션 매핑, idle 종료/재개, 채널 토픽 메타데이터 인코딩을 구현하여
다중 채널에서 독립 세션을 운영할 수 있도록 한다. 봇 재시작 시에도 토픽에서
세션 매핑을 복원하는 lazy 방식.

## 변경 파일 목록

### 신규 생성
- `src/session/topicCodec.ts` — 채널 토픽 JSON 인코딩/디코딩
- `src/session/manager.ts` — SessionManager 클래스 (채널↔Runner 매핑, p-queue, idle 타이머)
- `src/session/lifecycle.ts` — idle 종료, resume 재기동 헬퍼
- `src/claude/sessionStore.ts` — ~/.claude/projects/ 세션 파일 조회
- `src/bot/commands/resume.ts` — /cdb resume 구현
- `src/bot/commands/model.ts` — /cdb model 구현 (stub 교체)
- `src/bot/commands/stop.ts` — /cdb stop 구현 (stub 교체)
- `test/topicCodec.test.ts` — topicCodec 단위 테스트
- `test/manager.test.ts` — SessionManager 단위 테스트

### 수정
- `src/config/schema.ts` — `idleTimeoutMs`, `defaultCwd` 추가
- `src/config/load.ts` — 환경변수 매핑 추가
- `src/bot/types.ts` — AppContext에 sessionManager 추가
- `src/index.ts` — SessionManager 생성 및 주입
- `src/bot/events/messageCreate.ts` — SessionManager 사용으로 전환
- `src/bot/commands/index.ts` — stub → 실제 구현으로 교체
- `src/bot/commands/status.ts` — 세션 정보 표시 추가

## 변경 내용 요약

### topicCodec
- `encode(meta: SessionMeta): string` — JSON을 채널 토픽에 삽입 (`[CDB:{"sessionId":...}]`)
- `decode(topic: string): SessionMeta | null` — 토픽에서 메타 추출
- SessionMeta: `{ sessionId, cwd, model, lastActiveAt }`

### sessionStore
- `findSession(sessionId): string | null` — ~/.claude/projects/ 하위에서 JSONL 파일 존재 확인
- `listSessions(cwd): SessionInfo[]` — 특정 cwd의 세션 목록 조회

### SessionManager
- 채널 ID → `{ runner, queue, meta, idleTimer }` Map
- `getOrCreate(channelId, opts)` — runner가 없으면 spawn, 있으면 기존 반환
- `send(channelId, prompt)` — 큐에 enqueue하여 순차 처리
- `stop(channelId)` — runner에 SIGINT
- `setModel(channelId, model)` — 다음 spawn부터 적용
- idle 타이머: 설정 시간(기본 5분) 경과 시 runner.stop() → 다음 메시지에서 --resume

### 커맨드
- `/cdb resume [session_id]` — 채널에 특정 세션 연결
- `/cdb model <opus|sonnet|haiku>` — 채널 모델 변경
- `/cdb stop` — 현재 채널 runner 중단

## 체크리스트
- [ ] topicCodec encode/decode 왕복 테스트
- [ ] SessionManager 생성/종료/재개 테스트
- [ ] messageCreate가 SessionManager를 통해 동작
- [ ] resume/model/stop 커맨드 동작
- [ ] typecheck 통과
- [ ] 기존 테스트 깨지지 않음
