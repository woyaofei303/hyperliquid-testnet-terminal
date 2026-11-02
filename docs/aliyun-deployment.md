# 发布到阿里云

网站使用 `https://hyperliquid.sunshinedairy.net`。沿用原 `dy` 站点的方式：GitHub Actions 构建静态文件，阿里云 Nginx 提供文件，现有 Caddy 负责 HTTPS。行情和钱包请求由浏览器直接发往测试网，不经过应用服务器。生产机器不需要 Node，也不保存钱包密钥。

本站使用独立的 `/srv/hyperliquid` 目录、`hyperliquid-deploy` 普通账号、`hyperliquid` Compose 项目及 `127.0.0.1:8089` 端口。原 `dy` 和 `live` 站点继续使用各自的服务。新增的代理片段写入 `shared/extra-sites.caddy`，避免原 Streamlab 发布时丢失本站配置。

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

DNS 的 `hyperliquid` A 记录指向 `47.80.28.238`。管理员先核对服务器、8089 空闲端口和现有 Caddy，再上传 `deploy/` 及专用 SSH 公钥，在服务器运行：

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
curl --fail https://hyperliquid.sunshinedairy.net/version.txt
gh run list --repo woyaofei303/hyperliquid-testnet-terminal --workflow deploy-aliyun.yml --limit 5
```

在 Actions 选择 `rollback` 可恢复上一成功版本。这不会回退 Git 提交，也不会清空浏览器中的账户设置。发布目录和旧哈希资源暂不自动清理；维护时保留当前、上一版本和仍可能被旧页面使用的资源。

新域名与 `localhost` 的浏览器存储隔离。首次访问线上地址需要重新连接钱包、建立本站交易连接；不要手工复制旧站点中的交易密钥。部署验收仅查询行情和测试模拟交互，不代表真实订单或资金操作已经实测。
