# Claude Code handoff — Hive 全量 review

你是接手 Hive 的独立 reviewer。请审查当前整个项目的正确性、安全边界、可靠性、产品一致性和可维护性，给出有证据的结论。**这次是 review，不是实现或重构任务。** 不要只看最近的 diff，不要只验证下面列出的已知问题，也不要以现有测试通过代替业务审查。

## 1. 仓库与审查基线

- 本地目录：`/Users/spenc/CV/team-agent-ui-prototype`。从其他目录启动时先进入这里；不要审查整个 `/Users/spenc/CV`。
- GitHub：`spinsirr/hive`，目前 private，必须保持 private。
- 线上产品：<https://hive-roan-mu.vercel.app/>；无数据库 UI demo：<https://hive-roan-mu.vercel.app/demo>。
- 交接时 HEAD：`2799196ed42714e6f63135d605766b2708bb7073`。这是定位点，不是要求你只 review 此提交。
- 交接时有四个尚未提交的证据文档改动：`docs/GOAL.md`、`docs/MEMORY_TRADEOFF.md`、`docs/PRESENTATION_NOTES.md`、`docs/SUBMISSION.md`；本 handoff 也是新增文件。它们包含最新 memory 实测结果，不能丢弃或只读 HEAD 版本。
- `origin/main` 的本地 tracking ref 可能滞后；该 HEAD 曾通过显式 GitHub URL 成功推送。不要仅凭 `ahead 1` 断言未上线，更不要为 review 自动 push/pull。

开始时记录实际状态，若已变化则以实际工作树为准，并说明与本交接的差异：

```bash
pwd
git status --short --branch
git rev-parse HEAD
git diff --stat
git diff --cached --stat
```

全量范围是当前第一方源码、路由、客户端逻辑、数据库 schema/迁移、配置、测试和文档。对生成产物、vendor 和依赖不逐行审查，但要审查它们的生成方式与接入边界。包含未提交的变更，保留现有工作。

## 2. 先理解产品与约束

先完整阅读 `CLAUDE.md`、`AGENTS.md`、`CONTEXT.md`、`README.md`、`package.json`，再读 `docs/GOAL.md`、`docs/SETUP.md`、`docs/MEMORY_TRADEOFF.md`。按需要查阅 `docs/PRESENTATION_NOTES.md` 的相关日期、`docs/STREAMING_DIAGNOSIS.md`、`docs/VERCEL_HARNESS_DECISION.md`、`docs/WORKFLOW_TRADEOFF.md`、`docs/SUBMISSION.md` 和 `docs/DEMO_BRIEF.md`。

遵守适用的全局/目录指令。若 CoreSpeed memory connector 可用，先搜索既有 Hive 决策；不可用就说明证据来源是当前仓库，不要声称已经检索，也不要为了 review 配置新服务。仓库要求核对安装版本的 Next.js 文档：`node_modules/next/dist/docs/`。判断 Harness/Codex/SWR 等行为时也应查安装版本的类型和实现，不要凭印象断言库不支持某功能。

### 当前产品契约

