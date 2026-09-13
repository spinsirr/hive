# Hive 全量代码质量审查

日期：2026-09-13。基准：`9719cf874ff5182ed1134dba28586755349b774e`（审查开始时的 `origin/main`）。使用用户指定的 [Thermo-Nuclear Code Quality Review](https://github.com/cursor/plugins/blob/main/cursor-team-kit/skills/thermo-nuclear-code-quality-review/SKILL.md)。

**结论：质量工具可以建立有效的自动检查，但当前架构仍未达到该 skill 的批准标准。** 主要问题是执行状态与输入来源重复建模、协议和业务边界模糊，以及热点模块持续累加特例。下面的结构问题仍待重构；本次没有把格式化或测试通过当作这些问题已解决。

## 范围和方法

- 全仓文件清点：基准共 328 个跟踪文件；`src` 204 个、`scripts` 59 个，其中 258 个 TS/TSX/MJS 文件接受静态分析。依赖、构建产物和生成的数据库元数据不作为手写代码审查。
- 全仓 ESLint、类型检查、格式化检查；对源码追加复杂度和文件大小扫描；检查本地静态值导入关系，未发现静态运行时导入环。该检查不覆盖动态导入、依赖包内部或字符串中的代码。
- 人工重点追踪完整业务路径：页面与共享会话、消息/队列/问题/评审状态转换、HTTP 验证、数据库事务、执行器和原生 bridge、文件/恢复、认证/凭证、MCP/记忆、demo 和测试基础设施。不是逐文件“已批准”的清单，也不是渗透测试。
- 下列文件位置按本次格式化后的代码标注。行数增长主要来自展开原有单行代码，不能解释为本次新增了这些职责。

## 优先处理的发现

### R1 · P1 · 一个 reducer 承担多套重叠的执行状态机

位置：`src/lib/task-session.ts`，`TaskSessionState`、`reduceTaskSession`、`applyHiveRunResult`、`applyHiveRunError`。

`stage`、`workspace.status`、开始/完成时间、`activeSteer` 和队列共同表达“正在运行”。消息、注释、Thread 和问题答案又分别构造启动状态，重复清理 summary、commands、error 和时间字段。调用方必须知道“任务 stage 仍是 running，但执行已结束”这样的组合语义。`reduceTaskSession` 的 ESLint 圈复杂度为 **184**；文件原来 1,328 行，格式化后约 1,925 行。

这不是把大函数拆成数个同样复杂的函数就能解决的。应让所有执行输入先成为同一种具备来源、作者、冻结内容及回复位置的命令，再经过一个入队/启动转换；用明确的执行状态区分 idle、running、completed、failed、restoring，UI 状态由它推导。消息编辑、问题回答、队列操作按业务职责组织。必须保留并发执行仅授权一次、冻结 Thread 边界、恢复隔离和原作者归属测试。

### R2 · P1 · Sandbox 网络调用处于共享任务行锁内

位置：`src/lib/task-session-store.ts` 的 `applyTaskSessionAction`（约 458–487 行）、`appendHiveReply`、`syncTaskIdleCheckpoint`；`src/lib/task-environment.ts`。

事务锁定任务及成员后，调用 `readTaskIdleCheckpoint`、`refreshTaskEnvironment`。后者先查 Sandbox，再延长期限，每一步可以等待 8 秒。一个慢的 provider 调用会阻塞同一任务的后续消息、进度检查点和完成写入；代码已经解释了为什么需要顺序，但把顺序绑定到数据库长事务不是好的边界。新增消息的检测还在锁内对新旧消息和回复反复扫描。

建议将 VM 查询、期限更新和持久状态提交分开：对明确 VM ID 做幂等或单独串行的更新，再在短事务内核对 run/version/VM 身份并提交；冷恢复配对需有独立的持久阶段，不能简单移走锁然后接受陈旧结果。用延迟 provider 的并发数据库测试证明普通讨论和进度写入不被外部超时卡住。

### R3 · P1 · HTTP 输入契约靠手写条件链与最后一个强转拼接

位置：`src/app/api/sessions/[sessionId]/route.ts` 的 `POST`（约 77–371 行）；`src/lib/task-session.ts` 的 action union；`src/hooks/use-shared-session.ts`。

20 种客户端 action 先经类型白名单，再按字段执行大量分支，最后 `as TaskSessionAction`。接口、领域类型和客户端派生类型需要同步维护，却没有编译器证明字段检查覆盖了 union。新增一种 action 很容易只更新部分位置。`POST` 的圈复杂度为 **165**，验证与认证、执行调度和结果持久化混在一起。

项目已经有 Zod，应使用一个客户端 action 的 discriminated union，由 schema 推导输入类型；认证后的 actor 由服务器加入，`connect-repository` 这类内部 action 单独建模。业务转换继续检查当前状态和权限，不能把数据验证误当授权。保留无效输入、长度限制、伪造 actor、内部 action 拒绝及并发版本测试。

### R4 · P2 · UI 的共享组件是一个包含多种职责的大控制器

位置：`src/components/hive/hive-workspace.tsx`，尤其 `HiveWorkspaceView` 和 `SharedProps`。

文件原来 977 行，格式化后约 1,772 行；同时拥有 header、仓库选择和请求、会话内容、工作区 tabs、邀请/退出、消息编辑、模型设置、恢复、问题自动续跑和 review 导航。view 又组合 `pane`、`threadId`、`viewingReviewChanges` 等独立状态，靠条件保持一致。`HiveWorkspaceView` 的圈复杂度为 **53**；相邻 `MessageThread` 达 **82**。demo 使用真实共享 UI 是正确方向，不应该重新复制一套界面来缓解这个耦合。

建议先把导航状态建模为互斥的 conversation/thread/review 视图，并明确返回位置；将仓库接入和会话动作各自归到有业务职责的组件或 hook。header、仓库选择和 tab 容器可以自然拆分。目标是减少联动状态和传递参数，而不是把整个函数原样搬进一个万能 hook。验收保留移动端切换、焦点回归、断线恢复和 demo/live 共用行为。

### R5 · P2 · 公共快照和私有恢复状态使用同一个类型

位置：`src/lib/task-session-snapshot.ts` 的 `publicTaskSessionSnapshot`（约 18–36 行）；`src/lib/task-session-store.ts` 的 `TaskSessionSnapshot`、公共 SQL 投影；`src/lib/task-session.ts` 的 `WorkspaceState`。

公共投影移除 recovery/checkpoint 内容后仍返回 `TaskSessionSnapshot`。这个类型又包含 `resumeFrom`、`idleCheckpoint` 和完整 checkpoint。服务器公开数据依赖多个位置维护减法清单，客户端则从 server store 文件导入同一个契约。当前测试验证了已有私有字段被移除；这里没有声称已发生数据泄露，问题是未来添加私有字段没有类型屏障。

建议定义独立的 `PublicTaskSessionSnapshot` 和私有持久类型，将共享契约放到不依赖 DB 的模块。公开字段显式选择，并使公共 API、WebSocket 和初始页面返回同一公共类型。保留 SQL 端剔除大型恢复数据的优化，增加新私有字段不能进入公共类型的检查。

### R6 · P2 · 原生 bridge 混合协议、生命周期和业务特例

位置：`src/lib/codex-bridge/app-server.mjs` 的 `runNativeTurn`、`runWithCompatibleHistory`。

一个函数同时处理进程、数字请求 ID 握手、认证、skill 注册、RPC 超时、子任务、主 Thread、文本去重、命令结果和退出刷新。圈复杂度为 **112**。同一行消息由 line listener 和 async iterator 分别解析，业务分支依赖若干数字 ID。新增协议兼容处理会继续进入这个混合控制流。

建议保留现有 SDK 和明确的恢复策略，建立小范围的原生 RPC/握手模块；只解析一次消息，由明确协议类型路由给主 turn 与子任务处理器。执行事件收集和进程关闭各自拥有明确完成语义。不能通过删除退出确认或把不明状态认作 completed 来“简化”。本次只修复了 finally 覆盖错误的写法，整个结构问题仍在。

### R7 · P2 · 通用命令输出截断破坏了 diff 的独立上限

位置：`src/lib/hive-runner.ts` 的 `commandOutput`、`collectArtifacts`，`MAX_OUTPUT_CHARS` 和 `MAX_DIFF_CHARS`。

`commandOutput` 先把所有输出截到 20,000 字符，`collectArtifacts` 再对 diff 使用 60,000 字符限制。第二层限制无法恢复第一层已经丢失的内容，20–60 KB 的 diff 也会提前截断。changed-file 清单同样经过展示用字符串处理后再参与数据解析。这是把原始命令数据和 UI 展示文本混用导致的实际行为问题。

应保留原始命令结果，在各自消费边界采用明确的独立限制；文件名使用 NUL 分隔的机器格式，保留截断标记和完整性信息。增加超过 20 KB、小于 60 KB 的 diff、文件名带空格/非 ASCII 字符和真正超限的回归。该发现本次记录为待修复，没有在格式化变更里改动 artifact 行为。

### R8 · P2 · 运行时代码藏在字符串中，质量工具无法覆盖

位置：`src/lib/workspace-read-script.ts`。

真正运行于 Sandbox 的文件读取实现存放在 `String.raw` 中，包括路径校验、descriptor 检查和错误映射。ESLint/Prettier 只看见一个字符串，不检查内部可执行代码；主机与 Sandbox 的校验也需要人工保持一致。这里的双重边界检查和 Linux descriptor 防护有意义，应保留，不能为了减少重复而删除。

建议将实现放到独立可 lint 的运行时文件，构建时作为资产提供给 Sandbox，测试与线上使用同一资产。主机 schema 和运行时防护分别测试，并以共同边界用例检查行为一致。不要再引入字符串源码替换来修复这一层。

### R9 · P2 · 测试基础设施重复且部分工具链绕过项目模块系统

位置：`scripts/check-thread-preview.mjs`、`check-coding-agent-select.mjs`、`check-collaboration-demo.mjs` 及其他组件检查脚本。

仓库中有 40 处测试 loader 注册或直接 TS transpile 调用，多个脚本复制别名解析、TSX 转换和 JSDOM globals。部分测试被独立命令串行启动，公共测试环境变化要改很多副本。问题不是“测试都是假的”：这里有大量真实组件交互、协议和数据库回归，格式化后也仍能通过。

建议在现有 Node test runner 上收敛一套共享测试 loader 和分开的 DOM/数据库 fixture；按进程隔离需求组织测试入口，只有相互独立的组才并行。复用当前 TypeScript/JSDOM/Testing Library，先不要再引入第二套测试框架。保留浏览器导入顺序和每个 fixture 的释放、数据库隔离规则。

## 本次已落地

- ESLint 基础 JavaScript 错误检查、全 TypeScript 的类型感知规则、零 warning 门禁、无用 suppression 报错；保留 Next/React/Hooks 检查。
- Prettier 配置、全仓格式化、EditorConfig、编辑器设置、Husky + lint-staged；`pnpm check` 统一入口；CI 和现有本地 release runner 增加 format 检查。
- 修复规则发现的多余类型断言、导入方式、未重新赋值的变量和异步事件回调契约。没有通过 `any`、目录级排除或批量 suppression 来清空报告。
- 原生 turn 错误和未正常退出错误的优先级显式化，原始失败保存在 `cause`，仍拒绝不可靠历史重试；四种执行/退出组合有真实 Harness 边界回归。启动诊断同时保留运行与清理失败。
- 路径校验仍拒绝控制字符；仅该表达式保留带原因的 `no-control-regex` 例外。
- release 检查器改为流式计算 Git diff 校验值，修复全仓格式化超过子进程默认输出缓冲区后无法开始验证的问题。

## 验证边界与重构顺序

完整本地 release 检查结果为 **PASS**，八个阶段全部通过，检查过程中代码校验值保持一致：

| 阶段                                                        | 结果 | 耗时  |
| ----------------------------------------------------------- | ---- | ----- |
| Prettier 全仓检查                                           | PASS | 3 秒  |
| ESLint 零 warning                                           | PASS | 9 秒  |
| 共享 UI 所有权                                              | PASS | <1 秒 |
| Next 类型生成与 TypeScript                                  | PASS | 4 秒  |
| 完整回归（主单元集 238 项，另含组件、路由、Harness 等检查） | PASS | 32 秒 |
| 数据库/认证/恢复/WebSocket 集成                             | PASS | 38 秒 |
| Peer 协作数据库与 MCP                                       | PASS | 1 秒  |
| 生产 Webpack 构建                                           | PASS | 30 秒 |

运行环境为 Node.js 24.19.0、pnpm 11.19.0，本地 PostgreSQL 18.4；CI 配置使用 PostgreSQL 17，因此不声称已在本机验证 CI 的数据库版本。数据库检查自行创建并释放隔离 fixture。生产环境和真实模型验收 **NOT_RUN**，远端 GitHub Actions 尚未运行。

另用故意错误的源码验证了未定义变量、finally 覆盖控制流、未处理 Promise、await 非 Promise、未使用变量和显式 any 都会被拒绝；测试注册无需 await，但测试内部的未处理 Promise 仍会失败。格式检查也拒绝故意未格式化的输入。CI 保留既有 `Lint and types` 检查名称，避免因改名影响已有必需检查设置。

建议按 R3 → R1 → R2 → R5 → R4/R6 推进职责重构，每一步保持可运行和可回归。R7 可作为一个独立的小修复优先完成，R8/R9 则用于收敛运行时和测试资产。不要先批量拆文件，再宣布结构改善。

已有的事务内执行授权、run ID 防过期写入、明确 restore fence、按仓库限定记忆、真实组件共享和服务器端快照裁剪是值得保留的设计。复杂度不全是多余代码，清理时必须证明保留这些行为。
