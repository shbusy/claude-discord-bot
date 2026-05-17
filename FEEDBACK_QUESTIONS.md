# 사용자 피드백이 필요한 결정사항

자율 모드로 진행 중 발생한 결정사항을 모아둔다. 합리적 기본값을 적용하고 일단 코드를 진행한 뒤, 사용자 확인 시 일괄 처리.

각 항목 형식:
- **Q**: 질문
- **현재 처리**: 자율 모드에서 적용한 기본값
- **영향**: 변경 시 수정 범위
- **상태**: open / answered

---

## DESIGN.md §10 미결 이슈

### Q1. `claude` stream-json 스키마 버전 호환성
- **Q**: 어떤 `claude` CLI 최소 버전을 공식 지원할 것인가? 부팅 시 버전 검사로 강제 차단?
- **현재 처리**: 부팅 시 `claude --version` 실행해 로그로 출력만 함(차단 없음). 실제 스키마는 M2에서 `--output-format stream-json`을 spawn 해 캡처한 결과를 바탕으로 `claude/types.ts`에 반영. 환경: 현재 호스트는 `claude 2.1.138 (Claude Code)` 확인.
- **영향**: 차단 정책 도입 시 `src/claude/runner.ts` 부팅 가드 추가 필요.
- **상태**: open

### Q2. 세션 ID 발급 주체
- **Q**: 봇이 UUID 발급할지, CLI가 발급한 것을 캡처할지?
- **현재 처리**: 설계 권고대로 **CLI 발급 ID 캡처**. runner 첫 이벤트의 `session_id` 필드를 잡아 채널 토픽에 저장.
- **영향**: 변경 시 `runner.ts`/`sessionStore.ts` 시작 시점 수정.
- **상태**: open (권고 그대로 진행)

### Q3. 권한 요청 UI 위치
- **Q**: 채널/스레드/DM 중 어디에 띄울지?
- **현재 처리**: 디폴트 = 세션 채널. config의 `permissionUiTarget: 'channel' | 'thread' | 'dm'`로 전환 가능하게 구현. DM 실패 시 `#🔔-alerts` 채널 fallback.
- **영향**: `ui/permissionPrompt.ts`에서 분기.
- **상태**: open (channel 디폴트 유지)

### Q4. 멀티 길드 지원
- **Q**: 단일 길드 셀프호스트 vs 다중 길드?
- **현재 처리**: **단일 길드 가정**. 화이트리스트(`ALLOWED_USER_IDS`)는 글로벌. 길드별 분리 미구현.
- **영향**: 다중 길드 도입 시 `config/schema.ts`에 길드별 설정 추가 + 명령 라우팅 변경.
- **상태**: open

### Q5. MCP 봇 측 처리 여부
- **Q**: 봇 자체가 MCP 서버를 구성할지?
- **현재 처리**: 미구현. CLI에 위임. 봇은 stream-json으로 결과만 표시.
- **상태**: open (위임 정책 유지)

---

## 추가 결정사항 (구현 중 발견)

### Q6. Discord intents 범위
- **Q**: `MessageContent` privileged intent를 켤지?
- **현재 처리**: 켠다. Bot 설정에서 Developer Portal에 활성화 필요. README에 명시. 끄면 일반 메시지 본문을 못 읽어 세션 채널 흐름이 동작하지 않음.
- **상태**: open (켜는 정책 유지)

### Q7. 슬래시 커맨드 등록 범위
- **Q**: 글로벌 vs 길드 등록?
- **현재 처리**: `DISCORD_GUILD_ID` 있으면 길드(즉시 반영, 개발용), 없으면 글로벌(전파 ~1h).
- **상태**: open

### Q8. idle 종료 시간
- **Q**: claude runner를 몇 분 idle 후 종료할지?
- **현재 처리**: 5분(설계 §5.2). config로 `idleTimeoutMs` 노출.
- **상태**: open

### Q9. 사용량 비용 산정 모델
- **Q**: stream-json `usage`에 cost USD가 직접 들어오지 않으면 모델별 단가표를 봇이 들고 있어야 하는데, 단가는 변동됨. 어디서 가져올지?
- **현재 처리**: **고정 단가 테이블**을 `src/usage/pricing.ts`에 하드코드(2026-05 기준). CLI가 cost를 직접 주면 그 값 우선. 단가 갱신은 수동.
- **상태**: open

### Q10. 권한 timeout 기본값
- **Q**: 30초가 너무 짧을 수 있음(폰 알림 → 디스코드 진입 시간).
- **현재 처리**: 60초로 상향. config로 `permissionTimeoutMs` 노출.
- **상태**: open

### Q11. 봇 화이트리스트 미설정 시 동작
- **Q**: `ALLOWED_USER_IDS`가 비어있으면 부팅 거부 vs 모두 허용?
- **현재 처리**: **부팅 거부**. 보안 가드(설계 §6.3)와 일관.
- **상태**: open

---

## 진행 로그

- 2026-05-10: M0 완료 (Skeleton). M1~M9 자율 진행 시작.
- 2026-05-16: M3 완료 (세션 매니저). SessionManager, topicCodec, sessionStore, resume/model/stop 커맨드 구현.
- 2026-05-16: M4 완료 (권한 UI). permissionPrompt 버튼 3종(승인/한번만/거부) + 타임아웃 자동 거부.
- 2026-05-16: M5 완료 (도구 스레드 분리). ThreadRouter로 도구별 스레드 분기.
- 2026-05-16: M6 완료 (사용량 트래커). SQLite DB, UsageTracker, /cdb usage 커맨드.
- 2026-05-16: M7 완료 (채널 구조). /cdb init + /cdb new 구현.
- 2026-05-16: M8 완료 (플러그인 시스템). PluginRegistry, PluginLoader, chokidar 핫 리로드, /cdb plugin 커맨드.
- 2026-05-16: M9 완료 (다듬기). /cdb config, BotError, rateLimit 유틸리티. 모든 stub 커맨드 실구현 교체.