- Hive 是 **多个真人共享同一个 coding agent**，不是多个 agent 的编排平台。主要交互是与 agent 对话，团队可以讨论、批注、steer 并检查真实产物。
- 一项 task/session 对应一项具体意图；创建时可没有 repo，之后最多 attach 一个 repo，不能在同一 task 内替换。不是长期团队聊天室。
- 首次 GitHub 登录可以创建自己的 task；进入别人的 task 需要 membership/invite。分享 task 的工作副本不等于授予 inviter 的其他任务或仓库池。
- 可列出/attach 的 repo 是当前 GitHub 用户权限与 GitHub App 安装权限的交集。多个账号在同一 installation 下也不能互相继承 repo 列表。
- 主聊天中发给 agent 的消息在运行中排队；leading `@teammate` 是 human-only。Thread/code annotation 默认是讨论，不应自动唤醒 agent。
- 显式 steer 单条或整个 Thread；整条 Thread 的 parent、截止回复边界与作者必须冻结。作者、promoter、实际 applier 不应混为一人。
- 同一个 task 至多一个 mutating run。当前 UI 在安全边界由成员显式 Apply 下一项，不要把未自动 drain 队列当成实现遗漏。
- Diff、Files、Runs 反映真实工作副本与执行证据。Files 当前是完整、按需、只读 Monaco 浏览和代码选区批注，不是协同编辑器。不能把缺少文件保存当成当前 scope 的 bug。
- Restore 必须 idle、确认，并配对恢复文件、native context 和执行证据；保留团队讨论和待处理队列，不自动 rerun，清除旧 approval。不能把 restore 描述为回滚 GitHub 提交。
- Manual Complete/Reopen 和 Active/Completed filters 已于 September 9 移除。run 结束或 diff approved 不关闭对话。历史验收记录提到这些旧按钮，不代表需要恢复。
- Memory：fresh coding turn 自动召回；保存仍需明确的人类请求，选定已有的短 human message/reply 原文，保留来源。不是自动吸收全量对话，也不是把个人意见升级为团队共识。

### 不扩大 scope

Take-home 设计约 6 focused hours，评价 judgment/taste，而不是企业平台完整度。展示约 20 分钟，顺序为问题 → 方案 → 代码 → AI journey，其余为讨论。要有真实可用的 end-to-end 路径，不只是 demo。

当前明确不做：PR 创建、Sandbox branch push/merge、生成代码的部署工作流、issue triage、图片/文件上传、多团队管理、Vercel Workflow 迁移。Memory 与已有协作 tools 是后来明确批准的有限扩展。可以指出现有架构的具体风险；不要把新增这些功能写成必须修复的 findings。

## 3. 权限与操作边界

- 默认只读源码。只允许新建或更新最终报告 `docs/REVIEW_CLAUDE.md`；若该文件已有内容，先读取并保留，增加一个带时间和 HEAD 的审查章节。复现用临时文件可放独立临时目录，不能覆盖仓库源码或用户已有改动。
- 不 commit/push/deploy、改 repo 可见性、发送邮件、创建 PR、购买 credits、改模型、修改环境变量或密钥。不要读取/打印 `.env.local`、私钥、token、cookie 或 credential store；配置核对从 `.env.example` 和源码入手。
- 不 reset、删库、跑真实数据库迁移、restore/reset 线上 task、approve/steer、触发模型或 Mem0 写入。旧测试的批准不代表本次 review 也获准重跑付费或持久化操作。
- 可运行确认过边界的本地受控检查。不得把已有 shell 环境里的生产 `DATABASE_URL` 当测试库。不要未经检查就执行整个 diagnostics 目录。
- 新真实账号、线上写入、付费服务或不可用测试环境需要用户提供/批准时，列为阻塞的具体检查；先完成其余静态和本地审查，不要凭空判定通过。
- 不要向任何额外外部服务上传私有源码、历史、日志或记录。此任务仅授权 Claude Code 审查本项目。

## 4. 审查地图与重点

这是一份入口地图，不是文件白名单。沿调用链检查真正的信任边界和持久化路径，发现其他相关文件也要覆盖。

### A. Auth、task 与 repository 隔离

入口：`src/app/actions.ts`、`src/app/page.tsx`、`src/app/sessions/[sessionId]/page.tsx`、`src/app/api/**/route.ts`、`src/lib/auth-session.ts`、`github-oauth.ts`、`github-user-session.ts`、`github-login-origin.ts`、`github-app.ts`、`session-invite*.ts`、`src/db/`。

