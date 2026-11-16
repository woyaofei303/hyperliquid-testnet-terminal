# 从 Web 授权手机交易

独立连接页为 `https://app.fameex-testnet.xyz/connect`，Web 顶部和钱包面板都有入口。电脑上的主钱包只授权手机生成的公钥；手机私钥始终留在 RN App 的系统安全存储中。授权限定 Hyperliquid 测试网，期限最多 7 天。手机可以下单、撤单，资金仍在原账户；提款、存款、划转和账户类型修改继续使用主钱包。

在电脑打开 `/connect`，连接测试钱包后点击「生成手机授权二维码」。此页连接钱包只读取公开地址，不预先申请网页交易权限。App 的入口是「资产 → 连接钱包 → 扫码连接」，打开相机前会显示电脑访问链接和完整步骤。已有有效授权时，App 可直接连接已保存的钱包，不必重新扫码。

生产配对地址为本站 `https://app.fameex-testnet.xyz`。Web 先读取 `/runtime-config.json`，只接受 `schemaVersion: 1` 和布尔 `phonePairingEnabled: true`，请求使用当前站点同源 `/pairings`。预发布默认为 false，Nginx 直接拒绝配对；构建失败或配置损坏不会回退生产地址。详细配置与完整代码见[交付手册](ci-cd-handbook.md)。

本地 `public/runtime-config.json` 默认关闭。CI 使用显式模拟配置与同源网络拦截，不依赖外部配对服务，不再使用 `NEXT_PUBLIC_PHONE_PAIRING_URL`。本地单独运行模拟验收：

```bash
npm run build:static
STATIC_EXPORT=1 npm run test:e2e -- --workers=2 --grep '手机'
```

真机联调使用 `https://staging-app.fameex-testnet.xyz`，Web 和隔离 relay 在同一域名下分别提供页面与 `/pairings`。RN 配置也必须指向该域名；RN 协议 version 保持 1。隔离服务默认不开放公网配对。下面给出安装和临时开放步骤；本次真实扫码、本人授权、后台恢复和撤销结果见[实测记录](delivery-record-2026-11-16.md)。环回 HTTP 只用于容器内探针，手机不能连接服务器的 localhost。

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

自动化使用模拟主钱包、模拟交易所和本地 HTTP 服务，没有代签钱包授权或执行交易。2026-11-16 用户在 iPhone 16 Pro 上完成真实扫码、本人钱包授权、后台恢复和指定授权撤销；App 确认旧授权失效。后续修改仍需按下面的测试网流程重新验收，不能借用本次结果。

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

RN 仓库有用户尚未提交的业务改动，必须保留。现有 Metro 占用 8081 时也不停止它；准备独立的 8082 端口。用户后来单独授权修正 `src/modules/wallet/components/phone-agent-panel.tsx` 的显示和复制链接，让它使用已有的 `EXPO_PUBLIC_PHONE_PAIRING_URL`，没有提交 RN 改动或修改协议。以下命令只在用户确认手机与 Mac 同网后执行：

```bash
cd /Users/julian/Documents/Codex/2026-11-05/to/outputs/hyperliquid-native
git status --short
git rev-parse HEAD
EXPO_PUBLIC_PHONE_PAIRING_URL=https://staging-app.fameex-testnet.xyz \
  npx expo start --dev-client --lan --port 8082 --no-dev --clear
```

RN 显示与复制共用以下常量，原来的生产网址常量已移除；包含链接的 JSX 条件同时要求 `configured` 为 true。扫码 hook 原本已经读取同一个变量，本次不修改它的校验逻辑。

```ts
const pairingRelay = process.env.EXPO_PUBLIC_PHONE_PAIRING_URL
const CONNECT_URL = pairingRelay
  ? `${pairingRelay.replace(/\/$/, '')}/connect`
  : ''
```

