# 2026-11-16 AI 研发与交付改造验收记录

这份记录保存本次实际执行的结果。日常操作按[实战手册](ci-cd-handbook.md)执行，完整实现见[代码附录](ci-cd-code.md)。未完成的项目不作为放行证据。

## 源码、审查与环境

原业务工作区保留在 `codex/mainnet-opportunity-release`，HEAD 为 `838900642b17730c99d6a80e6c8db7c0a357c46b`，原有未提交业务修改没有纳入本次交付。实施使用独立 worktree 和 `codex/ai-delivery-pipeline`。

- 初始远端 main：`a88634ec062a15a43b08859a4c2e07db656924fa`。
- 首批实现：[PR #3](https://github.com/woyaofei303/hyperliquid-testnet-terminal/pull/3)，审查 SHA `52e04f68ff542499ed5c402ccfada63f9429ff04`，合并 SHA `e2201a9061c9b90bc12ec97497d3e24226fbb3e3`，两个提交的代码树一致。
- 现场修复：[PR #15](https://github.com/woyaofei303/hyperliquid-testnet-terminal/pull/15)，审查 SHA `d432ebd3317fbf23abf2757109123d2b85462b50`，合并 SHA `b85687658a386802da48dff0831dc16274b9df62`，两个提交的代码树一致。后续预发布产物使用这个提交。
- 独立 Codex 审查发现“损坏 current 阻断回滚”问题：两个回归先失败后通过；新演练脚本的优化模式误报风险也已修复并复核。没有以编码者总结替代代码审查。

服务器实际是阿里云轻量应用服务器，韩国首尔，`47.80.28.238`。预发布使用独立账号 `hyperliquid-staging-deploy`、目录 `/srv/hyperliquid-staging`、本机端口 `127.0.0.1:8090` 和 GitHub Environment `aliyun-staging`。实测该账号不能写生产目录，没有 sudo 或 Docker 权限。

预发布 DNS、HTTPS、Nginx 和公开运行配置已创建；配置为 `schemaVersion: 1`、`phonePairingEnabled: false`。生产运行配置为 true。生产配置迁移曾因 reload 交接时短暂 404 自动恢复，补充有限重试后成功；应用版本没有因此切换。这不能代替应用版本回滚演练。

生产当时及本次受控上线前的版本：

```text
current:  a88634ec062a15a43b08859a4c2e07db656924fa-43708795815-1
previous: 140a2140cd2a6377d3d9385cd76172fe444f56d8-43349966499-1
```

两份历史版本仅补充文件清单，标记为旧服务器基线；没有补造来源证明。Web 改造没有重启采集器、切换其版本或删除共享采集数据。

## 已通过的检查

本机最终验证为 188 项单元测试、18 项发布器测试、174 项模拟浏览器测试通过；2 项性能场景按显式开关跳过，真实外部服务场景不混入模拟套件。构建、类型、Biome、实际提交钩子、Gitleaks、High 阈值 audit、Actionlint、ShellCheck、Compose 和源码附录一致性均通过。本机和原生产版本各执行一次部署只读 smoke，通过。

[首批远端 CI](https://github.com/woyaofei303/hyperliquid-testnet-terminal/actions/runs/43821616634) 与[修复远端 CI](https://github.com/woyaofei303/hyperliquid-testnet-terminal/actions/runs/43824425050) 均通过相同的 188 / 18 / 174 项测试及必需安全门禁，浏览器报告均明确列出 2 项跳过。修复轮没有 flaky 汇总。

`npm audit --audit-level=high` 未发现 High/Critical 阻断；53 个低危依赖链条目归于 deepmerge 公告 `GHSA-gcqx-w48m-w2h4`，没有用强制依赖升级或全局忽略掩盖。Dependabot 更新通过 PR 进入，未自动合并。

## 主分支与审批门禁

`main-delivery-gates` Ruleset ID `27355251` 已 active，无绕过名单：必须 PR、严格最新主分支、`ci-required`、解决审查讨论，禁止删除和强推；CodeQL 阻断 High 及以上安全告警和普通 Error。个人维护方式没有要求第二位人工批准人。

[故意失败的 PR #4](https://github.com/woyaofei303/hyperliquid-testnet-terminal/pull/4) 不处于草稿状态。单元测试故意失败；Gitleaks 检出从未签发的合成检测串；CodeQL 检出一个 Critical 命令注入。三个分析任务本身成功，但独立 CodeQL 结果检查失败。启用规则后 API 返回 `mergeStateStatus: BLOCKED`。该 PR 已关闭，未尝试合并，演练代码没有进入 main。

Secret scanning、Push protection、Dependabot 安全更新已开启。仓库级 Secrets 为空，SSH 凭据只在各自 Environment。生产 Environment 只允许 main、要求维护者批准、允许本人批准本人发起的部署、禁止管理员直接绕过。

[最终审批门禁演练](https://github.com/woyaofei303/hyperliquid-testnet-terminal/actions/runs/43825873782) 使用不能通过版本格式校验的无效目标，避免误批准引发切换。API 实测 workflow 和 `rollback / release` 均为 waiting，部署 steps 为空；随后取消，未批准。没有因此回滚生产。

## 产物来源与失败定位

[首个预发布尝试](https://github.com/woyaofei303/hyperliquid-testnet-terminal/actions/runs/43823073241) 的 Artifact ID 是 `14204714638`。身份校验、GitHub 原生来源证明和完整文件清单均通过，随后 publish 因复用工作流未显式传递 Environment Secret，在 SSH 上传之前失败。按当前 GitHub 官方规则补充三个调用方的两项秘密传递，以及被调用方的必需声明后，已由 PR #15 修复。没有降低环境审批或把私钥移到仓库级 Secret。

对该真实签名产物的本机副本执行了一项正向和六项负向校验：原始产物与签名 bundle 验证成功；错误仓库、错误工作流、错误源码 SHA、替换清单、修改 index.html、错误 run ID 均非零退出。测试没有修改服务器文件。失败或取消的运行不用于生产提升。

## 预发布及恢复演练

以下两个新运行使用修复后的同一源码，但每次独立构建唯一产物。它们均声明 high 风险且专项验收未完成，预期在预发布验收后由 `production-ready` 阻断生产；整体运行失败不能被描述成生产候选已放行。

```text
源码：b85687658a386802da48dff0831dc16274b9df62
预发布 A：43825817058 / attempt 1
预发布 B：43826293058 / attempt 1
```

两个运行的 verify、安全检查、CodeQL、来源证明、staging/release 均成功；预发布各通过 1 项只读冒烟测试。随后 production-ready 因专项未确认而失败，production 为 skipped，没有启动生产 job。

```text
预发布 A 发布 ID：b85687658a386802da48dff0831dc16274b9df62-43825817058-1
Artifact ID：14207086550
清单 SHA-256：dd681662a53edfd2cc5c1515274139de97feec8de935a9388850180128699969

预发布 B 发布 ID：b85687658a386802da48dff0831dc16274b9df62-43826293058-1
Artifact ID：14207117134
清单 SHA-256：fe31f8e506134df272d858b5c5c3c2271f75bcb60403b4db2c8e378e3ab43505

公开运行配置 SHA-256：3bc4b53d51cafe556d544d53007c8c500e45d08fde854e3714d3d18393cf5895
phonePairingEnabled：false
/pairings：HTTP 503
```

A、B 的清单各覆盖 665 个文件。两版共用 41 个静态资源，各另有 2 个资源；对 45 个公网静态资源逐项获取并比较 SHA-256，全部一致。首轮公网检查因连接重置中断，有限重试后通过；没有据此反复切换版本。

恢复演练前 current=B、previous=A。以 A 为候选，`drill-staging-recovery.py` 在 current 实际切到 A 后注入仅针对 A 的健康失败。原发布器恢复 current=B、previous=A，真实检查 B 的版本、首页和 JS，journal 清除；脚本再次验证两个链接与真实 HTTP。整次注入演练耗时 **0.633 秒**，包含切换前校验、共享资源检查、切换和恢复验证，不代表真实故障检测时延或 SLA。

恢复后再次从公网执行只读 smoke：1 项通过（5.5 秒），预期 B 版本、配置、资源和行情均正确。生产仍是本记录开头的原版本。这完成了预发布失败恢复演练，**没有完成生产手动回滚演练**。

## 监控与文档

[只读监控手动验收](https://github.com/woyaofei303/hyperliquid-testnet-terminal/actions/runs/43824818395) 的 http、contract 两个任务均成功。公网 HTTPS、版本、首页及 JS 摘要通过；真实外部接口的市场元数据、HTTP/WebSocket 盘口、历史 K 线通过。`accountRead: false`（未配置钱包地址）、`exchangeWrites: false`，没有把这次检查写成账户或交易验收。

飞书原文已原地更新，保留[原 Wiki 地址](https://jcn890wvmzt5.feishu.cn/wiki/DX20wjBwviMIjTksJQPc8MoUno4)和个人文档库位置。更新前确认 revision 未变化，更新后回读正文及全部 25 份源码代码块。正文和代码保留原身份，实际预发布及恢复结果在本次收尾同步；不能把模拟或预发布结果替代生产验收。

## 尚未完成的验收

- 独立手机配对 relay 和真机扫码、主钱包授权尚未验收。预发布继续关闭配对，不回退生产服务。
- 没有执行真实交易、链上操作或资金转移；需要按账户、资产、动作和金额逐笔授权。
- 生产新版本尚未获准切换，15 分钟上线观察及生产手动回滚演练未执行。
- 同机预发布无法隔离整机故障；静态回滚不能撤销订单、清除浏览器待确认记录或停止已打开页面的交易能力。

本机原始日志位于实施 worktree 的 `output-tdd/ai-delivery/`，不提交凭据、完整签名载荷或真实会话记录。GitHub 运行及 PR 评论保留远端证据，短期 Artifact 保留期不代替服务器回滚版本保留。
