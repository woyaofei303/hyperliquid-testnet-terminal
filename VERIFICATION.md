# 验证记录

记录始于 2026-11-02。以下按阶段保留当时的环境、结果与限制；最新一节优先，旧记录中的“未提交”“尚未入金”等描述只代表当时状态。

## 全屏回归与自动化时序修复（2026-11-10，最新）

环境为 Node.js 24.14.0、本机 Chrome 157.0.8103.39。旧版 Playwright 1.58.2 在不加载项目代码的原生按钮页面上也会拒绝 `requestFullscreen()`，返回 `not granted`；请求时用户激活、页面焦点和全屏能力标记均正常。同一个 Chrome 使用新版运行库后成功，因此将现有 `@playwright/test` 升至并锁定为 1.65.0，同步更新其两个运行库及 npm 锁文件。[官方 1.65.0 发布说明](https://github.com/microsoft/playwright/releases/tag/v1.65.0)也列明对 Chrome 157 的测试覆盖。

三个原有全屏用例在升级前全部失败，升级后全部通过，继续检查浏览器原生全屏状态、深度图宽度、全屏中的菜单与指标弹窗、退出后的草稿和焦点，以及路由切换时退出全屏。

完整回归还发现两处测试时序问题。金额清空用例现在先确认文本已全部选中，再发送退格，继续检查改价和点击盘口不会重新填入数量。仓位复查用例先等上一笔操作的弹窗关闭，再打开市价平仓弹窗并模拟远端仓位消失，避免前一单的账户刷新提前移除仓位行；提交时仍须提示仓位已关闭，且不能多发订单。相关 7 个用例连续执行 3 轮，共 21 次通过。

最终验证：130 项单元测试、Biome、TypeScript 和静态构建通过；双 worker 完整浏览器回归 151 项通过、零失败；默认跳过的两项性能测试随后以单 worker 单独运行，2 项全部通过。性能测试覆盖持续行情负载、资源回收、连接复用，以及长任务触发降频后恢复。本轮执行的是模拟钱包和交易所的自动化测试，未执行真实账户签名或资金操作。

在项目根目录可用以下命令复核；两个浏览器命令分别预期 151 项和 2 项通过：

```sh
cd /Users/julian/Documents/Codex/2026-11-02/hyperliquid-testnet-terminal
npm run lint
npm run typecheck
npm test
npm run build:static
STATIC_EXPORT=1 npm run test:e2e -- --workers=2
PERF_CHECK=1 STATIC_EXPORT=1 npm run test:e2e -- --workers=1 --grep @benchmark
```

证据位于 `output-tdd/playwright/fullscreen-fix/`：`before-results.json` 和 `after-results.json` 记录三个全屏用例的修复前后结果；`stability-final-results.json` 记录重复验证；`regression-final-results.json`、`benchmark-results.json` 分别记录完整回归和性能测试。首次回归中的失败记录也保留在该目录，最终结果以上述 `final` 记录为准。

## 真实测试网资金验收与到账追踪修复（2026-11-06）

使用账户 `0x000071424bb08b910f0786e04D964A63D64bF1Ba`，由用户在 MetaMask 逐笔确认。完成 10 USDC CCTP 存入（到账 9.8，费用 0.2，授权与存款 Gas 合计 0.000003358399246 测试 ETH）、1 USDC 合约与现货往返划转、5 USDC 提款（到账 4.8，费用 0.2，额外 Gas 0.00002 HYPE）。全部金额和费用在用户授权范围内。没有改动已有 BTC 仓位、杠杆和两笔委托，没有重新授权代理。

存款源交易 `0x0db0b5d104739dc819dbfa4e30c8991ad85899dd3eb09d0f4e615fdb1e7725b8`；提款原 nonce `1793949007616`，Arbitrum Sepolia 目标交易 `0x575c4c42ca59a8e5409d334924dc53c4e4a087568a1912646c58369ea48a8379`。资金流的实际回执、流水和断言结果保存在 `output-tdd/playwright/resume-evidence-20261106/` 的 `deposit-proof-verified.json`、`transfer-roundtrip.json`、`withdrawal-proof-verified.json`。最终本地生产页刷新后正确显示两侧“到账已核验”。

修复存款旧桥索引及 nonce 混用：改用 Circle 源交易消息、目标 MessageReceived / MintAndForward / SendAsset 和同秒唯一匹配的 HyperCore 流水。提款保留可用的 Across 测试网索引，增加目标消息内原请求 nonce、收款人、金额、费用及精确净额 USDC 铸造校验。资金提交期间跳过后台核对，避免旧状态覆盖提交结果。未知回报不自动重发，主动新操作仍需重新校验和钱包确认。

排查用的 HyperEVM 普通日志扫描没有进入最终实现，系统交易不在这些普通 RPC 结果中。空 `data=0x` 本就默认转发，最终保持该默认值；本次真实提款的显式转发标记也有效，没有重复提款。不能把已放弃的日志扫描或错误的“空数据关闭转发”判断写成修复结果。

最终检查：108 项单元测试、249 个文件的 Biome 检查、独立 TypeScript 检查、生产构建及 139 项完整浏览器模拟回归通过；真实回执也通过新校验逻辑。对应日志为 `unit-cctp.log`、`lint-cctp.log`、`typecheck-cctp-final.log`、`build-cctp-final.log`、`regression-cctp-final.log/json`。当前没有新增依赖，未重跑钩子或依赖审计，未提交、推送、部署。交易签名、开平仓、主网、多小时压力和其他账户模式未在这轮验收。以下旧记录中的“未签名”“未入金”仅代表当时状态。

## 简历证据补充与测试网验收（2026-11-06）

本轮重新生产构建，并完成 106 项单元测试、246 个文件的 Biome 检查、独立类型检查及 139 项浏览器模拟回归。首次完整回归为 128 通过、11 失败：10 项为旧主题颜色 / 画布像素预期，已同步 FameEX 配色；1 项为快速盘口与账户用例点击超时，未作产品代码修改。12 项针对性复测及最终完整 139 项均通过，首次失败记录保留。

真实测试网只读检查通过：市场元数据、HTTP / WebSocket 盘口买卖各 20 档、289 根近期 5 分钟 K 线，以及额外 5,001 根 BTC 1 分钟历史 K 线的排序与唯一性；后者不代表同时渲染能力。真实行情浏览器专项 1 项通过，检查双图表、市场 / 周期切换和响应布局，无页面错误或交易所写入。CCTP 前置只读检查确认源链 ID、USDC 6 位精度、相关合约存在字节码、当前存提路由为 CCTP，未执行签名或资金写入。

新增持续行情性能专项通过：Apple M1 Pro / 32 GB、本地生产构建，70.399 秒模拟推送 34,200 条消息，实际约 486 条 / 秒；8,550 次盘口输入合并为 529 次状态提交，16 个采样点的待处理队列最大 1、盘口最多 40 档，采样 FPS 中位数 55。10 轮双图表和周期切换后 WebSocket 连接仍为 2。强制 GC 后堆为 31.70 → 35.13 → 36.65 MiB，不据此宣称零泄漏。发送器目标 1,000 条 / 秒未达到，不用目标值替代实测值。

另一项受控长任务专项通过：每 200 ms 注入约 80 ms 长任务，配合快速盘口，约 3.72 秒发送 3,600 条消息并触发等级 1 保护；停止注入后约 10.614 秒恢复等级 0，FPS 约 59.8，队列归零。两项性能测试仅在 `PERF_CHECK=1` 时运行，使用 `@benchmark` 标记，不把这些模拟行为写成真实订单或资金验收。

全部证据位于 `output-tdd/playwright/resume-evidence-20261106/`，包括首次与最终回归、`benchmark-data.json`、`pressure-data.json`、只读回执、截图及环境指纹。最终测试文件变更后再次执行 lint、typecheck 通过。未新增依赖、未重新运行钩子或依赖审计，未部署、提交或推送；原有产品源码改动保留。

项目归属按用户确认是 FameEX Web3，简历保留“测试网开发与联调”阶段并更新实测性能与测试覆盖；这取代旧记录中“仅个人项目”的定性。用户本轮测试钱包地址待提供，真实授权、挂撤单、成交、费用 / 仓位核对及 CCTP 往返仍未执行。没有凭模拟测试补写主网上线或资金闭环完成。



## FameEX 主题、控件图标与盘口价格精度（2026-11-06）

终端颜色别名改为 FameEX 暗色令牌，补充语言、设置、选中和外链图标；新增 4 个 SVG body 与 FameEX 原 Iconify 数据逐字一致，图标集合共 11 个。订单簿沿用 FameEX Select，按买盘向下、卖盘向上合并价格档位，并保留原始累计金额、加权均价与真实价差；切换市场恢复默认精度。

验证通过：Biome 检查 246 个文件；独立 TypeScript 检查；106 项单元测试；7 项既有浏览器专项（手机盘口、满深度与稀疏深度布局、盘口浮层、基础图表工具栏、帧合并和语言切换）；生产构建 `npm run build` 正常退出。新增聚合测试先出现 2 项失败，实现后通过，覆盖方向取整、小数精度、原始成交金额和非法步长。最后仅增加说明性注释与文档，重新执行 lint 和 `git diff --check` 通过。

Playwright CLI 在本地页面读取测试网行情，验证 BTC 选择 100 后展示价均为 100 的倍数，点击 75900 档位正确填入价格草稿；桌面 1440×1000、手机 390×844 均检查，手机文档宽度仍为 390px。键盘聚焦后 Enter 打开、Esc 关闭并返回触发器焦点；English 显示 Price increment，切到 ETH 恢复 0.01。页面背景实测 rgb(11,12,14)、面板 rgb(23,24,29)、品牌令牌 113 50 244、涨跌色分别 rgb(20,184,129) / rgb(235,71,71)。截图已查看，工件在 `output-tdd/playwright/fameex-theme-depth/`。

探索检查中，鼠标打开后立即断言返回触发器焦点失败；随后使用键盘打开路径验证 Esc 与焦点恢复通过，未修改组件原有鼠标焦点策略。一次语言菜单定位因菜单已关闭而超时，重新打开并完成选择后，英文及切币验证通过。没有把中断检查计为成功。

仅聚合已收到的深度，没有扩大协议提供的档位范围。本轮未执行钱包签名、真实订单或资金转移，未部署、提交或推送；未跑完整浏览器套件及依赖审计。保留已有 `chart-trade-lines.tsx` 改动及 `src/i18n/en.ts` 中止盈、止损、收益率的 3 条翻译。静态生产构建通过，真实交互验证在开发服务器进行。

## 追加通知、站点图标与底部布局（2026-11-02）

旧版在刷新时把恢复连接和已确认的历史划转一起弹为成功通知。针对旧发布产物的回归先得到失败：预期 0 条通知，实际 2 条，见 `output-tdd/terminal-upgrade/notifications-red.log`。现在只读恢复连接不弹成功提示；资金记录与通知分别管理，读取历史记录不产生新通知，新提交或核对后状态改变才提示，主动划转只提示一次。主动连接成功提示保持约 4.5 秒自动关闭，模拟测试验证没有自动签名、启用交易或发单。

新增 `src/app/icon.svg`，采用页头同样的青绿色 H 标识。Next.js 自动生成图标标签和静态资源；浏览器测试验证标签类型与资源 HTTP 200。桌面底部仓位 / 账户区域改为约 30% 且最小 260px，两者顶部对齐，继续保持一屏布局，溢出在各面板内部滚动。账户底部地址输入和查看按钮，以及对应闲置状态已删除；未连接账户提示改为连接钱包查看数据。

最终 Biome 检查、75 项单元测试、静态构建和类型检查通过。完整本机回归 107 个用例逐项产生通过结果，但浏览器子进程回收阶段挂起，因此停止清理进程，不将这次运行记作正常退出。随后对最终英文空状态文案重新构建，6 项专项在同一次运行正常通过，包含四种桌面高度、删除地址入口、通知恢复与自动关闭、账户切换安全、语言和图标元数据。日志为 `followup-e2e.log`、`followup-focused.log`、`followup-final-build.log`、`followup-final-typecheck.log`、`followup-final-lint.log`，均在 `output-tdd/terminal-upgrade/` 下。云端完整 CI 成功后才允许发布，不绕过检查。

## 本轮多钱包、语言、实时盘口与仓位（2026-11-02）

钱包优先通过 EIP-6963 发现独立 provider，模拟全局 ethereum getter 抛错、多个扩展重复广播、延迟注入、连接拒绝和应用自身异常。真实 Chrome 检测到 Bitget、OKX、MetaMask、Bybit、Phantom；选择 MetaMask 后页面读到连接地址、余额与仓位。没有由本轮自动化执行真实钱包签名、下单或资金转移。

页头保留单页交易入口，右侧增加简体中文 / English。浏览器回归确认语言持久化，切换语言与币对不刷新页面、不丢失下单输入；title、description、Open Graph 和 Twitter 元数据随价格、币对与产品更新，且不存在重复标签。静态分享抓取器不执行 JavaScript 时仍只能看到默认 BTC 元数据。

盘口快速前五档与完整深度分别订阅。22 秒测试网只读采样分别收到 42 次、5 次更新，间隔中位数约 526ms、5263ms；真实页面性能面板显示盘口约 2 次/秒、账户推送约 1 次/秒，未触发降频。更深档位沿用低频完整快照，不能声称全部档位均为 0.5 秒实时深度。账户推送按用户、DEX 和时间过滤，再合并到最新状态。

仓位新增价值、标记价、盈亏率和资金费等列，统一数值对齐。平仓改为 FameEX 市价 / 限价弹窗，支持比例选量，预览前重新读取仓位；已平仓、方向改变或数量超限会阻止提交。模拟测试覆盖部分减仓、全部平仓、限价只减仓、仓位实时更新和已平仓保护。

最终发布候选只包含本轮暂存改动，在 `output-tdd/terminal-upgrade/candidate/` 独立安装和构建，避免混入同期通知修复。独立目录仅将测试端口改为 33212，并调整 Biome 对本地工件目录的排除路径，不改变产品源码。最终结果：Biome 检查 148 个文件通过；75 项单元测试通过；6 项部署 / 回滚测试通过；静态生产构建、TypeScript 检查通过；105 项浏览器回归在同一次运行全部通过（2.8 分钟）。之前发现的触发价空格、异步元数据重复和测试等待时序问题已修复；中途失败或停止的日志没有算作通过。

日志保存在 `output-tdd/terminal-upgrade/candidate-*.log`，真实页面截图保存在 `output-tdd/playwright/terminal-upgrade/`。本轮未新增依赖；npm ci 仍报告现有依赖的 53 项低严重度审计提示，本轮未修改依赖树。简历未更新，模拟交易结果不能写成真实成交验收。

## 本轮订单确认与钱包连接（2026-11-02）

订单确认保留用户选择的市价 / 限价意图，而不是从底层 IOC / GTC 反推类型。确认框展示方向、带币种的数量和市价或具体限价；只保留买入 / 做多、卖出 / 做空或对应的平仓按钮，取消使用右上角关闭和 Esc。现货、预测仍使用买入 / 卖出语义，仓位保护保留止盈 / 止损说明。没有可靠的成交后强平价估算时显示 N/A。

钱包连接继续通过 `eth_requestAccounts` 请求扩展权限，页面不仿造钱包的原生权限页。新增等待所选钱包、取消后重试和已有待处理请求的提示；连接期间禁止重复发起。连接本身不请求签名、切链或下单。自动恢复只读 `eth_accounts`，已有有效交易连接无需再次启用。

是否需要启用取决于当前浏览器是否保存交易密钥，以及对应 API 钱包是否仍登记且未过期；历史成交不参与这个判断。`userRole: missing` 才表示账户尚未激活，已激活账户余额为零也不应误判为新账户。2026-11-02 14:28:44（北京时间）对用户提供的地址只读查询，返回 `role: user`，且已有未过期的 `JulianTerminal` 登记。回执仅保留公开状态，不读取浏览器密钥，也不因此推断当前浏览器一定保存了对应密钥。 随后只读查看用户当前 Chrome 本地页面，界面已显示“交易已启用”和可用的“下单”按钮，未出现“启用交易”入口；没有点击下单或请求签名。

订单确认和连接等待各自先复现失败，再修改实现。新增单元用例检查限价 IOC 不被误标为市价、四种合约方向、现货 / 预测单位、高级单及连接调用边界；浏览器用例检查关闭不发单、连接拒绝后重试、已有登记但本地密钥丢失，以及钱包已有待处理权限请求。钱包、签名和交易所写入都使用模拟边界。

本轮日志与修改前备份位于 `output-tdd/order-confirmation/`，截图在 `output-tdd/playwright/order-confirmation/`。首次连接专项 10 项通过，1 项被工作区新增通知浮层遮挡账户入口，失败保留在 `connection-green.log`。随后完整集成运行发现旧测试将所有通知当成单个状态元素，出现严格定位冲突；追价用例失败后的浏览器回收挂起，因此停止该次运行，保留 `e2e-integrated.log`。测试改为按实际回报文案匹配，最终交易流程回归另记于 `e2e-final.log`。同期新增的通知、异常边界、错误页等 6 项用例属于其他工作，本轮最终回归排除它们，不将中断的 85 项运行记成通过。工作区同期有全局通知相关修改，本轮保留它们，不把这些修改算作订单确认的实现。

最终验证：Biome 全仓检查 134 个文件通过；类型检查通过；67 项单元测试通过；生产构建通过。交易范围 79 项浏览器回归首轮 75 项通过，4 项失败来自通知文案重复、通知已移出 main，以及把可滚动菜单的完整列表误当成可见弹层边界。修正定位范围与边界断言后，3 项在 `e2e-rerun.log` 通过，剩余窄屏菜单在 `e2e-menu-final.log` 通过。菜单仍验证全部订单类型、键盘选择、关闭和焦点返回，没有放宽到视窗外。合计 79 项均有通过结果，不是一次运行全部通过。

对应静态检查日志为 `lint-complete.log`、`typecheck-complete.log`、`unit-complete.log`，构建为 `build-integrated.log`。修改文件的绝对路径清单为 `changes.txt`；修改前文件在 `before/`。当前源码尚无初始提交且有同期工作，回退应逐项核对差异，不能整体覆盖共享 hook 或测试文件。

本轮未执行真实钱包签名、真实订单或资金转移，未修改简历；不能把模拟回归记成测试网真实成交验收。

## 本轮完整交易流程校对（2026-11-02）

只读核对了官方测试网交易页、公开页面脚本与官方入门文档。官方首次启用交易仍签署无 Gas 消息，后续订单由 API 钱包签名；“下单不需要授权”对应的是不需要逐笔主钱包签名或 ERC-20 授权，不能把签名校验直接删掉。公开实现默认使用 sessionStorage，选择保持连接才使用 localStorage。

本地原来每次刷新就丢失连接，并人为设置一小时过期；回归用例先复现了刷新后“下单”消失，再修复为读 eth_accounts 和 extraAgents 恢复。只有地址匹配、交易所仍登记且未过期的连接可用。核验网络失败保留凭据、禁止下单并提供只读重试；撤销或断开不会继续显示可交易。新连接使用新生成密钥，不复用旧已撤销密钥。

交易确认统一复用 FameEX Modal。首次按钮为“建立连接”，普通下单为“下单 / 确认提交”，可记住不再显示订单确认；平仓偏好独立保存。撤单、停止 TWAP 不再二次确认；杠杆和保证金模式只在编辑弹窗确认一次。未知订单继续阻止新下单，但允许撤销已经查到的订单。资金签名和未知资金请求保护保持独立。

验证结果：`npm test` 60 项通过，Biome lint/format、TypeScript 检查和生产构建通过。首轮完整浏览器回归 73 项中 70 项通过：1 项因按钮改名后定位器匹配到比例按钮，2 项暴露窄屏网格压缩导致记录区覆盖下单/资金入口。已精确匹配“下单”，窄屏改为按内容计算网格行高，桌面保持原布局。随后 10 项复测全部通过，包含三个失败用例、相关布局回归，以及新增的交易所撤销连接、独立平仓偏好用例。合计 75 个浏览器用例均已有成功结果，未把首轮失败记录改写为通过。

本轮回归日志在 `output-tdd/trading-flow-audit/`：`restore-red.log` 为修复前失败证据，`e2e-full.log` 为首轮完整回归，`flow-final.log` 为修复后的 10 项复测；构建结果为 `build-layout.log`。模拟界面截图在 `output-tdd/playwright/trading-flow-audit/`。交易密钥未写入截图、验证记录或导出数据。

本轮未执行真实钱包签名、下单、撤单或资金转移。官方可在首次入金前缓存交易连接签名再入金后登记；本地仍对 missing 账户先引导存款，到账后才建立交易连接。这一首用顺序差异仍存在，不宣称与官方所有入口完全一致。CCTP 以外的存提路线与其他未实现范围仍见下文。

## 本轮存款输入与授权重试

复现了用户截图中的 Gas 拒绝：授权请求被拒绝后，旧代码仍保留 `unknown` 并禁用金额输入。另在 390×620px 下复现资金记录占据高度后，存款按钮被 flex 压成零高度、无法点击。两个失败均留在 `output-tdd/deposit-input/red.log` 和 `e2e.log`。

现在只点击一次“存款”：重新读取源链余额与授权额度，额度不足时请求精确金额授权；授权回执成功后，再请求钱包确认存款。每一步都重新核对会话和测试链，取消或切换账户就停止。已有足够额度时直接请求存款。两笔链上请求各自重新估算 Gas，费用上限为两倍基础费加优先费；不会在拒绝后自动重发。

明确的费用过低、Gas 余额不足或用户取消不再被标为未知。旧版无哈希的授权记录允许用户重新确认，因为授权本身不转移 USDC；实际存款、划转或提款结果未知时，仍禁止重复提交。金额输入采用 FameEX bordered 样式，等待期间保持可读；弹窗内容可以滚动，但输入框和按钮不能被压缩。

## 本轮市场下拉列对齐

表头按钮原先居中，数据行却靠右；数据行还单独占用收藏星标宽度，表头没有相同占位。现在表头与行使用相同的四列比例，固定星标宽度、统一右对齐，并为两者预留相同滚动条空间，排序和滚动不再改变列边界。

1280px 与 390px 用例逐列比较表头和数值的右边界，允许误差不超过 1px；同时检查三种排序、滚动后对齐及选择市场后关闭菜单。真实测试网合约列表也已只读检查，截图位于 `output-tdd/playwright/market-alignment/live-desktop.png`。窄屏验证发现图表网格行被压缩，因此保留与现有图表内容一致的最小高度，桌面继续填满可用高度。另一个溢出来自下单区绝对定位的隐藏标题：主容器没有定位上下文，标题越过裁剪区域把整页撑高。给主容器增加 relative 后，排序聚焦不再滚动整页，弹层保持在视窗内。

## 上一轮独立资金弹窗与官方流程

只读对照了官方测试网交易页的启用交易、存款、划转、提款弹窗，以及当日页面公开的 CCTP 请求代码。四个入口改为独立弹窗；未连接时保留资金入口意图，选择钱包后继续原操作。未激活账户点击启用交易仍先进入存款，已激活账户进入独立的无 Gas 授权弹窗。

UI 适配 FameEX 的 `apps/web/src/components/Modal.tsx`，复用 HeroUI 原语、480px 宽度、16px 圆角和动画，Close、Transfer2 使用原 SVG 路径。Input、Select、Button 继续使用现有源码。资产与网络下拉挂载在弹窗根节点、滚动正文之外，避免被 Modal 的无障碍隔离隐藏；下拉不因容器滚动自动关闭，外部点击、选项选择和 Esc 仍会关闭菜单；键盘 Enter、Esc、焦点返回及 390px 窄屏纳入检查。生产回归发现 HeroUI 默认桌面上下外边距导致高弹窗外层滚动、下拉随之关闭；修复为固定 12px 外边距，并加入外层无滚动断言。原来的钱包功能 Tab 和全屏式步骤面板已移除。

存款目前采用上文的连续钱包确认流程，源链确认与 HyperCore 到账仍分别核对。划转使用合约/现货方向卡片，成功后关闭并刷新余额；统一账户不误用独立账户划转。提款打开即查询费用和最大可提金额，在同一页核对地址、金额和预计到账，点击主按钮才请求签名。普通账户使用合约可提余额，现货入口带方向跳转至划转；统一账户使用维护保证金后的共享余额。最大值只填金额，提交前重查余额和费用，费用上涨必须再次点击确认。

提款报价使用请求序号和钱包会话隔离；关闭或换账户后返回的旧报价不得覆盖当前账户。未知资金结果仍按账户持久化，刷新后继续查询，不自动重发。到账仍须匹配 nonce、目标链成功回执和正确 USDC 合约/收款人/足额 Transfer 日志。

新增 3 项浏览器用例，验证独立入口与下拉、提款单页及现货跳转、异步报价期间切换账户。原资金用例同步迁移到新入口，继续检查拒签、费用上涨、统一账户、回报丢失、精确授权和实际到账条件。测试钱包、签名、RPC 写入与交易所写入均为模拟，不能据此声称真实资金闭环完成。

2026-11-02 12:55（北京时间）只读核查用户所报地址：Arbitrum Sepolia 有 **0.3 ETH、20 USDC**，Hyperliquid 返回 `role: missing`、合约可提余额 0、现货为空。源链已经有 Gas，但测试 USDC 尚未进入 HyperCore；进入存款是正确的前置步骤。回执为 `output-tdd/funding-dialogs/account-read-final.json`，没有请求签名或转账。之前的 0 ETH 回执属于较早状态，不代表当前余额。

本地存提范围仍为 USDC 的 Arbitrum Sepolia CCTP 通道；官方其他资产、旧桥、HyperEVM 等路线未扩展。交易连接已在后续校对中改为默认标签页保存、可选持久保存，见本文最新记录。真实钱包签名与跨链到账尚待账户持有人逐笔验收，简历未更新。

## 保留的钱包接入

EIP-6963 多扩展选择与 legacy 注入钱包回退继续可用。连接仅请求公开地址，交易授权与 ERC-20 授权分别确认；交易 API 钱包默认保存在当前标签页，刷新后通过交易所核验恢复；勾选保持连接才持久保存。断开或切换账户使旧签名会话失效，单纯切换 EVM 网络保留 HyperCore 会话，源链充值前重新核对 Arbitrum Sepolia。资金操作始终使用主钱包。

## 上一轮专业菜单与多产品高级订单

下单区的“限价单 / 市价单 / 专业”相邻排列。入口悬停和展开时背景保持透明；选中高级类型后第三个入口显示该名称，基础 Tab 不保留错误的选中态。菜单有独立实色背景、标题和说明，支持键盘、Esc 与窗口边界约束。1440px 和 375px 的浏览器用例检查入口间距、背景实际颜色、菜单边界、选中回显和各产品选项，截图在 `output-tdd/playwright/order-type-menu/`。

合约/HIP-3 保留已有高级类型；现货新增阶梯、TWAP、追价；预测新增阶梯。能力过滤同时用于 UI 和订单构造，不能绕过 UI 构造现货条件单或预测 TWAP。现货按现货 tick 报价，预测为整数份额、五位小数报价、每档至少 1 USDC。预览和确认重读可用余额及费率，阶梯按整批检查；追价撤单后查询最终剩余量，每次重挂前复查余额。TWAP 和追价记录使用可读市场名称。

新增 5 项单元用例与 7 项浏览器用例，覆盖菜单交互、整批金额、冻结余额、价格/数量边界、部分拒单、现货/预测撤单、原生 TWAP 参数与停止、追价剩余量及余额不足停止，以及确认过程中账户切换。所有交易均在模拟钱包和拦截的交易所边界内执行，没有实际签名或交易所成交验收。

## 保留的图表修复

切回基础版时，旧实现在图表内部宽度尚为 0 时恢复留白，留白随后被引擎的范围限制裁掉。修复先调用 resize，等布局完成后再恢复默认间距、右侧留白及自动价格范围；隐藏或卸载时取消待执行的恢复帧。

回归用例先等待加载遮罩退出，再拖动和缩放，确认离开实时位置。切到 TradingView 再切回后，直接扫描画布的蜡烛位置，与初始位置比较；同时检查图表 DOM 实例不变、当前周期保留、连续切换正常、只建立一个行情连接、没有交易请求。修复前在“回到实时按钮仍可见”处失败，修复后通过。

两套引擎的成交量均为 60% 不透明度。测试直接读取画布像素：基础版的 Alpha 约为 153/255；TradingView 对背景合成后的颜色也符合 0.6。关闭再开启 VOL 后仍保留该颜色。

## 已执行的检查

- `npm run lint`：Biome 检查 122 个文件，通过；包含格式检查。
- `npm run typecheck`：通过。
- `npm test`：58 项通过。覆盖行情历史/实时合并、切币隔离、订单精度、最小金额、余额/只减仓上限、条件/阶梯/TWAP/移动止损请求、签名数据、批量部分拒单、追价剩余量、帧合并及降级恢复。
- `npm run build`：Next.js 16.4.3 webpack 生产构建通过。
- `npm run test:e2e -- --workers=1`：生产服务上 67 项通过。覆盖模拟钱包授权、首次入金引导、基础和高级下单/撤单/仓位保护、拒单与不明回报保护、普通/稀疏盘口的固定行高、累计与 hover、最新成交链接、分类市场与资产编码、窗口高度和两套图表。
- 21 项 Web3 资金与钱包用例全部包含在上述 67 项生产回归中；本轮新增 Gas 拒绝重试、旧授权恢复、授权后取消存款和切换账户中止用例。完整回归日志为 `output-tdd/deposit-input/e2e-integrated.log`。上一轮资金下拉专项曾连续 3 次通过，本轮由完整回归再次覆盖。
- 最后一次窄屏布局调整后重新构建，并运行列对齐、桌面整屏布局、产品分类及独立资金弹窗 5 项用例，全部通过。窄屏额外断言图表高度不少于 504px、订单簿不与图表重叠、整页无溢出及弹层完整留在视窗内。日志为 `output-tdd/market-alignment/green.log`；其余未受布局影响的资金用例没有重复执行。
- 上一轮 `npm run test:live`：生产服务上 1 项通过，本轮未重复运行。使用真实测试网行情检查 BTC/ETH、周期和图表切换、盘口/最新成交/浮层链接、375/768/1024/1440/2560px 布局；没有页面异常、整页横向溢出或 `/exchange` 请求，公开行情 WebSocket 始终为一个。TradingView 成交量独立窗格约占 25%。
- 上一轮保留的 `npm run verify:read` 结果：已通过市场元数据、HTTP 订单簿、历史蜡烛、WebSocket 盘口查询，回执包含 BTC 资产索引 3、289 根蜡烛；`accountRead: false`、`exchangeWrites: false`。
- 上一轮 Husky pre-commit：在隔离副本暂存文件并实际运行，lint-staged、类型检查和 56 项单元测试通过；主项目没有暂存或提交。本轮未改动钩子，未重复执行。隔离检查使用 `sh -e .husky/pre-commit`，确保前置检查失败会中断。
- 保留上一轮核验：589 个 Charting Library 文件与 FameEX 原始 SHA-256 全部一致。FameEX 原仓库未改动，原有 `quickOrderPayload.ts` 修改保留。

本轮 `build.log`、`lint.log`、`typecheck.log`、`unit.log` 和 `e2e-integrated.log` 位于 `output-tdd/deposit-input/`；市场列对齐专项日志位于 `output-tdd/market-alignment/`；截图分别位于 `output-tdd/playwright/deposit-input/` 和 `output-tdd/playwright/market-alignment/`。上一轮首次入金、独立资金弹窗、真实行情和隔离钩子证据保留原目录。

交易浏览器测试替换了钱包和交易所边界，并恢复签名地址、检查测试网签名域与请求内容。通过这些测试不代表真实交易所已接受签名或撮合订单。

## 市场分类与性能验证的范围

默认合约、HIP-3、现货和预测使用各自真实代码与资产 ID。现货下单区提供基础限价、市价、阶梯、TWAP、追价，预测提供限价、市价、阶梯；两者均不显示永续杠杆；现货冻结余额、预测整数份额和价格边界在单元及浏览器测试中检查。已用真实只读页面选择 `@1035` 现货、`#102170` 预测和 `test:ABC` HIP-3，未发送交易请求。无历史或深度的市场显示空状态，缺失统计显示 `—`。

高频模拟消息验证了 rAF 合并、队列上限、账户/市场隔离和持续超载后的降级恢复。指标不等于长时间压力认证，尚未进行多小时极端行情、真实设备内存压力或所有浏览器的钱包兼容测试。

## 证据与查看方式

本地证据均在被 `.git/info/exclude` 排除的目录中，不进入提交：

```text
output-tdd/web3-onboarding/before/
output-tdd/web3-onboarding/changes.txt
output-tdd/web3-onboarding/web3.patch
output-tdd/web3-onboarding/lint-final.log
output-tdd/web3-onboarding/typecheck-final.log
output-tdd/web3-onboarding/unit-final.log
output-tdd/web3-onboarding/build-final.log
output-tdd/web3-onboarding/e2e-final.log
output-tdd/web3-onboarding/e2e-web3-final.log
output-tdd/web3-onboarding/live-final.log
output-tdd/web3-onboarding/read-only.log
output-tdd/web3-onboarding/contracts-read-only.json
output-tdd/web3-onboarding/hook-final.log
output-tdd/playwright/web3-onboarding/
output-tdd/order-type-menu/before/
output-tdd/order-type-menu/changes.txt
output-tdd/order-type-menu/order-types.patch
output-tdd/order-type-menu/lint-final.log
output-tdd/order-type-menu/typecheck-final.log
output-tdd/order-type-menu/unit-final.log
output-tdd/order-type-menu/build-final.log
output-tdd/order-type-menu/e2e-final.log
output-tdd/order-type-menu/live-final.log
output-tdd/order-type-menu/read-only.log
output-tdd/order-type-menu/hook-final.log
output-tdd/order-type-menu/chart-library-check.json
output-tdd/playwright/order-type-menu/
output-tdd/chart-viewport/before/
output-tdd/chart-viewport/changes.txt
output-tdd/chart-viewport/viewport.patch
output-tdd/chart-viewport/lint-final.log
output-tdd/chart-viewport/typecheck-final.log
output-tdd/chart-viewport/unit.log
output-tdd/chart-viewport/build-final.log
output-tdd/chart-viewport/e2e-final.log
output-tdd/chart-viewport/live-final.log
output-tdd/chart-viewport/hook-final.log
output-tdd/chart-viewport/chart-library-check.json
output-tdd/market-categories/e2e-viewport-before.log
output-tdd/market-categories/changes.txt
output-tdd/market-categories/categories-live.log
output-tdd/market-categories/read-only.log
output-tdd/hyperliquid/read-only.json
output-tdd/playwright/chart-viewport/restored.png
output-tdd/playwright/market-detail/live/
```

仓库尚无初始提交，源码显示为未跟踪文件，普通 git diff 不显示内容。查看本次核心修复：

```sh
cd /Users/julian/Documents/Codex/2026-11-02/hyperliquid-testnet-terminal
git status --short
git diff --no-index -- output-tdd/deposit-input/before/src/components/trading/market-selector.tsx src/features/market/components/market-selector.tsx
```

`git diff --no-index` 返回 1 表示有差异。回退应按差异逐项处理，不能整体覆盖后续工作区修改。

## 仍未验证

上文最后一次只读核验时，用户源链有测试 USDC，Hyperliquid 账户尚未入金激活；本轮没有再次查询用户余额。真实授权、真实挂撤单、撮合、减仓/平仓、TWAP/移动止损的交易所接受情况，以及费用/保证金/清算价核对仍未验证。默认合约与现货划转已实现并通过模拟测试，真实资金闭环尚未验证；HIP-3 调拨、预测份额合并/赎回和组合保证金借贷未实现。

本阶段未新增依赖，也未重新执行依赖审计；之前的低严重度 HeroUI/deepmerge 记录保留在 `output-tdd/fameex-components/audit.log`，不能视为已修复。

简历未修改。只有真实账户验收通过后，才能据实写入“个人 fameex-testnet 项目”，不能写成生产交易平台、量化收益或撮合/清算引擎研发经验。
