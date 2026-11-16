# 从 Web 授权手机交易

独立连接页为 `https://app.fameex-testnet.xyz/connect`，Web 顶部和钱包面板都有入口。电脑上的主钱包只授权手机生成的公钥；手机私钥始终留在 RN App 的系统安全存储中。授权限定 Hyperliquid 测试网，期限最多 7 天。手机可以下单、撤单，资金仍在原账户；提款、存款、划转和账户类型修改继续使用主钱包。

在电脑打开 `/connect`，连接测试钱包后点击「生成手机授权二维码」。此页连接钱包只读取公开地址，不预先申请网页交易权限。App 的入口是「资产 → 连接钱包 → 扫码连接」，打开相机前会显示电脑访问链接和完整步骤。已有有效授权时，App 可直接连接已保存的钱包，不必重新扫码。

生产配对地址为本站 `https://app.fameex-testnet.xyz`。Web 先读取 `/runtime-config.json`，只接受 `schemaVersion: 1` 和布尔 `phonePairingEnabled: true`，请求使用当前站点同源 `/pairings`。预发布默认为 false，Nginx 直接拒绝配对；构建失败或配置损坏不会回退生产地址。详细配置与完整代码见[交付手册](ci-cd-handbook.md)。

本地 `public/runtime-config.json` 默认关闭。CI 使用显式模拟配置与同源网络拦截，不依赖外部配对服务，不再使用 `NEXT_PUBLIC_PHONE_PAIRING_URL`。本地单独运行模拟验收：

```bash
npm run build:static
STATIC_EXPORT=1 npm run test:e2e -- --workers=2 --grep '手机'
```

真机联调使用 `https://staging-app.fameex-testnet.xyz`，Web 和隔离 relay 在同一域名下分别提供页面与 `/pairings`。RN 配置也必须指向该域名；RN 协议 version 保持 1。隔离服务已经准备好，默认不开放公网配对。下面给出安装和临时开放步骤；真实扫码与主钱包授权尚未验收。环回 HTTP 只用于容器内探针，手机不能连接服务器的 localhost。

电脑打开 `/connect`，连接钱包后生成二维码。两端核对账户和六位码后，用户明确确认主钱包授权。二维码五分钟内有效，不要转发；`build:static` 只导出网页，不包含独立配对服务。

如果签名后网络断开，只点击「查询授权结果（不重复签名）」。Web 查询 `extraAgents`，核对设备名、公钥和期限；回执重复发送时沿用相同密文，不会重新签名。即使配对过期或页面关闭，手机仍可从本机保存的钥匙查询并恢复已经存在的授权。

如果查询确认本次手机代理没有登记，页面恢复「在主钱包确认授权」和生成二维码入口，需要用户明确点击才重试。生成二维码前会检查命名代理名额：默认 3 个，每个子账户增加 2 个。例如，网页交易连接加上两台手机已占满 3 个名额；点击生成二维码后，页面先请求主钱包撤销最早到期的手机，查询确认名额已释放，再显示新二维码。名额够用时不撤销任何设备。接口没有创建时间，当前七天授权按到期时间判断先后；网页交易连接及其他用途的代理不会被自动删除。

App 优先刷脸，失败后使用备用手势，通过后自动恢复有效的手机代理，期限内不需要重复扫码或手动核验。同一账户重新扫码会复用仍有有效授权的密钥；授权撤销或到期后自动清理，重新扫码生成新密钥。尚未授权时仅原二维码重试复用密钥，更换二维码会生成新密钥；主动断开后仍保持断开，等待手动连接。

「已授权设备」列表直接读取交易所仍有效的手机授权。点击某台设备的「撤销授权」，在主钱包确认后即可删除，不需要打开其他网站。请求使用同名、零地址的 `approveAgent`，与官方 API 页一致；页面查询 `extraAgents` 确认原授权已删除，再刷新列表。签名取消、查询失败或旧授权仍存在时，不继续生成二维码，也不会自动重复签名。

撤销后，该手机不能继续交易，但已有委托不会取消；手机本地删除钥匙或断开会话也不会撤销交易所授权。App 在恢复、重新扫码及已连接时的定时核验中确认授权失效后，会自动清理旧密钥，重新扫码时生成新密钥，无需手动删除。网络失败时保留密钥；本次 Web 配对流程会拒绝刚进入撤销流程的旧地址。不要重新授权旧密钥，因为交易所可能已经清除它的防重放记录，详见[官方 API 钱包说明](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets)。