检查首次 signup、task creator、invite 过期/重放/权限、OAuth state/cookie/canonical origin、logout/credential expiry；分别检查 page、snapshot、live、files、checkpoints、restore 和 agent-tools。重点找 IDOR、跨 task 或同 installation 下跨账号 repo 越权、伪造 author、CSRF/origin 绕过、敏感数据经 SSR/API/logs/stream 泄漏。明确区分任务成员对 attached workspace 的预期访问与不应获得的 repo pool 权限。

### B. 多人输入、状态机与一致性

入口：`src/lib/task-session.ts`、`task-session-store.ts`、`task-session-snapshot.ts`、`hive-prompt.ts`、`hive-conversation.ts`、`message-thread*`、`src/hooks/use-shared-session.ts`。

检查事务/row lock 是否覆盖真正冲突点；双人同时 send/steer/apply、重复 HTTP、乱序回包、失效 run 回调、frozen Thread 后续回复、author/promoter/applier、approval invalidation。核对 UI 禁用之外是否有服务端约束。报告具体可导致重复执行、丢输入、错作者或状态分裂的交错顺序，而不只是建议“加锁”。

### C. Harness、Sandbox、流式输出与恢复

入口：`src/lib/hive-runner.ts`、`codex-harness.ts`、`hive-agent.ts`、`hive-sandbox.ts`、`codex-bridge/`、`agent-stream.ts`、`workspace-restore.ts`、`workspace-restore-state.ts`、`src/app/api/sessions/[sessionId]/route.ts`。

核对 native session/history 的持久化与私有边界、prepareCall/continuation、config fingerprint 是否触发错误的新 native thread、sandbox token 权限、超时/取消/失效 run、stream delta/final 去重、tool output 与聊天分离、真实 exit code。检查 429 退避是否有界、是否错误重放已接受的 turn/stream/命令。Restore 是否配对且被正确 fencing，失败中间态是否会破坏 queue/history/approval。已披露的 hard-worker termination 恢复限制不是“已通过”；确认文档没有超额承诺。

### D. 实时同步、presence、数据库与缓存成本

入口：`src/lib/session-live.ts`、`session-events.ts`、`session-presence.ts`、`task-session-store.ts`、`src/hooks/use-shared-session.ts`、`src/hooks/use-workspace-read.ts`、`src/components/hive/workspace-read-cache.tsx`。

检查 WebSocket auth、跨实例通知、断线 catch-up、消息 revision/顺序、在线身份、多 tab、typing、连接/监听器清理、过期实例，以及 idle 时实际 SQL/egress。Neon 曾耗尽配额；不要建议恢复高频全量轮询。SWR 已存在于 Files 按需读取中；检查 key 是否隔离 task/path/revision、分页与重复请求、切 task/rollback 后旧内容和 late response，而不是默认建议“安装 SWR”。评估大 transcript、批量更新、JSONB/通知负载与 private history 是否被不必要地传输。

### E. Files、Diff、Runs 和协作 UI

入口：`src/lib/workspace-files.ts`、`workspace-browser.ts`、`workspace-read-script.ts`、`code-reference.ts`、`src/components/hive/`、`src/components/ai-elements/`、`src/hooks/use-message-draft.ts`。

检查 path traversal、symlink、Git/credential 文件、binary/oversize、Shell 参数注入、文件分页与 snapshot freshness；代码批注应引用实际 file/line/content。检查 diff 红绿/路径、Monaco language/icon、Runs 的真实状态、Thread 展示/whole-thread steer、IME 防重复、@autocomplete、初始滚动/流式滚动/用户上翻、草稿隔离、resize/窄屏、键盘/focus/accessible label、loading/empty/error，以及 Streamdown、链接和不可信内容渲染。以会误导或阻碍用户的行为为 findings，纯审美偏好单列。

### F. Memory、agent tools 与不可信上下文

入口：`src/lib/hive-memory.ts`、`hive-memory-recall.ts`、`hive-mcp.ts`、`hive-tool-context.ts`、`hive-tool-token.ts`、`src/app/api/sessions/[sessionId]/agent-tools/route.ts`、`src/lib/codex-bridge/hive-collaboration/SKILL.md`。

