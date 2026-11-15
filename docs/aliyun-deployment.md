# 发布到阿里云

网站使用 `https://app.fameex-testnet.xyz`。沿用原 `dy` 站点的方式：GitHub Actions 构建静态文件，阿里云 Nginx 提供文件，现有 Caddy 负责 HTTPS。行情和钱包请求由浏览器直接发往测试网，不经过应用服务器。扫码配对新增独立的 Node.js 容器，仅转发短时密文，不保存钱包密钥。

`NEXT_PUBLIC_PHONE_PAIRING_URL` 在 CI 构建时固定为本站 HTTPS 地址；`/pairings` 与 `/pairings/…` 转给同一 Docker 网络的 `phone-pairing:3211`。配对容器由 RN 仓库的 `deploy/pairing.compose.yml` 管理，构建和安装见该仓库 `deploy/README.md`。首次安装需要管理员部署容器、备份并更新本站 Nginx 配置；普通 Web 发布账号没有 Docker 权限，日常静态发布也不会更新配对容器。

域名迁移已于 2026-11-07 完成：`app.fameex-testnet.xyz`、`dy.fameex-testnet.xyz`、`live.fameex-testnet.xyz` 的 A 记录均指向 `47.80.28.238`，三个站点的 HTTPS 均返回 200。`hyperliquid.sunshinedairy.net` 保留为直达 `app.fameex-testnet.xyz` 的 301 跳转入口，保留路径和查询参数。旧 `dex`、`testnet`、`dy`、`live` 解析与代理入口已移除，运营商缓存需等待原 TTL 到期。

`live` 的公开构建域名、SEO、Caddy `DOMAIN`、HLS 和 WebRTC 允许的来源已同步更新。健康接口、SEO 检查及两种媒体协议的跨域预检均通过；本次未实际开播。

本次手工发布的交易站版本为 `4b1a6fdbfaa8c05884d62999d13dd057aa182a0e-20261107214515-1`，在该提交上仅应用本次域名修改后构建。最终切换前的服务器配置备份位于 `/root/hyperliquid-deploy-backups/final-fameex-20261107T135254Z`；其中 `restore-map.json` 记录备份与原路径对应关系，含运行时秘密的备份仅管理员可读。需要恢复域名配置时，先确认停播，按映射恢复文件并重建 Streamlab 服务；不要直接覆盖在线配置或删除录制卷。

本站使用独立的 `/srv/hyperliquid` 目录、`hyperliquid-deploy` 普通账号、`hyperliquid` Compose 项目及 `127.0.0.1:8089` 端口。原 `dy` 和 `live` 站点继续使用各自的服务。新增的代理片段写入 `shared/extra-sites.caddy`，避免原 Streamlab 发布时丢失本站配置。

页面和 npm 包统一命名为 `fameex-testnet`。以上部署资源、旧域名跳转和 GitHub 仓库地址保留现状；项目更名不迁移服务器目录或账号，发布与回滚继续使用原路径。

## 一次发布的过程

例如修改下单按钮后，先把代码提交并推送至 GitHub。推送 `main` 只运行检查；在 Actions 的 **CI & Production** 中选择 `main`、`deploy`，才会发布。

检查依次执行 npm 锁文件安装、发布回滚测试、Biome、业务测试、静态构建、类型检查及模拟钱包的浏览器测试。全部成功后，工作流保存同一份 `out/` 产物，再通过专用 SSH 账号上传到 `/srv/hyperliquid/releases/<提交号>-<运行号>-<重试号>/`。账号没有 sudo 或 Docker 管理权限。

上传完成前，线上 `current` 软链接保持不变。发布脚本保留旧页面需要的 `_next/static` 哈希资源，再原子切换 `current`，查询本机 `version.txt`。本机检查失败会恢复旧链接；成功后保存 `previous`，最后核对公网 HTTPS 版本。首次发布没有上一版本，因此不能先执行回滚。公网检查失败只标记任务失败，不会因外部网络故障自动撤销本机已验证的发布。

## 本地验证静态产物

在项目根目录执行：

```bash
npm ci
npm run lint
npm test
python3 -m unittest discover -s deploy -p 'test_*.py'
npm run build:static
npm run typecheck
STATIC_EXPORT=1 npm run test:e2e -- --workers=2
```

静态浏览器验收使用独立的 `33211` 端口。日常 `npm run dev`、`npm run build` 和 `npm start` 继续使用原来的 Next.js 模式与 `3210` 端口。

## 服务器首次接入

在 `fameex-testnet.xyz` 的 DNS 中添加 `app` A 记录，指向 `47.80.28.238`。管理员先核对服务器、8089 空闲端口和现有 Caddy，再上传 `deploy/` 及专用 SSH 公钥，在服务器运行：

```bash
bash /tmp/hyperliquid-setup/bootstrap.sh /tmp/hyperliquid-setup/deploy.pub
```

初始化先备份原代理配置，创建普通发布账号和独立 Nginx 容器。公钥限制端口转发、代理转发和终端分配。配置校验成功后热加载 Caddy；加载失败则恢复原配置。脚本遇到已有项目或账号会停止，避免覆盖。中途失败时保留已创建的文件供管理员检查，不自动删除现存目录。

GitHub 的 `aliyun-production` 环境配置：

```text
Variables:
  ALIYUN_HOST=47.80.28.238
  ALIYUN_USER=hyperliquid-deploy
  ALIYUN_PORT=22
Secrets:
  ALIYUN_SSH_PRIVATE_KEY
  ALIYUN_SSH_KNOWN_HOSTS
```

私钥只放本地 SSH 目录和 GitHub 环境 Secret；服务器只接收公钥。SSH 使用已核对的主机指纹，不能关闭主机校验。环境只允许 `main` 分支部署。

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

## 检查和回滚

```bash
curl --fail https://app.fameex-testnet.xyz/version.txt
curl --head 'https://hyperliquid.sunshinedairy.net/version.txt?check=1'
gh run list --repo woyaofei303/hyperliquid-testnet-terminal --workflow deploy-aliyun.yml --limit 5
```

在 Actions 选择 `rollback` 可恢复上一成功版本。这不会回退 Git 提交，也不会清空浏览器中的账户设置。发布目录和旧哈希资源暂不自动清理；维护时保留当前、上一版本和仍可能被旧页面使用的资源。

第二条命令应返回 `301`，且 `Location` 为 `https://app.fameex-testnet.xyz/version.txt?check=1`。必须保留 `hyperliquid.sunshinedairy.net` 的 DNS 记录、代理配置和有效证书，浏览器才能收到 HTTPS 跳转。

旧域名仅保留 `hyperliquid` 的跳转所需记录。后续发布与回滚均使用新域名做健康检查；服务器地址、SSH 凭证和发布目录不变。

新域名与旧域名、`localhost` 的浏览器存储隔离。首次访问新地址需要重新连接钱包、建立本站交易连接；不要手工复制旧站点中的交易密钥。部署验收仅查询行情和测试模拟交互，不代表真实订单或资金操作已经实测。
