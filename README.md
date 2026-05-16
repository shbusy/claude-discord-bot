# claude-discord-bot

자체 호스팅 Discord 봇으로, 로컬 `claude` CLI 세션을 Discord 채널에서 사용하기 위한 도구입니다.
설계 전체는 [DESIGN.md](./DESIGN.md) 참조.

## 진행 상태

- [x] M0 — Skeleton (현재)
- [ ] M1 — Discord 연결
- [ ] M2 — claude runner (MVP)
- [ ] M3 ~ M9 — DESIGN.md §9 참조

## 개발 셋업

```bash
cd ~/Project/claude-discord-bot
cp .env.example .env       # DISCORD_TOKEN 등 채우기
npm install
npm run typecheck
npm run dev -- --version   # 0.0.1
npm run dev -- run         # M0 단계: 부팅 로그만 출력
```

요구사항: Node.js ≥ 20, 로컬에 `claude` CLI 설치 (M2 부터 사용).