核对一次 fresh turn 最多一次自动 lookup，tool steps/恢复不额外查询；2 秒上限、空/错/超时不阻塞 coding、没有隐式写入；repo+installation scope、返回 scope 校验、author/session/message/reply 的全链路映射；旧 memory 不能覆盖当前指令。检查 capability 过期、task/member/run fencing、撤销 membership、body/数量限制、retry-safe reply、只允许既有人类来源、provider pending/unknown 不宣称 saved。明确哪些约束仅靠 skill/model 遵守，哪些由服务端保证；评估 prompt injection 与越权保存的实际路径，不把 prompt 当安全授权机制。

### G. 测试有效性、维护与提交可信度

检查哪些测试是真生产入口、哪些是实现同形的 mock、跳过或 false green；尤其关注 `pnpm test` 未包含的集成检查。检查错误吞掉、隐式 fallback、过度抽象、dead path、重复状态与关键大模块，但必须说明实际影响。依赖/配置按 lockfile 安装版本审查，不因版本看起来新就推断不支持。

核对 README、SETUP、GOAL、presentation 与实际行为是否一致。仅剩旧字段/历史迁移不是必须删库的理由。文档中的实验日期、旧失败、prepared task 的旧 revision 测试数不能伪装成当前代码或本次 review 的测试结果。

## 5. 最新证据与已知缺口（请独立核对）

以下不是让你附和的审查结论，也不应限定你只找这些问题。

- 之前本地记录：150 unit tests、8 个真实 Harness 生命周期的受控 recall 检查，加其他 runner/route/component checks、lint、typecheck 通过。它们不是本次重新执行的结果；外部模型/Mem0 多为 fixtures。
- prepared coding task：`/sessions/label-the-return-to-latest-messa-qvezdg`。历史两账号检查、真实两文件 diff 和 combined command Exit 0 / 125 个旧 sandbox revision unit tests 已记录。不要改变它来制造新验收证据。
- **最新真实 Mem0 round：September 10, 01:12–01:14 UTC（September 9 Pacific）**。已有明确标为测试样本的 Spinsirr Thread reply 保存成功，memory ID `b5d755ae-8781-426e-bba6-d113a702cdca`。Mem0 ADD `0c053093-2ca7-4952-9cb2-5e46885e2cc9` 成功；独立 task 的自动 SEARCH `f0a836bd-15be-4c86-ac68-450cf0f506e9` 返回一条。
- Save task：`verify-repository-memory-save-q1wdex`；recall task：`verify-repository-memory-recall-i2lau8`。Recall prompt 没有答案，agent 正确答出 `青桐-0909`、作者 `Spinsirr`、回复 ID `annotation-1788930878857-3`。刷新保留答案，两轮均显示 No commands in this turn。
- **已观察到的 defect：** answer 写了 `来源任务：initial-1`，这是 message ID；正确 source session 是 `verify-repository-memory-save-q1wdex`。Mem0 保存的 metadata 正确。请检查模型输入/formatter/UI 的来源表达；不要未经证据就认定是数据库 mapping bug，也不要把整条 memory 功能标为未接通。
- 旧 memory attempt 曾遇到 429；新 round 成功不代表永久解决 rate limit，已有 credit 也不证明吞吐无限。准确的限流层和配额窗口未确认。
- 全新真实 GitHub 账号首次 signup/create 与真实跨账号 repo 隔离仍缺生产验收；现有受控 GitHub + real local Postgres 测试不能替代。
- 约 20 分钟 narrated rehearsal 尚未完成；presentation 日期未定；repo 未批准公开；四件提交材料尚未对外发送。这些是交付缺口，不是代码 bug。
- README/SETUP 的 memory acceptance 文案可能落后于四份最新未提交证据文档；按时间与事实核对，不为保持文档一致而抹掉新实测。

