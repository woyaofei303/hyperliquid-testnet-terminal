# 日常发布与回滚入口

生产地址是 `https://app.fameex-testnet.xyz`，预发布是 `https://staging-app.fameex-testnet.xyz`。完整流程、操作者、失败状态与恢复命令见[中文实战手册](ci-cd-handbook.md)，完整实现见[代码附录](ci-cd-code.md)。本文件保留最常用操作及独立采集器说明。

## 开始前

在本机仓库查询源码与生产版本；保留原工作区的其他改动。

```bash
git status --short
git rev-parse HEAD
gh api repos/woyaofei303/hyperliquid-testnet-terminal/commits/main --jq '.sha'
curl --fail --silent --show-error https://app.fameex-testnet.xyz/version.txt
```

## 本地验证

```bash
npm ci
npm run lint
npm test
npm run test:deploy
npm run build:static
npm run typecheck
npx playwright install --with-deps chrome
STATIC_EXPORT=1 npm run test:e2e -- --workers=2
python3 scripts/sync-delivery-code.py --check
```

静态交互验收使用 33211 端口；日常开发仍是 3210。模拟测试不代表真实钱包交易通过。

## 发布

通过 PR 的 `ci-required` 和 CodeQL 告警门禁后合并 main；独立审查对齐最终 main SHA。Actions → **CI & Production** → Run workflow，选择 main、deploy，填当前生产版本、审查 SHA、PR 记录、风险和专项验收状态。

工作流构建一次，校验来源与全文件清单，再部署预发布。确认 smoke 和审查摘要后，由你批准 `aliyun-production`，同一个 Artifact 才能提升生产。生产进行只读 smoke 和 15 分钟版本观察。公网检查失败保留证据，人工判断，不盲目连续回滚。

发布 ID 为 `commit-run_id-run_attempt`。上传在 incoming，校验通过才进入 releases。服务器短锁与 expected_current 阻止过期候选覆盖；本机健康失败会恢复并再次核验。存在 `.deployment.json` 时必须先按手册检查中断状态。

## 回滚

先在服务器普通发布账号查询真实 current/previous，再在 Actions 选 rollback，填写二者完整 ID，并批准生产 Environment。

```bash
readlink /srv/hyperliquid/current
readlink /srv/hyperliquid/previous
cat /srv/hyperliquid/current/version.txt
```

回滚不安装 npm、不重新构建，但仍校验清单、版本和本机 HTTP。静态回滚不撤销交易、不清除浏览器待确认记录，也不能停止已打开页面。不要为了恢复网页重启采集器或删除 shared 数据。

## 初始化与运行配置

已部署生产不能重跑 `bootstrap.sh`。预发布用 `bootstrap-staging.sh`，生产旧配置迁移用 `upgrade-production.sh`，历史 current/previous 补清单用 `adopt-legacy.py`；执行位置、备份、参数和实际状态见手册第 09 章。

公开 `/runtime-config.json` 使用 no-store。生产配对 true、预发布 false；Web 只访问当前站点同源 `/pairings`，不在构建时固定生产服务。配对 Node 容器仍由 RN 仓库单独管理，Web 发布不修改消息版本、密钥或其容器。真实扫码联调需要隔离服务与真机验收。

## 旧域名重定向

`hyperliquid.sunshinedairy.net` 只保留 HTTPS 301 跳到 `app.fameex-testnet.xyz`，保留路径和查询参数。它必须继续保留 DNS、证书和代理，才能正常返回 HTTPS 重定向。日常健康检查全部使用生产主域名。

```bash
curl --head 'https://hyperliquid.sunshinedairy.net/version.txt?check=1'
```

应返回 301，Location 指向生产同路径。不同域名的浏览器存储隔离，不能手工复制旧钱包密钥。

## 主网只读采集任务

`deploy/opportunity-collector.service` 使用现有 `hyperliquid-deploy` 普通账号运行，无需 Docker 权限，也不开放 HTTP 端口。它执行既有三批计划：每批入组 30 分钟，间隔 2 小时启动，约 4 小时 45 分钟后退出。服务不自动重启、不设循环定时器；需要下一轮时再显式启动，避免重启机器或部署代码悄悄产生新样本。