连接页仅保留二维码、账户、六位码和当前步骤的主按钮；设备列表默认折叠，只有异常时出现重试入口。

界面组件分别为 `phone-pairing.tsx` 和 `phone-devices.tsx`；`use-phone-pairing.ts` 管理轮询与提交状态；`phone-authorization.ts` 复用现有 `masterExchange` 请求用户确认。`phone-pairing.ts` 是两端同版本的协议文件，修改时必须同步 RN 副本及测试。

完整的原生构建、相机权限、配置、断网恢复和代码调用说明位于 RN 工程：

```text
/Users/julian/Documents/Codex/2026-11-05/to/outputs/hyperliquid-native/docs/PHONE-AGENT-PAIRING.md
```

自动化使用模拟主钱包、模拟交易所和本地 HTTP 服务，没有执行真实钱包授权或链上交易。iPhone 16 Pro 的首次 Face ID 引导及后台返回验证已由用户实测通过；真机相机扫码和实际主钱包授权仍需按测试网流程验收。

## 隔离配对服务：准备、开放、关闭

这一步只验证“电脑把一把测试网交易钥匙授权给手机”的流程。账户资产仍在 Hyperliquid 测试网，relay 只暂存五分钟密文；复制程序文件不会复制任何生产会话。**预发布域名不是独立交易所**：如果使用同一个钱包地址，预发布仍能修改该测试网账户的代理授权。因此验收应使用专门的测试账户，名额足够时才生成二维码；出现撤销已有设备的提示应取消，不自动批准。

