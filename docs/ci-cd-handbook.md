# AI 辅助研发、审查与 CI/CD 实战手册

本手册把一次需求从“交给 AI 写”带到“指定版本上线并能恢复”。读者是本项目的维护者 Julian。AI 负责实现和独立审查；你核对关键逻辑、验收结果，最终批准生产发布。流程沿用 npm、Biome、Husky、Node Test、Playwright、GitHub Actions 和现有阿里云服务器。

配套的[完整代码附录](ci-cd-code.md)直接包含最终 YAML、Python、Shell、运行配置和部署冒烟测试。它不是独立示例项目。CI 检查附录与源码一致；修改实现时运行 `python3 scripts/sync-delivery-code.py`。日常简短命令见[部署入口](aliyun-deployment.md)。

> **实施状态必须与设计分开。** 2026-11-16 14:58（首次本地验收快照）本次代码在 `codex/ai-delivery-pipeline` 隔离工作区，基线为 `a88634ec062a15a43b08859a4c2e07db656924fa`。原业务工作区的未提交修改没有混入。本次已创建预发布账号、目录、Nginx、HTTPS、独立 GitHub Environment 和凭据；开启 Secret scanning、Push protection、Dependabot 安全更新，生产设置了本人审批、禁止管理员绕过。新工作流尚未提交到远端运行，Ruleset 文件目前为 `disabled`，不能说主分支门禁已经验收通过。受控发布、预发布故障演练及生产回滚演练待发布分支进入 GitHub 后执行。

## 01 当前系统：请求、文件、账号和秘密在哪里

用户打开 `https://app.fameex-testnet.xyz`，Caddy 终止 HTTPS，再向本机 `127.0.0.1:8089` 转发。Nginx 读取 `/srv/hyperliquid/current` 指向的静态文件。浏览器下载 JS 后直接向 Hyperliquid 测试网读取行情、提交用户授权的请求；服务器不保存交易钱包密钥。

阿里云控制台实际资源是**轻量应用服务器**，位于韩国首尔，公网 IP `47.80.28.238`，Ubuntu 24.04。旧计划统一称 ECS；这里按现场控制台名称纠正。2 vCPU / 2 GiB / 40 GiB 属于同机资源，预发布不能隔离整机故障。

```text
生产：app.fameex-testnet.xyz
  hyperliquid-deploy → /srv/hyperliquid → 127.0.0.1:8089
  GitHub Environment: aliyun-production
预发布：staging-app.fameex-testnet.xyz
  hyperliquid-staging-deploy → /srv/hyperliquid-staging → 127.0.0.1:8090
  GitHub Environment: aliyun-staging

每个 Web 根目录：
  incoming/<release-id>/    上传中的普通目录，不被网站读取
  releases/<release-id>/    校验过的版本，不能覆盖为不同内容
  current                  当前版本软链接
  previous                 上一成功版本软链接
  shared/_next/static/     新旧页面共用的哈希资源，不自动清理
  .deploy.lock             服务器短锁
  .deployment.json         切换前状态；存在就阻止下一次发布
```

SSH 私钥只在本机 SSH 目录和对应 Environment Secret。服务器存公钥；部署普通账号没有 sudo、Docker 管理权限。配置文件是公开开关，不含秘密。预发布 Nginx 配置放在 `/etc/hyperliquid-staging`；生产沿用 `/srv/hyperliquid/config`。采集器位于 `/srv/hyperliquid/collector`，结果在 `shared/opportunity-collector`；Web 发布器不访问这些目录或 systemd 服务。

**操作者 / 位置 / 类型：**维护者，本机仓库，查询。开始工作先记录三种状态，任何一步失败先修复连接，不以另一种状态代替：

```bash
git status --short
git branch --show-current
git rev-parse HEAD
gh api repos/woyaofei303/hyperliquid-testnet-terminal/commits/main --jq '.sha'
curl --fail --silent --show-error https://app.fameex-testnet.xyz/version.txt
```

本次原工作区 HEAD 是 `838900642b17730c99d6a80e6c8db7c0a357c46b`，远端 main 和生产源码是 `a88634ec062a15a43b08859a4c2e07db656924fa`。线上完整版本为 `a88634ec062a15a43b08859a4c2e07db656924fa-43708795815-1`。这些是本次核查值，不是下次发布应复制的预期版本。保存输出到发布记录；生产 version 与预期不一致时停止，不重试覆盖。

## 02 从需求得到验收条件与风险等级

贯穿案例是“用户输入 100 USDC，希望按当前规则市价买入”。先写清楚这是现货消费预算，还是永续合约名义金额；二者不等于同一笔保证金，也不能默认为允许额外手续费或滑点支出。本文用现货作为余额重读例子，用 BTC 数量换算演示精度。

