# 从 Web 授权手机交易

Web 钱包面板新增「授权手机交易 / 管理设备」。电脑上的主钱包只授权手机生成的公钥；手机私钥始终留在 RN App 的系统安全存储中。授权限定 Hyperliquid 测试网，期限最多 7 天。手机可以下单、撤单，资金仍在原账户；提款、存款、划转和账户类型修改继续使用主钱包。

尚未连接时，「连接钱包」弹窗先显示手机扫码说明。连接后打开钱包账户，点击「授权手机交易 / 管理设备」，再点「生成手机授权二维码」。App 中的入口是「钱包账户 → 扫码连接」。已有有效授权时，App 可直接连接已保存的钱包，不必重新扫码。

线上两端都配置 `https://app.fameex-testnet.xyz`。Web 的 CI 在构建时写入该地址，Nginx 把 `/pairings` 请求转到独立配对容器；配置和首次安装步骤见 RN 工程的 `deploy/README.md`。下面的局域网地址只用于本机联调。

先启动 RN 工程提供的配对服务，再给两个客户端配置同一个服务地址。Web `.env.example` 中新增 `NEXT_PUBLIC_PHONE_PAIRING_URL`，RN 对应 `EXPO_PUBLIC_PHONE_PAIRING_URL`。这些地址是公开配置，不是私钥。不要覆盖原有 `.env.local`；可以像下面这样只给启动进程传参。

```sh
cd /Users/julian/Documents/Codex/2026-11-05/to/outputs/hyperliquid-native
PAIRING_HOST=0.0.0.0 PAIRING_PORT=3211 PAIRING_ORIGINS=http://localhost:3210,http://127.0.0.1:3210 npm run pairing:relay
```

另开终端，将示例 IP 替换为电脑实际局域网 IP，再启动 Web：

```sh
cd /Users/julian/Documents/Codex/2026-11-02/hyperliquid-testnet-terminal
NEXT_PUBLIC_PHONE_PAIRING_URL=http://192.168.1.20:3211 npm run dev
```

电脑打开 `http://127.0.0.1:3210`，连接钱包后生成二维码。手机扫码，两端显示相同的账户与六位核对码；勾选核对完成后，才能请求主钱包签名。二维码五分钟内有效，不要转发。正式构建要求配对服务使用 HTTPS；`build:static` 只导出网页，不包含独立配对服务。

如果签名后网络断开，只点击「查询授权结果（不重复签名）」。Web 查询 `extraAgents`，核对设备名、公钥和期限；回执重复发送时沿用相同密文，不会重新签名。即使配对过期或页面关闭，手机仍可从本机保存的钥匙查询并恢复已经存在的授权。

如果查询确认本次手机代理没有登记，页面恢复「在主钱包确认授权」和生成二维码入口，需要用户明确点击才重试。生成二维码前会检查命名代理名额：默认 3 个，每个子账户增加 2 个。例如，网页交易连接加上两台手机已占满 3 个名额；点击生成二维码后，页面先请求主钱包撤销最早到期的手机，查询确认名额已释放，再显示新二维码。名额够用时不撤销任何设备。接口没有创建时间，当前七天授权按到期时间判断先后；网页交易连接及其他用途的代理不会被自动删除。

App 通过 Face ID 后自动恢复有效的手机代理，期限内不需要重复扫码或手动核验。同一账户重新扫码会复用本机有效密钥；到期才生成新密钥，主动断开后则保持断开，等待手动连接。

「已授权设备」列表直接读取交易所仍有效的手机授权。点击某台设备的「撤销授权」，在主钱包确认后即可删除，不需要打开其他网站。请求使用同名、零地址的 `approveAgent`，与官方 API 页一致；页面查询 `extraAgents` 确认原授权已删除，再刷新列表。签名取消、查询失败或旧授权仍存在时，不继续生成二维码，也不会自动重复签名。

撤销后，该手机不能继续交易，但已有委托不会取消；手机本地删除钥匙或断开会话也不会撤销交易所授权。已撤销的手机若要重新连接，先在 App 删除旧密钥，再重新扫码生成新密钥；本次 Web 配对流程会拒绝刚进入撤销流程的旧地址。不要重新授权旧密钥，因为交易所可能已经清除它的防重放记录，详见[官方 API 钱包说明](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets)。

界面组件分别为 `phone-pairing.tsx` 和 `phone-devices.tsx`；`use-phone-pairing.ts` 管理轮询与提交状态；`phone-authorization.ts` 复用现有 `masterExchange` 请求用户确认。`phone-pairing.ts` 是两端同版本的协议文件，修改时必须同步 RN 副本及测试。

完整的原生构建、相机权限、配置、断网恢复和代码调用说明位于 RN 工程：

```text
/Users/julian/Documents/Codex/2026-11-05/to/outputs/hyperliquid-native/docs/PHONE-AGENT-PAIRING.md
```

自动化使用模拟主钱包、模拟交易所和本地 HTTP 服务，没有执行真实钱包授权或链上交易。iPhone 16 Pro 的首次 Face ID 引导及后台返回验证已由用户实测通过；真机相机扫码和实际主钱包授权仍需按测试网流程验收。