## 6. 建议执行方式与安全测试

1. 先建立路由、状态和数据流地图；覆盖所有上面的领域，再深挖高风险调用链。
2. 读相关测试脚本后，先跑不会访问生产服务的受控基线，记录实际 Node/pnpm 版本、命令、退出码、测试数和失败原文。
3. 用最小本地复现验证怀疑；不能复现时给出静态证据、触发前提和置信度，不把猜测写成 confirmed。
4. 最后核对工作树：除报告和可说明的本地构建产物外不应引入变化；不要为“恢复干净”覆盖用户文件。

下列是候选命令，不是授权直接执行任意依赖脚本。先核对脚本、配置与外部访问；尤其 build 可能加载 `.env.local` 或访问后端，无法隔离时记录未跑而不是接入生产：

```bash
node --version
pnpm --version
pnpm test
pnpm lint
pnpm typecheck
pnpm exec next build --webpack
git diff --check
```

额外本地集成检查：

- `pnpm test:onboarding` 仅在 `HIVE_ONBOARDING_TEST_DATABASE_URL` 明确指向独立、loopback、本地可丢弃 Postgres 时运行。
- `pnpm test:session-egress` 同样要求独立 loopback `HIVE_EGRESS_TEST_DATABASE_URL`。这两个脚本会创建和删除自己唯一命名的 fixture database；先确认保护条件，绝不能指向 Neon/生产。
- `scripts/diagnostics/check-hive-tools.mjs` 需要隔离安装的 `@openai/codex-sdk@0.149.1`，使用真实 Codex 进程与 loopback model/Mem0。没有现成合适环境就记录未跑，不擅自安装全局依赖、接真实模型或购买额度。
- `scripts/check-live-transport.ts` 直接使用 `DATABASE_URL_DIRECT`，不要把它当默认安全测试。先确认独立本地地址，不能继承生产凭据。

仅为阅读 UI 可使用本地页面或公开 `/demo`；它是虚构 sample data，不是多人/agent 实测。真实浏览器与线上写操作缺授权就保持静态/本地验证。不要为全部打勾而触发付费运行。

## 7. 最终输出

写入 `docs/REVIEW_CLAUDE.md`，用中文给 owner 一个简短总结。报告结构：

1. **总体结论**：当前是否适合 take-home 演示、哪些现有核心路径有阻断风险；不要把“可以演示”说成“企业级生产安全”。
2. **Findings，按 P0/P1/P2/P3 排序**：每项给出标题、相关文件与准确行号、触发条件/最小复现、期望 vs 实际、用户/数据影响、证据、置信度，以及最小修复方向。不写修复代码。
   - P0：需要立即处理的严重安全/数据风险。
   - P1：阻断核心路径、越权、重复执行或数据丢失等高影响问题。
   - P2：范围有限但实际影响正确性、可靠性或体验的问题。
   - P3：非阻断的维护/体验问题。纯个人偏好不包装为 bug。
   - 严重性与置信度分开。静态确定的问题也要给清楚调用链；未验证风险单列，不计作已复现缺陷。
3. **Coverage matrix**：上述 A–G 每域审过哪些路径/测试、已验证/部分验证/未验证及原因。若不能完成全量覆盖，明确报告缺口，不声称 full pass。
4. **测试记录**：实际执行的命令和结果、未执行项与限制。严格区分本次执行、历史证据、mock/loopback 与真实线上行为。
5. **最小修复顺序**：优先级最高的少量工作和各自回归验收；分清提交前必修与可留后续的事项，不扩大既定 scope。
6. **文档/展示不一致**与**剩余人工验收**：不要把 publication、presentation rehearsal 或缺第二账号混到代码 bug 列表里。

没有发现足够证据支持的问题就直说；不要凑数量。完成 review 后停下来等 owner 决定，不自动进入修复、部署或线上复测。