需求写成能从界面或请求观察到的结果：正数金额可以预览；非法数字、零、负数、超精度、低于门槛必须在签名前阻止；预览后可用余额从 100 降为 50，最终确认不能发订单；网络超时后只能查询原业务标识，刷新也不能自动重发。

**操作者 / 位置：**维护者在需求与 PR 中填写 `.github/pull_request_template.md`。输入是需求与相关文件，输出是验收条件、范围和风险。缺少预算、手续费、账户模式含义时先补定义，不能让 AI 自行决定资金语义。

```text
要解决的问题：
用户可观察到的结果：
本次不包含什么：
风险等级及原因：
入口、调用方、共享逻辑、外部接口：
正常场景：
边界与失败场景：
兼容和回滚方式：
验证命令与实际结果：
独立审查对应的提交 SHA：
尚未验证的部分：
```

低风险是文案、样式及不改变行为的展示。中风险是状态、行情、缓存、错误恢复和一般依赖。高风险是签名、订单、资金、持久化待确认状态、权限、依赖安装脚本、工作流与部署脚本。本次交付管线属于高风险。编译、截图和 AI 的结论都不能代替高风险验收。

## 03 给 AI 的编码任务及允许修改的范围

**操作者 / 位置：**维护者在新的编码会话给出下列任务；AI 在独立分支修改；输入包含验收条件和实际调用链。输出是可检查的差异、针对行为的测试和验证证据。现有工作区有业务修改时，从核准的 main 建立 worktree，不能直接整理或提交别人的修改。

```text
需求：实现以下可观察结果……
基线提交：……；允许修改的文件与调用链：……
必须保持：测试网限制、账户生命周期校验、未知回执禁止重发、共享数据不删除。
验收：正常……；边界……；失败……；恢复……
先读取入口、调用方、共享函数、测试和 AGENTS.md，再写代码。
新增依赖、接口或配置前，解释现有实现为什么不够。
不要复制真实秘密、钱包签名载荷、二维码内容或真实会话记录。
交付实际差异、验证命令和结果、未验证项；不自行签名、交易、提交、推送或发布。
```

保持测试在边界上：金额校验断言“拒绝请求”，网络丢失断言“总写入次数仍为 1”，不是只断言内部变量等于实现刚赋的值。测试发现已有实现满足条件时补证据即可，不重写交易层。模拟环境中出现真实 `/exchange` 请求必须视为测试失败。

## 04 沿一次买入读完输入、确认、签名、请求和回执

