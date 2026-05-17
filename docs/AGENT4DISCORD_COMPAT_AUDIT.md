# Agent4Discord Compatibility Audit

Source references:

- https://velog.io/@youn1201/Claude-Code-Discord-%ED%94%8C%EB%9F%AC%EA%B7%B8%EC%9D%B8%EC%9D%B4-%EB%B6%88%ED%8E%B8%ED%95%B4%EC%84%9C-%EC%A7%81%EC%A0%91-%EB%B4%87%EC%9D%84-%EB%A7%8C%EB%93%A4%EC%96%B4%EB%B2%84%EB%A0%B8%EB%8B%A4
- https://github.com/raravel/Agent4Discord

## Objective

Verify that this project provides the same practical Discord-to-Claude-Code workflow as the linked Agent4Discord project, and fix compatibility gaps found during review.

## Compatibility Checklist

| Requirement | Evidence | Status |
|---|---|---|
| Discord slash command control surface | `src/bot/commands/index.ts` registers status, init, browse, new, resume, model, stop, close, usage, plugin, config | Verified by `test/commandSchema.test.ts` |
| Agent4Discord `/a4d` command compatibility | `buildA4dCommand()` mirrors `buildCdbCommand()` and dispatch accepts both names | Fixed and verified by `test/commandSchema.test.ts` |
| Slash command registration | `src/bot/register.ts` registers both `/cdb` and `/a4d` | Verified by `npm run doctor` slash-command check and `test/register.test.ts` |
| Agent4Discord channel structure | `/a4d init` creates `A4D - General`, `#a4d-general`, `#a4d-session`, `#a4d-usage`, and `A4D - Sessions`; legacy emoji category names are still accepted as fallbacks; category overwrites allow thread/file/history/reaction workflows | Fixed by `src/bot/commands/init.ts`, `src/bot/channelNames.ts`; covered by `test/initCommand.test.ts` |
| Session close command | `/a4d close` closes the session and deletes the current text channel | Covered by `test/closeCommand.test.ts` |
| Setup invite permissions | `src/setup.ts` includes view/send/thread/embed/attach/reaction/history/application-command/manage permissions | Fixed and verified by `test/setup.test.ts` |
| Message content access | `src/bot/client.ts` requests `GatewayIntentBits.MessageContent`; Developer Portal enablement remains a manual/live prerequisite | Covered by `test/client.test.ts` and `src/e2eManual.ts` |
| Channel equals session model | `src/session/manager.ts` maps channel IDs to sessions and serializes per-channel work with `PQueue` | Covered by session/runner tests and code inspection |
| Directory browser with folder creation | `src/ui/directoryBrowser.ts` lists folders, navigates up, creates folders, and starts `a4d-*` session channels with model buttons | Covered by `test/directoryBrowser.test.ts` and command schema tests |
| Model and permission mode selection | `/cdb browse` and `/cdb new` expose `permission_mode`; `/a4d model` updates the channel model for the next message/runner spawn | Covered by `test/commandSchema.test.ts`, `test/topicCodec.test.ts`, `test/runner.test.ts`, `test/sessionManager.test.ts` |
| Claude Code stream-json runner | `src/claude/runner.ts` uses `claude -p --output-format stream-json --input-format stream-json --verbose` | Covered by `test/runner.test.ts` and `test/streamParser.test.ts` |
| Streaming Discord response | `src/ui/streamingMessage.ts` debounces edits, splits long embeds, tracks tool/usage footer | Covered by `test/streamingMessage.test.ts` |
| Tool-use thread routing | `src/ui/threadRouter.ts` creates per-tool threads and posts results/attachments | Covered by `test/threadRouter.test.ts` |
| Permission prompt buttons | `src/ui/permissionPrompt.ts` shows allow-once/always-allow/deny buttons, safe-tool auto allow, timeout deny | Covered by `test/permissionPrompt.test.ts` |
| Attachment input/output workflow | `src/util/attachments.ts` saves Discord attachments and attaches Claude `Write` results when safe | Covered by `test/attachments.test.ts` |
| Resume and topic restore | `src/session/topicCodec.ts`, `src/session/manager.ts`, and `src/claude/sessionStore.ts` preserve session metadata and support `--resume`; `/a4d resume` can fall back to the latest JSONL session for the cwd | Covered by `test/topicCodec.test.ts`, `test/runner.test.ts`, `test/resumeCommand.test.ts` |
| Usage tracking | `src/usage/tracker.ts`, `src/usage/db.ts`, `/cdb usage` persist/summarize token usage and `#a4d-usage` receives session usage/rate-limit updates | Covered by `test/usageTracker.test.ts`, `test/usageCommand.test.ts`, `test/usagePost.test.ts` |
| Claude Code plugin/auth interop | `ClaudeRunner` spawns the real `claude` CLI with the current process environment, so existing Claude Code auth, MCP, skills, hooks, and CLI-side plugins are inherited by the subprocess | Covered by `test/runner.test.ts` |
| Bot plugin loading/hot reload | `src/plugins/loader.ts`, `src/plugins/registry.ts`, `/cdb plugin` load/manage bot plugin files and execute `hooks.onUserMessage` | Covered by `test/pluginLoader.test.ts` |
| Doctor and manual e2e gate | `src/doctor.ts` validates `.env`, configured Claude CLI path, and slash command schemas; `src/e2eManual.ts` prints live Discord checklist after doctor passes | Covered by `test/doctor.test.ts`, `test/e2eManual.test.ts` |
| CLI setup/doctor/e2e/run/register path handling | `bin/cdb.ts` forwards optional env paths for setup, doctor, e2e, run, and register so generated or temporary configs can be used throughout live verification | Covered by `test/cli.test.ts`, `test/configLoad.test.ts` |

## Verification Commands

Last local verification:

```bash
npm run verify
```

Result:

- TypeScript typecheck passed.
- Vitest passed: 24 test files, 67 tests.
- Build passed.

Additional setup-compatible config verification:

```bash
npm run dev -- doctor /private/tmp/cdb-env.cQV5jq/.env
```

Result:

- `.env` passed.
- Runtime config schema passed.
- Claude CLI passed: `2.1.104`.
- Slash command schema passed for both `/cdb` and `/a4d`.

Additional environment check:

```bash
npm run doctor
```

Result in this workspace:

- `.env` failed because `/Users/suhyl/Project/claude-discord-bot/.env` does not exist.
- Claude CLI passed: `2.1.104`.
- Slash command schema passed for both `/cdb` and `/a4d`.

## Remaining Live Verification

Live Discord e2e was not run because this workspace has no `.env` with Discord credentials. After configuring `.env`, run:

```bash
npm run doctor
npm run register
npm run run:bot
npm run e2e:manual
```

Or pass the same explicit env file to each command:

```bash
npm run dev -- doctor /path/to/.env.live
npm run dev -- register /path/to/.env.live
npm run dev -- run /path/to/.env.live
npm run dev -- e2e-manual /path/to/.env.live
```

Then complete the checklist printed by `npm run e2e:manual` in an actual Discord guild.
