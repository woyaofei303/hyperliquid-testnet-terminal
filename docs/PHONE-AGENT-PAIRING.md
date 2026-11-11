# 从 Web 授权手机交易

Web 钱包面板新增「授权手机交易 / 管理设备」。电脑上的主钱包只授权手机生成的公钥；手机私钥始终留在 RN App 的系统安全存储中。授权限定 Hyperliquid 测试网，期限最多 7 天。手机可以下单、撤单，资金仍在原账户；提款、存款、划转和账户类型修改继续使用主钱包。

尚未连接时，「连接钱包」弹窗先显示手机扫码说明。连接后打开钱包账户，点击「授权手机交易 / 管理设备」，再点「生成手机授权二维码」。App 中的入口是「钱包账户 → 扫描电脑授权二维码」。

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

「手机设备」列表直接读取交易所授权。撤销入口指向官方测试网 API 页面，找到同名、同地址的代理撤销，再回来刷新列表。手机删除钥匙或断开会话不会撤销交易所授权，也不会取消已有委托。

界面组件分别为 `phone-pairing.tsx` 和 `phone-devices.tsx`；`use-phone-pairing.ts` 管理轮询与提交状态；`phone-authorization.ts` 复用现有 `masterExchange` 请求用户确认。`phone-pairing.ts` 是两端同版本的协议文件，修改时必须同步 RN 副本及测试。

完整的原生构建、相机权限、配置、断网恢复和代码调用说明位于 RN 工程：

```text
/Users/julian/Documents/Codex/2026-11-05/to/outputs/hyperliquid-native/docs/PHONE-AGENT-PAIRING.md
```

自动化使用模拟主钱包、模拟交易所和本地 HTTP 服务，没有执行真实钱包授权或链上交易。iPhone 16 Pro 的首次 Face ID 引导及后台返回验证已由用户实测通过；真机相机扫码和实际主钱包授权仍需按测试网流程验收。