服务使用独立 Compose 项目 `hyperliquid-staging-pairing`、根目录 `/srv/hyperliquid-staging-pairing` 和预发布网络 `hyperliquid-staging_default`，不挂载生产目录、不开放主机端口。容器以 `1000:1000` 运行，根文件系统和程序挂载只读，限制 64 MiB、0.25 CPU、64 个进程。生产 relay、采集器和生产 Web 不重启。容器约束对应[Docker 官方配置](https://docs.docker.com/reference/compose-file/services/)。

### 1. 安装前核对来源（管理员终端，只读）

当前服务器上已经部署了本节资源。**不要重复运行一次性安装命令**；维护时先比较现有文件，再备份后替换具体文件。下面保留完整首次安装步骤，便于审查与重建。

来源版本与校验值：

```text
relay version.txt: 041f0ce079e02554d83d838dca7525eba9a999f7
server.mjs SHA-256: 1a667b635d388eef234c70a2b344c58458815a929ae55145953f475be24a597d
Node image: node@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8
```

在本机 Web 仓库将以下文件上传到已授权的预发布账号目录，然后在管理员终端核对 `sha256sum` 与本机 `shasum -a 256`。不要上传 SSH 私钥。

```bash
scp -o BatchMode=yes -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=/Users/julian/.ssh/douyin_known_hosts \
  -i /Users/julian/.ssh/hyperliquid-staging-deploy_ed25519 \
  deploy/staging/pairing.compose.yml deploy/staging/pairing-reset.service \
  deploy/staging/nginx.conf deploy/probe-staging-pairing.mjs \
  deploy/staging-pairing-window.sh \
  hyperliquid-staging-deploy@47.80.28.238:/home/hyperliquid-staging-deploy/ai-delivery-tools-20261116/
```

### 2. 一次性安装（服务器管理员，配置写入）

先执行 `sudo -i` 进入管理员终端。以下命令发现已有目录就停止，不能用来覆盖正在运行的环境。配对程序的 SHA 必须匹配上述已核查版本；来源变化时重新审查。

```bash
set -euo pipefail
source_dir=/home/hyperliquid-staging-deploy/ai-delivery-tools-20261116
relay_dir=/etc/hyperliquid-staging-pairing
test ! -e /srv/hyperliquid-staging-pairing
test ! -e "$relay_dir"
test ! -e /etc/systemd/system/hyperliquid-staging-pairing-reset.service
printf '%s  %s\n' 1a667b635d388eef234c70a2b344c58458815a929ae55145953f475be24a597d \
  /srv/hyperliquid-pairing/current/server.mjs | sha256sum --check
cmp "$source_dir/nginx.conf" /etc/hyperliquid-staging/nginx.conf
docker network inspect hyperliquid-staging_default --format '{{range .Containers}}{{println .Name}}{{end}}'
install -d -m 755 /srv/hyperliquid-staging-pairing "$relay_dir"
install -m 644 /srv/hyperliquid-pairing/current/server.mjs \
  /srv/hyperliquid-pairing/current/version.txt /srv/hyperliquid-staging-pairing/
install -m 644 "$source_dir/pairing.compose.yml" "$source_dir/probe-staging-pairing.mjs" "$relay_dir/"
install -m 755 "$source_dir/staging-pairing-window.sh" "$relay_dir/"
install -m 644 "$source_dir/nginx.conf" "$relay_dir/nginx.disabled.conf"
install -m 644 "$source_dir/pairing-reset.service" /etc/systemd/system/hyperliquid-staging-pairing-reset.service
python3 - <<'PY'
from pathlib import Path
p = Path('/etc/hyperliquid-staging-pairing')
s = (p / 'nginx.disabled.conf').read_text()
old = '        return 503;'
if s.count(old) != 1:
    raise SystemExit('默认 Nginx 配置已变化，停止生成')
new = '''        access_log off;
        error_log /dev/null crit;
        client_max_body_size 6k;
        proxy_connect_timeout 5s;
        proxy_read_timeout 20s;
        proxy_pass http://staging-phone-pairing:3211;'''
(p / 'nginx.enabled.conf').write_text(s.replace(old, new).replace(
    '预发布不连接生产配对服务，也不创建任何配对会话。',
    '仅真机验收窗口代理到隔离服务；不连接生产配对服务。'))
PY
docker compose -f "$relay_dir/pairing.compose.yml" config --quiet
docker compose -f "$relay_dir/pairing.compose.yml" up -d --pull never --wait --wait-timeout 30
docker compose -f "$relay_dir/pairing.compose.yml" exec -T staging-phone-pairing \
  node --input-type=module - http://127.0.0.1:3211 < "$relay_dir/probe-staging-pairing.mjs"
systemd-analyze verify /etc/systemd/system/hyperliquid-staging-pairing-reset.service
systemctl daemon-reload
systemctl enable hyperliquid-staging-pairing-reset.service
systemctl start hyperliquid-staging-pairing-reset.service
systemctl show hyperliquid-staging-pairing-reset.service -p Result -p ExecMainStatus
```

成功时探针报告 `checks=15`、`walletActions=0`、`sessionRemoved=true`；关闭单元退出码为 0，容器停止，公网配置仍 false、`/pairings` 返回 503。探针的密文是合成常量，没有账户、私钥或真实签名。它验证来源限制、两端令牌权限、乱序、非法输入、相同请求幂等、冲突拒绝、读取和删除；它不验证相机、加密实现或交易所签名。失败只输出已完成检查数量；临时会话最多保留五分钟。

安装失败时 Web 配置仍保持原样，已创建的隔离目录供排查，不重跑初始化覆盖。只修复报错的步骤；不用 `docker compose down` 操作任何生产项目。更新本节文件前，备份 `/etc/hyperliquid-staging-pairing` 中实际要改的文件。

### 3. 准备手机（本机 RN 仓库，启动开发服务）

RN 仓库有用户尚未提交的业务改动，本次不修改、不提交这些文件。现有 Metro 占用 8081 时也不停止它；准备独立的 8082 端口。以下命令只在用户确认手机与 Mac 同网、已经安装开发版 App 后执行：

```bash
cd /Users/julian/Documents/Codex/2026-11-05/to/outputs/hyperliquid-native
git status --short
git rev-parse HEAD
EXPO_PUBLIC_PHONE_PAIRING_URL=https://staging-app.fameex-testnet.xyz \
  npx expo start --dev-client --lan --port 8082
```

手机打开开发版 App，选择这次 8082 的开发服务并完整 Reload；不要继续使用 8081 的旧 bundle。Expo 在打包时替换 `EXPO_PUBLIC_` 变量，切换地址后需要完整 Reload，不能只改电脑变量就认为手机已生效，见[Expo 官方说明](https://docs.expo.dev/guides/environment-variables/)。这里只配置公开服务地址，不能放入私钥。RN 会拒绝 relay 与受信任地址不一致的二维码。

### 4. 开放最多 30 分钟（服务器管理员，公网配置写入）

先确认本次验收时间和测试账户；这是开放配对入口的操作，与钱包签名是两个独立授权。配置成功后，所有能访问预发布域名的人都能申请短时配对会话，但不能替你签名；relay 自带容量和请求限制。正式手机授权仍必须由你在主钱包逐项确认。

```bash
sudo bash /etc/hyperliquid-staging-pairing/staging-pairing-window.sh on
sudo systemctl list-timers hyperliquid-staging-pairing-close.timer
```

脚本只允许已知的默认 Nginx 配置，备份后启动隔离 relay，等待健康检查、跑探针、注册关闭定时器，最后热加载路由并设置 runtime=true。任一后续步骤失败就执行关闭；关闭失败明确报错。Nginx 与运行配置不是一项原子事务，顺序保证启用开关最后打开，关闭开关最先关闭。

30 分钟到期调用同一关闭脚本；开机关闭单元处理重启后恢复默认状态，不为验收重启整台服务器。若 Nginx 被别人修改，关闭脚本不覆盖未知配置，但仍尝试关闭 runtime 并停止 relay，同时报告需人工恢复。停服务不撤销交易所已经登记的代理授权，也不是所有旧浏览器的交易停止开关。

本机 Web 仓库执行公网合成检查：

```bash
node deploy/probe-staging-pairing.mjs https://staging-app.fameex-testnet.xyz
```

### 5. 用户执行真机验收（真实钱包授权，不能由自动化代签）

1. 在电脑打开 `https://staging-app.fameex-testnet.xyz/connect`，核对 HTTPS 和域名。连接专门的测试账户；连接仅用于读取公开地址。确认已有代理名额充足。
2. 点击生成二维码。此时若主钱包请求撤销已有设备，取消并停止验收；先核对账户和设备列表。二维码有五分钟有效期，不发到聊天、不截图保存。
3. 手机选择“资产 → 连接钱包 → 扫码连接”，允许相机后扫描。核对电脑与手机的公开账户、设备名及六位码一致。先完成扫码但暂不批准授权，并记录成功或具体错误文字。
4. 需要实际授权时，另行确认**该账户、该手机新生成的公钥、设备名、测试网、最长七天、只允许订单与撤单、不进行交易或资金操作**。由你在主钱包确认 `approveAgent`；如果钱包显示别的操作或网络则取消。
5. 查询 `extraAgents` 并核对公钥与期限，手机显示已连接。模拟断网或刷新只允许“查询授权结果”，不重复签名；验收结果不明时停止，不点击重试交易。
6. 清理需要另行确认撤销**刚才新授权的同一设备**，由你签名。查询确认授权消失，手机失效。撤销不会撤掉已存在委托，本次不得下单来证明配对成功。

验收记录不保存二维码、密文载荷或钱包完整签名：

```text
时间、操作者、手机型号 / App 版本：
Web release ID / runtime-config 摘要 / relay version / RN SHA 和脏文件说明：
测试账户公开地址或内部别名：
代理公钥 / 设备名 / 授权到期时间（签名前确认）：
允许操作：扫描；逐次批准指定 approveAgent / 撤销；无订单及资金操作
扫码、核对码、取消、批准、只读恢复、撤销的实际结果：
未执行项目与原因：
关闭窗口后的 runtime=false / HTTP 503 / relay 已停止：
```

### 6. 提前关闭与排障（服务器管理员，恢复默认）

```bash
sudo bash /etc/hyperliquid-staging-pairing/staging-pairing-window.sh off && \
  sudo systemctl stop hyperliquid-staging-pairing-close.timer
curl --fail --silent --show-error https://staging-app.fameex-testnet.xyz/runtime-config.json
curl --silent --show-error -o /dev/null -w '%{http_code}\n' https://staging-app.fameex-testnet.xyz/pairings
```

先关闭再停止定时器，不能反过来取消唯一兜底。成功为 false 和 503。关闭失败时先只读查看 `docker compose ... ps -a`、`nginx -t` 和脚本报错，按备份恢复已知 Nginx，再重跑 off；不要用“已经关了开关”代替核验服务确实停下。不要收集正在配对的请求日志或完整 URL。再次开启前，确认旧 timer 已停止且没有 `hyperliquid-staging-pairing-close.service` 正在运行；若 transient unit 尚未回收，等待回收再开启，不并行开多个窗口。