代码放在 `/srv/hyperliquid/collector/releases/<提交号>/`，`current` 指向当前版本。Node 24.14.0 放在 `/srv/hyperliquid/collector/node/`，使用官方 Linux x64 发行包，下载后核对官方 SHA-256；运行依赖只需项目已锁定的 `decimal.js`。打包时保留 `scripts/campaign-opportunities.ts`、`scripts/collect-opportunities.ts`、`src/features/opportunities/lib/*.ts` 及 `node_modules/decimal.js/`，包根设置 `package.json` 的 `type` 为 `module`，`version.txt` 记录实际提交号。不要上传 `.env`、钱包存储、整个 `node_modules` 或本机试采数据。

代码提交且依赖按锁文件安装后，在本机仓库根目录打包已提交版本：

```bash
mkdir -p output-tdd/opportunity-release
task_revision=$(git rev-parse HEAD)
task_bundle=$(mktemp -d "$PWD/output-tdd/opportunity-release/package.XXXXXX")
git archive HEAD scripts/campaign-opportunities.ts scripts/collect-opportunities.ts src/features/opportunities/lib deploy/opportunity-collector.service | tar -x -C "$task_bundle"
mkdir -p "$task_bundle/node_modules"
cp -R node_modules/decimal.js "$task_bundle/node_modules/decimal.js"
printf '{"private":true,"type":"module"}\n' > "$task_bundle/package.json"
printf '%s\n' "$task_revision" > "$task_bundle/version.txt"
tar -czf "output-tdd/opportunity-release/collector-$task_revision.tgz" -C "$task_bundle" .
```

产物只包含已提交的采集源码、服务配置和最小依赖。使用现有 SSH 发布凭据上传到服务器的新提交目录，解压后先核对 `version.txt`，执行 `node scripts/campaign-opportunities.ts --help` 和 `node --test 'src/features/opportunities/lib/*.test.ts'`；两者通过才切换 `current`。首次安装尚无旧版本时创建软链接即可，后续更新使用临时链接加原子替换，并保留原链接目标供回滚。

运行目录为 `/srv/hyperliquid/shared/opportunity-collector`，采集器会在其中的 `output-tdd/opportunity-campaign/<启动时间>/` 保存协议、检查点、证据和汇总。该目录不挂到网页路由，也不与本机批次合并。网页仍在浏览器中读取公共行情，服务器任务只用于独立验证；本次没有新增让前端读取服务器结果的 API。

首次安装，在服务器以 `hyperliquid-deploy` 身份执行，先放好对应版本代码和 Node：

```bash
loginctl enable-linger
install -d -m 700 /srv/hyperliquid/shared/opportunity-collector
install -d -m 700 ~/.config/systemd/user
install -m 600 /srv/hyperliquid/collector/current/deploy/opportunity-collector.service ~/.config/systemd/user/opportunity-collector.service
systemd-analyze --user verify ~/.config/systemd/user/opportunity-collector.service
systemctl --user daemon-reload
systemctl --user start opportunity-collector.service
```

`enable-linger` 让账号退出 SSH 后任务仍可运行，不代表设置了开机自动采集。单次任务内存上限 384 MB、CPU 配额 50%，最长运行 6 小时；异常停止保留已有文件，不续写旧批次。

上线新版本时先上传到新的提交目录，用服务器 Node 运行 `--help` 和库单测验证，再原子切换 `current`。正在采集的进程继续使用启动时加载的代码；不要为了更新而中断已固定的批次。确认上一轮已退出后，`start` 才会启动新版本。现有前端 Actions 只发布静态文件，后端任务按此独立更新。

以下命令在服务器查询任务、停止任务及重算本地报告。停止会向采集器发送 SIGTERM，并保存未完成状态和取消未来批次；重算报告的目录需替换为实际启动目录。

```bash
systemctl --user status opportunity-collector.service --no-pager
journalctl --user -u opportunity-collector.service -n 30 --no-pager
systemctl --user stop opportunity-collector.service
/srv/hyperliquid/collector/node/bin/node /srv/hyperliquid/collector/current/scripts/campaign-opportunities.ts --report /srv/hyperliquid/shared/opportunity-collector/output-tdd/opportunity-campaign/替换为启动目录
```

回滚后端时，将 `current` 原子切回之前保留的提交目录，下一轮使用旧代码；不要删除或覆盖共享数据。前端仍按下面的 Actions 回滚流程操作。
