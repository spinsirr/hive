# Hive 全量代码质量审查与修复

日期：2026-09-13。首次审查基准：`9719cf874ff5182ed1134dba28586755349b774e`；原始审查及质量工具提交：`76579af`。使用用户指定的 [Thermo-Nuclear Code Quality Review](https://github.com/cursor/plugins/blob/main/cursor-team-kit/skills/thermo-nuclear-code-quality-review/SKILL.md)。用户随后授权修复全部发现。

本轮为 R1–R9 落实了结构和行为修复。ESLint、Prettier、类型检查、提交钩子和 CI 继续执行，未加入忽略目录、降低规则或接受旧问题的 baseline。审查范围包括所有手写源码和脚本；依赖、生成的 Monaco、构建输出和数据库元数据不算手写代码。原始问题的完整描述保留在上述 Git 提交中。

## R1 · P1 · 统一执行输入与启动状态

原问题：`task-session.ts` 约 1,925 行，普通消息、标注、Thread、问题答案分别构造启动状态，reducer 复杂度 184。

所有入口现在先形成带冻结内容、作者、来源和回复位置的指令，通过 `task-session-commands.ts` 的单一接收/启动流程执行。立即开始的普通消息也保存 `activeSteer`；prompt 从已接受的指令读内容。编辑和后续讨论不能重写当前执行输入。消息与设置、问题/队列的业务转换分别归入 conversation、settings、steering 模块，主 reducer 只做有类型的分派。

`taskExecution` 明确区分 idle、running、completed、failed、restoring；队列和呈现用 `stage` 不再决定执行是否活跃。状态规则在 `task-session-state.ts`，与分派模块没有运行时循环依赖。保留已持久化的数据形状，无需迁移现有任务。

验证：原有同毫秒双消息、并发授权一次、队列顺序、冻结 Thread 范围、消息编辑、问题作者与回复位置、失败释放、旧回调隔离及恢复回归。

## R2 · P1 · 外部调用退出任务行锁

原问题：锁定任务和成员后等待 Sandbox 查询、续期或闲置快照，阻塞消息和流式进度；新增消息检测反复扫描旧消息。

冷快照先在行锁外读取，重新取得锁后必须匹配准备时的版本，才能接受指令和配对；并发修改会重新准备。后台 checkpoint 导入也使用版本及完整 VM/context 配对的原子条件更新。新指令清除旧配对，迟到结果不能覆盖新的 run 或 restore。

续期由 `task-environment-store.ts` 按 VM 独立串行，provider 调用期间不持有任务/成员行锁。续期仅针对原 VM，提交时校验版本和原环境，只更新 environment JSON。任务写入和完成通知先提交；续期失败不丢消息。新增消息/回复检测改为一次 ID 集合索引。

验证：真实 PostgreSQL 中故意阻塞 provider，同时写消息、修改任务和更新流式回复；再让旧 checkpoint 读取晚于新执行返回，确认新 run、版本和原始归属不被覆盖。并发 30 分钟续期不重复累加，停止的 VM 不被讨论消息唤醒。

## R3 · P1 · 单一动作契约

`task-session-actions.ts` 使用 Zod discriminated union 定义 20 种客户端动作并推导类型。客户端 dispatch、领域 action 和消息编辑类型复用该契约。HTTP 校验不再以强转结束；服务端注入 actor，仓库连接单独作为内部动作。消息提交 ID 必填，长度、代码引用、revision 和模型/effort 检查保留。状态与成员授权继续在事务内校验。

验证：非法输入、8,000/4,000/500 字符边界、非整数 revision、伪造 actor、内部动作拒绝及真实路由/数据库权限回归。

## R4 · P2 · 拆分 UI 职责与导航

`HiveWorkspaceView` 负责组合共享会话。页头、会话、仓库/工作区、详情视图和 review 操作由独立组件拥有；删除大型 shared-props memo 及其重复依赖清单。

`use-workspace-navigation` 以一个导航状态持有移动端 pane、工作区 tab 及互斥的 workspace/thread/review 目标。打开、返回、查看 checkpoint 和 reset 原子地切换目标；焦点归还和迟到 steer 确认仍只作用于当前 Thread。Review 的就绪提示、提交和错误状态不再与讨论草稿混在一起。demo 与 live 继续渲染同一套组件。

验证：真实 React 组件回归覆盖移动端切换、review 往返、焦点、迟到回执、中文 IME、草稿/重试、恢复、模型选择及共享 UI 所有权。

## R5 · P2 · 公共和私有快照分型

无 DB 依赖的 `task-session-contract.ts` 分开公共 `TaskSessionSnapshot` 与 `PrivateTaskSessionSnapshot`。公开字段使用 allowlist；SQL 与 JS 共用字段清单。原生 resume/authentication、完整 checkpoints、idle 配对和 restore 的源 VM 标识不会进入公共工作区。客户端不再从 store 导入类型。

验证：编译负例保证客户端无法读取私有恢复字段；真实 SQL/页面/API/WebSocket 回归验证私有历史不被传输，单独的服务端恢复读取仍保留历史。SQL 与内存投影逐项一致，不增加无值的可选字段。新增数据库测试先复现递归清理误删 `exitCode: null`，修复后 SQL 和 WebSocket 均保留未完成命令的原始状态。

## R6 · P2 · 原生 RPC、握手、事件和关闭分离

`app-server-connection.mjs` 只解析每行一次，区分 response/request/notification，处理 RPC 超时及进程连接。握手按命名 RPC 顺序完成，业务逻辑不再匹配数字 ID。主回合由 `turn-collector.mjs` 汇总，子任务独立接收通知；主事件迭代结束后，RPC 和子任务仍可完成排空。

驱动保留真实线程恢复、文本一致性、命令退出证据、订阅边界和原生历史兼容策略。清理失败仍尝试结束进程；只有确认正常退出且无连接错误才能信任历史，退出失败保留原失败原因并禁止恢复重放。

验证：真实 Harness 边界的成功/失败 × 正常/异常退出四组合；RPC 排空期间仍处理子任务通知；无效 JSON 拒绝在途请求；现有 gateway、auth、子任务和 Claude 回归。

## R7 · P2 · 修复 diff 提前截断

`workspace-artifacts.ts` 独立消费原始 stdout。Diff 使用 60,000 字符预算，文件内容使用 20,000 字符预算，最多读取 12 份文件预览；changedFiles 仍保留完整清单。文件名以 NUL 分隔，保留空格、中文和换行。删除项在变更清单中保留，但不读取已删除的文件。独立命令与文件读取并行，超限内容明确标记。

验证：真实临时 Git 仓库覆盖 20k–60k diff、超过 60k、特殊文件名、删除文件和超过 12 个文件。失败回合仍保留可取得的文件/命令证据，diff 保留原始换行。

## R8 · P2 · 可检查的运行时资产

文件读取实现移至 `src/lib/runtime/workspace-read.mjs`，直接接受 lint/format 检查。主机读取资产并以 Node ESM 执行；单元与路由测试运行同一文件。Next 明确追踪该资产。保留主机 schema、沙箱路径检查、symlink 拒绝、Linux descriptor 验证及大小/UTF-8 边界。

验证：现有文件与路由回归执行实际资产；最终构建的 files route 追踪清单包含该文件，session route 清单也包含两个新增原生运行模块，且三个资产均实际存在。

## R9 · P2 · 统一测试基础设施

`test-modules.mjs` 统一别名、Next 入口、TSX 装载。`test-dom.mjs` 安装浏览器 globals，并在关闭时恢复；`test-database.mjs` 统一隔离数据库创建、迁移和清理，复用已有 fixture pool。场景特有的路由/Monaco/网络替身留在各测试中，DOM 仍在 Testing Library 之前建立。保留独立进程隔离，不引入新测试框架。

静态 HTML 解析和诊断工具编译外部 Harness 样例有不同职责，不强行套入浏览器 fixture。临时 Git fixture 清除提交钩子传入的仓库环境和全局配置，并核对实际 Git 目录；模拟继承 `GIT_DIR`、`GIT_WORK_TREE`、`GIT_COMMON_DIR` 和 `GIT_INDEX_FILE` 的测试确认外层仓库保持不变。

## 结构复查

| 入口            | 原复杂度 |               修复后 |
| --------------- | -------: | -------------------: |
| session reducer |      184 | 29（主要为类型分派） |
| HTTP POST       |      165 |                   27 |
| native turn     |      112 |                   46 |
| workspace view  |       53 |                   36 |
| message thread  |       82 |                   65 |

数字用于定位热点，不代表分支全是错误，也不作为放宽 lint 的依据。状态规则文件约 825 行，主 reducer 约 103 行；workspace 主视图约 578 行。177 个非测试源码模块的静态值导入扫描未发现循环；动态导入与依赖内部不在该扫描范围。

## 验证记录

最终完整验证使用 Node.js 24.19.0、pnpm 11.19.0、隔离的本地 PostgreSQL 18.4，通过 `pnpm test:release` 执行。8 个阶段全部通过：format（2s）、lint（9s）、design-system（0s）、types（2s）、regression（32s）、integration（39s）、peer-store（1s）、build（17s）。

其中主 TypeScript 单元套件包含 240 项测试；完整回归还运行真实 React 组件、受控路由/原生进程、WebSocket 和数据库并发检查。新增协议测试 2 项通过。测试期间源码指纹保持一致，构建后检查的运行时资产追踪全部通过。其后更新审查记录，并修正真实提交钩子暴露的 Git fixture 环境隔离问题；带钩子环境的定向测试通过，应用源码未再改变。

这是提交前工作树的本地验证。CI 使用 PostgreSQL 17；本轮没有运行远端 Actions、部署或真实模型验收，不能以本地结果代替生产验收。
