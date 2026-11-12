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