`--no-dev` 让这次验收代码在打包时内联公开环境配置，原生容器仍是开发版 App。当前安装的 Expo 58 开发模式会通过 `expo/virtual/env` 合并 `.env.local`，其中的生产地址会覆盖启动命令中的预发布值；本次真机已复现这个问题。因此不能只搜索 bundle 是否“包含 staging”，必须核对显示链接和扫码 hook 的有效地址均为 staging。无需改动原 `.env.local`，也不要把这种局部运行方式写成所有 Expo 版本的规则。相关实现位于安装依赖的 `@expo/metro-config/build/transform-worker/transform-worker.js`；公开变量说明见[Expo 官方文档](https://docs.expo.dev/guides/environment-variables/)。

手机打开开发版 App，选择这次 8082 的服务并完整重新加载。`http://Mac的局域网IP:8082` 是向原生 App 提供代码的地址，不能在 Safari 打开它后把 Web 预览当成真机扫码。电脑浏览器仍打开 `https://staging-app.fameex-testnet.xyz/connect`。只配置公开服务地址，不能放入私钥；RN 继续拒绝 relay 与受信任地址不一致的二维码。

如果手机尚未安装开发版，先用 Xcode 的既有签名团队构建，再通过 Apple 的 `devicectl` 安装。下面在本机 RN 仓库执行，会更新手机中的同一 App；不先卸载 App，不删除钱包或安全存储。先运行 Xcode 设备列表，在 `simulator: false` 的本人设备中读取 `identifier`（硬件 UDID），填入 `PHONE_DEVICE`。不要使用 `devicectl list devices` 显示的 CoreDevice UUID 代替 Xcode 的硬件 UDID，也不要把完整设备标识提交到公开文档。

```bash
xcrun xcdevice list
PHONE_DEVICE='替换为已配对iPhone的硬件UDID'
mkdir -p output-tdd/ai-pairing-ios
xcodebuild -workspace ios/fameextestnet.xcworkspace \
  -scheme fameextestnet -configuration Debug \
  -destination "id=$PHONE_DEVICE" \
  -derivedDataPath output-tdd/ai-pairing-ios/DerivedData \
  -allowProvisioningUpdates build \
  > output-tdd/ai-pairing-ios/build.log 2>&1
```

只有构建退出码为 0 且日志中出现 `BUILD SUCCEEDED` 才继续。失败时手机原有 App 保持原样，检查 Xcode 签名账号、设备信任、Developer Mode 和描述文件有效期；不要用重新创建钱包处理签名故障。日志可能包含构建环境，不能整份公开上传。

```bash
PHONE_APP='output-tdd/ai-pairing-ios/DerivedData/Build/Products/Debug-iphoneos/fameextestnet.app'
codesign --verify --deep --strict "$PHONE_APP"
xcrun devicectl device install app --device "$PHONE_DEVICE" "$PHONE_APP" \
  --timeout 60 --json-output output-tdd/ai-pairing-ios/install.json
```

签名验证失败就停止，不继续安装。安装结果应为 success，bundle identifier 应为 `net.sunshinedairy.hyperliquidnative`，相机权限说明应存在。随后使用当前 Expo SDK 的原生启动链接打开 8082 服务。下面的 IP 是本次实测值，换网络后先用 `ipconfig getifaddr en0` 核对并替换。

```bash
xcrun devicectl device process launch --device "$PHONE_DEVICE" \
  --terminate-existing \
  --payload-url 'hyperliquid-native://?__expo_url=http%3A%2F%2F192.168.1.251%3A8082' \
  net.sunshinedairy.hyperliquidnative --timeout 30 \
  --json-output output-tdd/ai-pairing-ios/launch.json
```

重新启动会中断当前界面流程，因此仅在未发起签名、订单或资金操作时执行。成功启动不代表环境正确：在手机进入“资产 → 连接钱包”，实际显示和复制的链接都必须为 `https://staging-app.fameex-testnet.xyz/connect`，再扫描该网页新生成的二维码。出现“二维码版本、账户或配对服务不匹配”时停止，先核对运行环境，不放宽协议校验，不把二维码内容写入日志。两端账户、六位码一致仍只是扫码验收，钱包授权另行确认。

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