业务链采用本次基线的真实实现。固定提交入口：[use-terminal.ts](https://github.com/woyaofei303/hyperliquid-testnet-terminal/blob/a88634ec062a15a43b08859a4c2e07db656924fa/src/features/terminal/hooks/use-terminal.ts)、[use-cash-order-form.ts](https://github.com/woyaofei303/hyperliquid-testnet-terminal/blob/a88634ec062a15a43b08859a4c2e07db656924fa/src/features/trading/hooks/use-cash-order-form.ts)、[cash-order.ts](https://github.com/woyaofei303/hyperliquid-testnet-terminal/blob/a88634ec062a15a43b08859a4c2e07db656924fa/src/features/trading/lib/cash-order.ts)。阅读新业务分支时必须换成其实际 SHA，不能把这里的基线审查当作覆盖新改动。

1. 用户在下单表单输入字符串。`order-sizing.ts::sizeFromAmount` 用 Decimal 计算；`orders.ts::positiveDecimal` 拒绝非有限和非正数。`sizeFromAmount('100', 'usdc', '70000', 5)` 得到 `0.00142` BTC，按参考价是 99.4 USDC。数量向下取整只保证这个参考计算不超预算；它**不证明**包括滑点、手续费的最终支出仍为 100。
2. `orders.ts::prepareOrder` 校验资产编号、数量小数位、价格规则和最小金额。市价实际构造带价格上限/下限的 IOC（立即成交，剩余撤销）订单；现货买入还需在 `cash-order.ts` 按订单最坏价格、手续费和可用余额核对。
3. `use-cash-order-form.ts::preview` 读取 `loadCashFunds`，准备 `prepareCashTicket`，交给 `useTerminal::previewTicket`。确认框保存账户、市场、参数和时间；这里没有交易写入。
4. 用户确认触发 `useTerminal::execute`。先锁定重复点击，核对账户，再为现货 ticket 重新读取余额和手续费；查询回来还要核对 `activeWallet.current`。`validateCashTicketFunds` 失败就退出，既不生成交易签名也不发请求。
5. `trading.ts::submitTrade` 检查未确认记录和 15 秒预览有效期。普通订单交 `wallet.exchange.order`，批量 ticket 交 `submit-ticket.ts::submitOrderTicket`。请求前调用 `onPending` 保存 `cloid`（客户端订单业务标识）、账户和有效期；页面 `storePending` 负责写 localStorage。保存抛错时，后续网络发送不会执行。
6. `shared/lib/fameex-testnet.ts` 的钱包适配器负责测试网会话和签名前的账户生命周期核对；主钱包资金操作与 API 代理订单签名是不同协议。不要把它们合并成一个任意 action 的通用签名入口。
7. `orders.ts::orderResult` 校验业务回报；HTTP 200 不等于成交。`batchOrderResults` 逐笔解析并核对数量，部分拒绝返回 `partial-rejected`，未知结果保留 `pending`。页面显示真实状态并刷新账户。
8. 请求已发而响应丢失时，不再次调用 order。`useTerminal::reconcile` 用原 cloid 只读查询，刷新后 `loadPending` 恢复保护。清除存储失败时原持久记录仍在，刷新可重新进入查询；不能把存储异常描述为“保存完成”。

下面是实际关键计算代码，完整函数与测试见 [order-sizing.ts](https://github.com/woyaofei303/hyperliquid-testnet-terminal/blob/a88634ec062a15a43b08859a4c2e07db656924fa/src/features/trading/lib/order-sizing.ts)：

```ts
export function sizeFromAmount(
  amount: string,
  unit: 'base' | 'usdc',
  price: string,
  precision: number,
) {
  const quantity = positiveDecimal(amount, unit === 'base' ? '数量' : '金额')
  return unit === 'base'
    ? quantity.toFixed()
    : quantity
        .div(positiveDecimal(price, '价格'))
        .toDecimalPlaces(precision, Money.ROUND_DOWN)
        .toFixed()
}
```

**操作者 / 位置 / 类型：**AI 与维护者，本机仓库，模拟验证。以下命令沿真实测试边界检查；失败停在本机，生产不受影响。调试从第一个失败断言和 trace 入手，不能改成 skip。

```bash
node --test src/features/trading/lib/order-sizing.test.ts src/features/trading/lib/orders.test.ts src/features/trading/lib/cash-order.test.ts src/features/trading/lib/submit-ticket.test.ts
STATIC_EXPORT=1 npm run test:e2e -- --workers=2 --grep '响应丢失|账户切换|确认期间切换账户|确认重读余额|待确认记录|手机配置|生成配对前'
```

现有测试覆盖数量/价格边界、舍入预算、HTTP 成功但拒单、批量部分失败、预览后余额变化、账户切换、响应丢失刷新恢复。新增测试覆盖配对配置故障和待确认存储失败。每次金融逻辑变更仍须补充其实际触发场景：行情过期、返回结构变化、签名期间市场/模式变化、超时、模块重挂载、未知回执。不能把测试标题相似当成完整覆盖，更不能把模拟当成真实交易。

真实测试网验收必须由你逐笔授权，记录公开账户、资产、具体动作、金额上限、手续费/滑点约束、预期结果和授权期限。自动 CI 不连接真实钱包，不自动下测试单。本次没有执行任何真实签名或交易。

## 05 独立 AI 审查与人工复核

**操作者 / 位置：**维护者开新的 Codex 上下文，提供需求、base SHA、head SHA 和仓库路径；审查者只读实际差异和调用链。输出是带证据的问题列表，最后由你逐条核对并保存在 PR 中。

```text
请独立审查指定 base SHA 到 head SHA 的改动。
先读取需求、项目约束、完整差异和相关调用链，再核对：
1. 行为是否满足需求，是否改变未授权行为。
2. 输入、精度、账户、权限和异步状态边界是否可靠。
3. 失败、超时、部分成功、重复请求和结果未知如何处理。
4. 测试是否能发现错误，而非复述当前实现。
5. 是否引入秘密泄漏、危险依赖、过度抽象或不可回滚变化。
6. 文档中的命令、接口和结果是否与代码一致。
每个问题提供严重程度、文件位置、触发条件、具体后果、可复现证据、
最小修复建议与回归测试。没有证据的怀疑单独标记。
不修改代码，不提交、发布、签名或操作资金。
```

严重问题修复、回归通过后重新审查；普通问题记录处理或不采纳理由。修改代码后旧审查不再覆盖新的 SHA。若 squash/merge 产生新提交，需要审查最终 main 与已审查树的差异；发布输入 `reviewed_sha` 必须等于这次运行的完整 `GITHUB_SHA`。

你重点检查：钱在哪个账户、精度和方向是否正确、签名前有没有最后核对、未知结果是否仍受保护、测试断言是否证明不重发、部署失败是否真恢复。AI 报告没有问题也不能直接替代这个判断。

```text
审查记录
需求/PR：
base SHA：
head SHA：
审查上下文：独立 Codex 会话
发现：严重程度 / 文件位置 / 触发条件 / 后果 / 证据
处理：修复提交 / 回归命令结果 / 复审结论
不采纳项与理由：
人工复核人、时间、覆盖 SHA：
真实验收范围与未验证项：
```

## 06 本地检查、提交检查和 PR

**操作者 / 位置：**开发者，本机仓库。输入为当前差异和锁文件；成功输出为检查全部退出 0。先核对环境 Node ≥24、Python ≥3.11、Chrome 与仓库对应 Playwright。Next.js 的生成类型影响 typecheck，因此干净工作区先构建再做全量类型检查。

```bash
npm ci
npm run lint
npm test
npm run test:deploy
npm run build:static
npm run typecheck
npx playwright install --with-deps chrome
STATIC_EXPORT=1 npm run test:e2e -- --workers=2
bash scripts/install-ci-tools.sh
output-tdd/ci-tools/actionlint
shellcheck deploy/*.sh scripts/install-ci-tools.sh
output-tdd/ci-tools/gitleaks git --log-opts=HEAD --redact --no-banner
npm audit --audit-level=high
python3 scripts/sync-delivery-code.py --check
```

`npm ci` 依据 package-lock 安装，不更新依赖；本地 prepare 安装 Husky。`.husky/pre-commit` 顺序是 lint-staged → typecheck → npm test。lint-staged 只格式化暂存文件；钩子失败会阻止提交。不要为绕过失败临时设 `HUSKY=0`。CI 因不执行 Git commit 可以设此变量，它不会跳过显式 npm 检查。

本机审核差异后再提交、推送并开 PR。自动助手按项目规则需要你明确授权这些 Git 写入；开发者自己执行时照常操作。不要把原工作区别的业务改动一起 stage。PR 填写实际命令、运行链接、跳过项和审查 SHA，禁止粘贴真实秘密。

测试范围分三类：`test:e2e` 是模拟交互，配对测试使用同源拦截，必须实际执行；`PERF_CHECK=1` 是单独性能观察；`test:live` 与 `verify:read` 是实际外部服务只读验证。默认两个性能场景跳过，`@live` 被过滤，均应在报告里说明。CI 上传 Playwright 证据 7 天；发布记录须保留摘要，不能依赖临时 runner。

## 07 CI 的 job、变量、条件与退出码

完整工作流见代码附录。`.github/workflows/deploy-aliyun.yml` 对 PR 和 main push 只检查；只有 `workflow_dispatch` 且 ref 是 main 才能进入环境部署。

- `verify`：锁文件安装、Biome、Node 单测、Python 发布测试、静态导出、类型、Chrome 模拟交互。最后生成清单，手动 deploy 才保存 Artifact。任何命令非零会停止后续步骤；测试证据用 `always()` 保留。
- `security`：无安装脚本的依赖安装、High/Critical 阈值 audit、固定版本并校验下载哈希的 actionlint/Gitleaks、ShellCheck、Compose 校验。Gitleaks 扫候选提交的完整祖先历史（PR 包含合并父提交）；显式指定 GITHUB_SHA，避免默认 --all 把无关分支或未合并演练样本混入。唯一历史放行是 `.gitleaksignore` 中公共合约地址的具体 fingerprint，不能放行整个测试目录。
- `codeql`：JavaScript/TypeScript、Python、Actions 三种语言的安全扩展查询；最小 `security-events: write` 只用于扫描结果。它没有部署 SSH Secret。分析成功不代表没有高危告警，结果还须由 Ruleset 阻断。
- `ci-required`：固定名称，依赖 verify/security/codeql，`always()` 后显式核对每个结果必须是 `success`。失败、取消或跳过都不能伪装通过。专用 rollback 不运行这条构建路径。
- `attest`：所有必需检查通过，审查 SHA 与本次 SHA 一致，PR 链接属于本仓库；高风险要求确认专项验收记录。为 manifest 生成 GitHub 原生来源证明。
- `staging` → `production`：调用同一个 reusable workflow；生产 job 在 Environment 审批前不会获得环境 Secret 或启动上传。
- `rollback`：独立人工入口，直接执行服务端校验与切换；不依赖 npm 安装、构建或 Chrome 下载。

默认 token 是只读。Action 用完整提交固定版本；不使用 pull_request_target 执行 PR 代码。新增 Action 必须查发布来源。fork PR 的权限由 GitHub 进一步收窄。GitHub 官方说明：[Actions 安全](https://docs.github.com/en/actions/reference/security/secure-use)、[Code scanning 合并保护](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/manage-your-configuration/set-merge-protection)。

Artifact 名称为 `release-<commit>-<run_id>-<attempt>`，不覆盖同名对象，保留 30 天。文件上传为 out，运行配置在构建命令后删除。`release-manifest.json` 包含 schemaVersion、releaseId、commitSha、runId、runAttempt、每个文件 SHA-256；清单不计算自身。证明签清单，清单覆盖所有文件。失败或取消的旧运行不能被手工选为“最新产物”；本流程只接受当前候选运行的精确 Artifact ID。

`release-environment.yml` 先用 GitHub API 核对 Artifact 名字、未过期、head SHA、run ID、main，再下载指定 ID，验证 attestation 的仓库、签名工作流、源码 ref/digest，最后用 Python 核对目录内容。它证明来源和完整性，不证明没有漏洞。见[产物证明](https://docs.github.com/en/actions/concepts/security/artifact-attestations)。仅重跑失败 job 可能沿用旧 attempt 的产物，校验会拒绝；应重跑全部 jobs 产生新的完整发布 ID，不关闭校验。

## 08 GitHub Ruleset、Environment、Variables、Secrets

**操作者 / 位置 / 类型：**仓库管理员，GitHub Settings 或本机 gh，权限配置写入。输入是通过的远端 CI 和已核准的配置。先备份查询 JSON，再应用；API 错误时保留原状态与响应，不把文件存在当作服务器设置成功。

在 Settings → Code security 确认 Secret scanning、Push protection、Dependabot alerts 和 security updates 开启。每个依赖更新通过 PR 跑检查，不启用自动合并。首次发现历史问题，修复或逐项记录合理的具体误报；不全局忽略、不设 continue-on-error。

Settings → Environments：

```text
aliyun-staging:
  Deployment branches: Selected branches → main
  ALIYUN_HOST=47.80.28.238
  ALIYUN_USER=hyperliquid-staging-deploy
  ALIYUN_PORT=22
aliyun-production:
  Deployment branches: Selected branches → main
  Required reviewers: woyaofei303
  Prevent self-review: 不选（个人维护）
  Allow administrators to bypass: 关闭
  ALIYUN_HOST=47.80.28.238
  ALIYUN_USER=hyperliquid-deploy
  ALIYUN_PORT=22
各环境独立 Secrets:
  ALIYUN_SSH_PRIVATE_KEY
  ALIYUN_SSH_KNOWN_HOSTS
```

不要把这两项改成 Repository Secrets；PR job 不声明 Environment，也不读取部署凭据。只用已核验主机指纹，不能用关闭 StrictHostKeyChecking 解决连接失败。本次预发布公钥独立；生产私钥未轮换。个人批准自己的部署是明确的单人放行，并非双人复核。[GitHub Environment 文档](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)。

`.github/main-ruleset.json` 是可复制的完整规则，初始 disabled 避免引用尚未存在的 CI 检查。**只有新工作流已在远端实际通过、CodeQL 已有结果后**，在本机执行下列写入。先查询同名规则；已存在则 PUT 对应 ID，不重复创建。

```bash
gh api repos/woyaofei303/hyperliquid-testnet-terminal/rulesets
jq '.enforcement="active"' .github/main-ruleset.json > /tmp/main-delivery-gates.json
gh api --method POST repos/woyaofei303/hyperliquid-testnet-terminal/rulesets --input /tmp/main-delivery-gates.json
```

规则包括必须 PR、严格最新分支、ci-required、讨论已解决、禁止强推与删除、无日常 bypass；不要求个人项目无法满足的第二人审批。CodeQL 的安全阈值 `high_or_higher`、普通告警 `errors`。

**门禁验证：**开一个明确标为测试的 draft PR，分别制造失败断言、Gitleaks 的合成测试检测值和可被 CodeQL 识别的高危测试分支；只放可公开的合成值，不用真实密钥、不合并。保留失败 job 与合并被阻断的截图/状态，修复后检查重新放行，再关闭测试 PR。Secret scanning 的 Push protection 可能在上传前拦截，须把这项与 CI Gitleaks 拦截分别记录。本次还没有做远端失败 PR 演练。

## 09 预发布服务器初始化及生产配置迁移

**操作者 / 位置 / 类型：**管理员，服务器终端，系统配置写入。先在本机生成独立 ed25519 密钥，私钥不能上传服务器；把 `deploy/` 和公钥放到经校验的管理员工作目录。本文命令的 `/root/hyperliquid-setup-20261116` 是本次真实安装目录，后续操作按自己的已核验路径替换。

```bash
sudo -n id
id hyperliquid-staging-deploy
ss -lnt | grep ':8090'
ls -ld /srv/hyperliquid-staging /etc/hyperliquid-staging
```

首次执行时账号/路径应不存在，端口无监听；发现已有资源就停止调查。查看 `bootstrap-staging.sh`：先备份 Caddy，创建普通账号和隔离目录，安装 root 配置，Compose 校验并启动新 Nginx；随后生成合并后的 Caddy candidate，`caddy validate` 成功才覆盖并 reload。错误处理恢复两个代理配置并尝试重新加载；初始化中途失败保留资源，不盲目重跑或删除。

```bash
sudo -n bash /root/hyperliquid-setup-20261116/deploy/bootstrap-staging.sh /root/hyperliquid-setup-20261116/staging.pub
```

本次备份位置 `/root/hyperliquid-deploy-backups/staging-20261116-144409`。DNS `staging-app` A 指向 47.80.28.238，TTL 10 分钟。本次实际验证 HTTPS 的 `/runtime-config.json` 返回 false；新账号无生产写权限、无 Docker/sudo。没有 current 版本时网页尚未发布，不能把配置接口成功描述为预发布应用验收通过。

生产已有账号与目录，**禁止重跑 bootstrap.sh**。`upgrade-production.sh` 仅接受本次已核查的旧 nginx/compose SHA，先备份，再添加 runtime-config 与 Nginx 路由，原地更新 bind mount 的文件并热加载，不重建配对或采集容器。它对 reload 后短暂旧进程响应进行有限重试；失败恢复配置并明确报告失败。

```bash
sudo -n bash /root/hyperliquid-setup-20261116/deploy/upgrade-production.sh
```

环境配置独立提供，不进入 Artifact：生产 true，预发布 false，均 `Cache-Control: no-store`。Web 只用本站 origin 的 `/pairings`，HTTPS 正式域名；配置失败、schema 非 1、非布尔 true 都关闭。`create` 和 `approve` 在任何自动撤销/授权签名前再次读取。预发布 Nginx 的配对路由固定 503，不代理到生产。RN 消息 version 仍为 1；真机联调必须另建隔离 relay 并逐笔授权，不能靠把预发布开关改 true 直接连生产服务。

旧生产版本没有 manifest。`adopt-legacy.py` 只给指定 current/previous 补当前文件哈希清单：同时核对链接、version 和全目录，生成 `.legacy-adoption.json`，标记 `legacy-server-baseline-not-attested`。它不改变链接，不补造来源证明。这是首次改造的迁移边界；新候选仍必须通过签名证明。若两个版本或文件有异常，停止并人工调查。

```bash
# 在服务器 hyperliquid-deploy 账号执行；两个参数先按 readlink/version 核对
python3 /home/hyperliquid-deploy/ai-delivery-tools-20261116/adopt-legacy.py \
  --current a88634ec062a15a43b08859a4c2e07db656924fa-43708795815-1 \
  --previous 140a2140cd2a6377d3d9385cd76172fe444f56d8-43349966499-1
```

本次已执行这一步并验证“未切换版本”。生产公开配置也已热加载成功，配置备份位于 `/root/hyperliquid-deploy-backups/runtime-20261116-144612`。后续日常版本不使用该迁移工具。回滚需要的服务器版本独立保留，GitHub Artifact 到期不影响它们；也不要据此删除服务器旧版本。

## 10 构建、上传、校验、切换和上线验收

**操作者 / 位置：**你在 GitHub Actions → CI & Production → Run workflow；选择 main、deploy，填实际当前生产版本、最终审查 SHA、PR 证据链接、风险和专项验收确认。它只启动候选流程，生产仍等待 Environment 批准。下面命令是同一操作的 gh 形式，变量要填实际记录：

```bash
task_sha=$(gh api repos/woyaofei303/hyperliquid-testnet-terminal/commits/main --jq '.sha')
task_current=$(curl --fail --silent --show-error https://app.fameex-testnet.xyz/version.txt)
gh workflow run deploy-aliyun.yml --ref main \
  -f operation=deploy -f expected_current="$task_current" \
  -f reviewed_sha="$task_sha" -f review_url="$REVIEW_PR_URL" \
  -f risk=high -f specialized_checks=true
```

此处 `specialized_checks=true` 是你的明确声明，不能由 AI 因测试“看起来足够”自动填写。涉及资金或手机授权而专项验收未完成时，不发起生产放行。PR 链接和 SHA 校验只是防误选，机器不能判断审查内容是否充分。

Runner 构建一次，模拟交互验证后保存唯一产物并证明清单来源。预发布下载验证后，`publish.sh` 把文件 rsync 到该环境 `incoming/<id>`。网络断开只留下未发布目录。`release.py::deploy` 获取项目 flock，核对 `expected_current`，验证 manifest、路径、文件/哈希、无符号链接/秘密/多余文件，才 rename 为 releases。已存在不同内容不覆盖；共享资源同路径不同哈希停止。

锁覆盖服务端校验、资源复制、切换和本机健康检查，不包含构建和上传。切换前写 `.deployment.json` 并 fsync；current 单链接原子替换，核对本机 version、首页和关键 JS 的哈希后再替换 previous。**两个链接不是一个整体事务。**中断靠记录发现并人工恢复；不能宣称断电时所有文件系统操作自动回滚。

预发布完成后，独立 smoke config 接收 URL 与预期 ID，不启动本地开发服务器。它检查 TLS（由浏览器/curl 正常证书校验）、版本/no-store、运行配置/no-store、manifest、首页和关键资源 hash、404、界面三块区域、实际只读行情、致命 pageerror。浏览器不注入钱包，只允许读取和指定测试网 `/info` POST，阻断 `/exchange` 等写请求。

```bash
SMOKE_BASE_URL=https://staging-app.fameex-testnet.xyz \
EXPECTED_RELEASE_ID="$RELEASE_ID" EXPECT_PHONE_PAIRING=false npm run test:smoke
```

成功后查看 staging 摘要与下面发布记录；你批准 aliyun-production。生产再次验证**同一 Artifact ID**和来源，然后用启动时填写的生产旧版本做比较。期间若有人发布/回滚改变 current，这个候选会停止；重新查询并重新审批，不能修改 expected_current 后蒙混继续。

生产立即做相同 smoke，随后每分钟检查版本，共 15 分钟。公网异常标记失败、保留证据，请人工判断网络、CDN、证书或应用；不自动反复切换。定时 HTTP 每 10 分钟计划运行，每日另跑实际只读契约，GitHub 通知负责告警。调度可能延迟，不承诺 SLA。

```text
发布记录（审批前完整填写）
需求 / PR / 风险：
源码 SHA / 独立审查 SHA / 人工核对记录：
run ID / attempt / URL / 全部必需检查：
Release ID / Artifact ID / manifest SHA-256 / 证明校验结果：
预发布 URL / runtime-config 摘要 / smoke 结果：
预发布差异：phonePairingEnabled=false
当前生产版本 / previous / 计划回滚目标：
专项资金/配对验收或不适用原因：
尚未验证：
批准人 / 时间 / 明确批准的 Release ID：
生产切换结果 / smoke / 15 分钟观察：
```

## 11 超时、部分失败、回滚及紧急恢复演练

**正常失败状态：**构建或安全失败停在 GitHub，未上传；上传中断停在 incoming；清单、磁盘、资源冲突、旧版本比较失败发生在 current 切换前；本机健康失败尝试恢复旧 current/previous，再检验旧版本。旧版本健康仍失败时打印“恢复失败”并保留 journal，后续发布全部停止。

**操作者 / 位置 / 类型：**你在 GitHub 手动 rollback，生产仍需 Environment 审批；输入为服务器当前与 previous 的实际完整 ID。rollback 校验目标清单和预期 current，使用同一健康检查，不重新 npm/build。

```bash
gh workflow run deploy-aliyun.yml --ref main \
  -f operation=rollback -f expected_current="$CURRENT_RELEASE" \
  -f rollback_target="$PREVIOUS_RELEASE"
```

紧急入口由普通生产发布账号在服务器执行已核对版本的 `release.py`。先查询再动作，命令必须指向当前部署脚本，不从未审查的网上脚本 pipe 到 shell。

```bash
readlink /srv/hyperliquid/current
readlink /srv/hyperliquid/previous
cat /srv/hyperliquid/current/version.txt
cat /srv/hyperliquid/.deployment.json
```

没有 journal 时 `cat` 报不存在是正常查询结果。有 journal 时先保存证据；记录 old/previous/target，核对 current 是 old 或 target，确认恢复目标文件完整。`--recover` 的 expected-current 必须填**现在**的版本；无 current 填 none。它不猜测应继续上线。

```bash
DEPLOY_ROOT=/srv/hyperliquid \
DEPLOY_HEALTH_URL=http://127.0.0.1:8089/version.txt \
DEPLOY_HOST_HEADER=app.fameex-testnet.xyz \
python3 /home/hyperliquid-deploy/ai-delivery-tools-20261116/release.py \
  --recover --expected-current "$ACTUAL_CURRENT_RELEASE"
```

若恢复失败，不删除 journal 后盲目再发。检查磁盘/inode、目录所有者、manifest 和 Nginx 错误日志；先恢复被验证的旧文件/配置，再用 recover 重试。current 指向目录外或版本名称异常仍拒绝恢复；被撤下 current 的文件损坏不再阻止 rollback/recover。将启用的旧版本必须完整通过清单和健康检查，不能手工跳过。恢复后需保留损坏版本证据并调查原因。

演练分两步：先在预发布上传一份已验证候选，注入错误的本机健康 URL，使切换失败，记录恢复旧版的耗时和二次健康；再在生产批准的候选上线后，用独立 rollback 入口回到事先确认的 previous，做相同 smoke，记录恢复耗时。演练需要真实已发布版本；Python 临时目录测试只证明实现分支，不等于现场演练。本次现场两项尚待执行。生产运行配置迁移曾因 reload 交接时的短暂 404 自动恢复，修正有限重试后成功；这是配置恢复证据，不能替代应用版本回滚演练。

```text
故障 / 回滚记录
开始时间 / 发现方式 / 环境：
原 current / 原 previous / 候选 ID：
失败阶段与退出码 / 首个错误 / run URL：
文件与 journal 证据位置：
恢复动作 / 操作人 / 目标：
本机健康 / 公网健康 / 配置摘要：
恢复完成时间 / 实测耗时：
未恢复数据或功能 / 后续修复：
```

静态回滚不撤销已成交订单或资金操作，不清除浏览器 pending，不恢复旧签名能力。已打开的页面仍可能运行旧代码并访问交易所；服务器切换不是全局交易停止开关。需要停止风险时应由账户持有人按交易所流程处理委托、授权和资金，而不是假设重启网站能撤单。

## 12 日常维护、依赖更新、密钥轮换和证据

每天关注 GitHub workflow 失败与安全告警。Dependabot PR 按风险阅读 changelog、安装脚本和实际差异，再跑相同门禁；不要因为来源是机器人就自动合并。新发现高危依赖需要修复或明确停止发布；本次 `npm audit --audit-level=high` 通过；53 个低危条目来自 deepmerge 的同一原型污染公告 GHSA-gcqx-w48m-w2h4 及其依赖链，保留为待兼容性复核的依赖基线，不执行可能破坏 HeroUI 的强制升级。这不等于所有依赖无风险。

每周由普通账号查询空间，管理员查询容器日志；以下均只读：

```bash
df -h /srv/hyperliquid /srv/hyperliquid-staging
df -i /srv/hyperliquid /srv/hyperliquid-staging
du -sh /srv/hyperliquid/releases /srv/hyperliquid/shared/_next/static
readlink /srv/hyperliquid/current
readlink /srv/hyperliquid/previous
```

没有自动 prune。清理前列出精确候选、排除 current、previous、journal 涉及版本和演练保留版本；老页面可能长期需要 shared 哈希资源。先归档并验证可恢复，再按明确批准范围删除。不要递归删除 shared，更不能删除采集数据。

密钥轮换先生成新密钥，服务器临时同时接受旧新公钥，用新钥验证访问范围，更新对应 Environment Secret，完成一次受控验证后移除旧公钥。不同环境分别轮换；管理员密码/云账号不放 Actions。记录指纹和时间，不记录私钥正文。紧急撤销泄露密钥时先停止相关发布、撤销被泄露访问，再审计其时间窗口。

本次本机验证证据保存于隔离工作区 `output-tdd/ai-delivery/`。已运行：Node 单测、Python 发布/迁移测试、静态构建、类型、Biome、Actionlint、ShellCheck、Compose 配置、Gitleaks、High 阈值 audit、完整模拟交互与新增专项、独立部署 smoke。实际只读契约验证市场元数据、HTTP/WebSocket 盘口与历史 K 线；未配置钱包地址的 accountRead 为 false，exchangeWrites 为 false，不能写成账户/交易验收通过。

本次最终本机结果：188 项 Node 单测、18 项 Python 发布/迁移/恢复测试、174 项模拟浏览器交互通过，2 项性能场景按显式开关跳过；独立部署 smoke 在本机和原生产版本各通过 1 项。独立审查发现并修复了“损坏 current 阻断回滚”问题，新增 2 个回归先失败后通过。实际 pre-commit 脚本、独立临时 index 的 lint-staged、构建、类型、Biome、ShellCheck、Actionlint、Compose、Gitleaks 和 audit High 阈值均通过。

发布前用当次最终报告覆盖记录里的测试数量；曾经通过的日志不代表后续差异也通过。若不能完成 GitHub 门禁演练、生产审批或真机/资金验收，保留“待完成”和具体阻塞，不能把操作手册改写成全部实施完成。

飞书原文保留身份和地址：[在线手册](https://jcn890wvmzt5.feishu.cn/wiki/DX20wjBwviMIjTksJQPc8MoUno4)。同步前重新读取最新 revision 并备份，再原地更新，回读代码块、正文与链接，并确认仍在个人“我的文档库”。不要新建同名副本，也不要覆盖同步期间他人的新增内容。
