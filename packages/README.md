# FameEX 源码复用说明

本项目要用 FameEX 的实际基础组件和图表，同时让所有交易行为符合 Hyperliquid 测试网。因此这里保存需要的源码快照，通过 npm workspace 导出 `@fameex/ui`、`@fameex/utils` 和 `@fameex/kline`。运行项目不依赖本机另一个仓库，也不会改动那个仓库。

源码来自 `/Users/julian/fameex-web`，读取时 HEAD 为 `d2f862eba4082f1ebe9105e354c5a26ccfb09f8c`。`fameex-source.json` 记录逐文件原始 SHA-256；当前副本含下列适配，不能把原始哈希当作当前文件哈希。没有复制该仓库已有改动的 `quickOrderPayload.ts`。

## 一次操作怎样调用这些代码

例如输入 BTC 数量并预览订单：页面使用 `@fameex/ui` 的 Input 接收文本，再由原有 `prepareOrder` 按 Hyperliquid 市场元数据检查数量和价格精度。Button 打开确认框；实际授权、签名、发送仍走 `src/lib/hyperliquid.ts`。组件只负责交互，不替换资金或订单规则。

- `ui`：复用 Button、Input、Select、Checkbox、Spinner、Tabs、Slider、SmartPopover、Modal 的实际实现及样式，保留原工程的 HeroUI 2.8.5。Motion 依赖采用原锁文件中的 Framer Motion 12.7.4、motion-dom 12.7.4 和 motion-utils 12.7.2，并锁定配套版本，避免新版子依赖导致生产构建缺少导出。Input 的标签补齐关联及原生输入属性；Select 修复一处无效 CSS 选择器并移除多余背景色；SVG 补齐无障碍属性。Select 允许调用方配置 slot 尺寸；Tabs 保留原实现及动画，避免全局禁用动画后丢失自定义选中条。Slider 使用原样式与拖动交互，将 `es-toolkit/union` 换成原生 Set，刻度按钮补齐键盘与禁用状态，未为去重新增依赖。SmartPopover 沿用原状态 hook，点击型弹层不随鼠标离开关闭，触发器改为可键盘操作的按钮，并在卸载时清理计时器。市场列表的搜索、分类和排序参考 `TradeHeader/MarketList`，数据及下单规则由本项目提供。其余差异主要是 Biome 格式和无用导入清理。
- `utils`：复用 `classNames/cn`、`getColorByCssVar`、`createCssVar`、`withAlpha`。它们实际用于组件样式合并和图表颜色。类名合并保留默认字号组，再追加 FameEX 的自定义字号，修复 `text-xs` 被 `text-1` 覆盖的问题。没有引入 FameEX 的请求鉴权、密码处理或 CEX 签名工具。
- `kline`：复用 `BaseKlineChart`、实例生命周期、加载遮罩、成交量窗格、日期格式、颜色、图例和覆盖物入口，使用原版本 KLineChart 10.1.0。修正 ahooks 泛型擦除问题；本项目不接入快捷下单覆盖物，因此恢复原生十字线价格标签。成交量使用独立颜色变量及 60% 不透明度，以便价格蜡烛保持原色。上游 store 是单例，本页面始终只挂载一个图表实例。
- `public/lib/charting_library`：原样复制 `apps/web/public/lib/charting_library`，版本为 v27.006，约 15 MB；保留原始文件、标识和声明。该目录是第三方分发文件，Biome 不改写它；业务适配层仍接受 lint、类型和行为检查。
- `src/app/fameex-theme.css`：从 `apps/web` 暗色 CSS 变量和 `packages/config/tailwind-preset.js` 提取所需令牌，转换为 Tailwind 4 主题及工具类。没有引入原工程的 Tailwind 3 或整套构建配置。`src/app/globals.css` 将终端颜色别名直接映射到这些令牌，复用 FameEX 暗色背景、紫色品牌色与涨跌色。
- `public/fameex-chart-icons.svg`：从 FameEX 原 Iconify 文件提取 11 个图标，`ChartIcon` 直接引用这些 SVG 路径。语言、交易设置、选中状态、成交链接及市场和精度下拉均使用原图标。

订单簿精度菜单复用 `@fameex/ui` 的 Select 和下拉箭头，沿用 FameEX 订单簿选择交互。聚合计算由本项目的 `orderBookData` 完成，以十进制运算合并已接收的深度；不复制 FameEX 的行情请求或 CEX 盘口协议。

下单区的类型选择参考 `apps/web/src/apps/Futures/components/OrderPanel/OrderTypeTab.tsx` 和 `TriggerTypeDropdown.tsx`：复用已有 `dropdownStyle()`，通过 `@fameex/ui` 导出相同 HeroUI Dropdown 原语。公共组件 `OrderTypeSelector` 负责相邻 Tab、原箭头、选中回显和清晰的实色菜单；显示“专业”并取消入口悬停背景。各产品支持哪些类型、精度和余额校验仍由 Hyperliquid 业务层决定，没有复制 FameEX CEX 下单逻辑。

资金和交易授权弹窗适配 `apps/web/src/components/Modal.tsx`：保留 HeroUI Modal 原语、480px 宽度、16px 圆角、24px 内容间距、Close 原图标和进入/退出动画，窄屏按视口收缩，内容区可滚动。覆盖 HeroUI 默认桌面大外边距为 12px，避免高弹窗出现外层滚动并误关下拉。去掉此处不用的尺寸选项和业务依赖；增加可读的关闭标签与减少动态效果支持。资金下拉挂载在弹窗根节点、滚动正文之外，避免被无障碍隔离误隐藏；同时关闭容器滚动触发的菜单自动关闭，保留外部点击和 Esc 关闭。划转继续参考 Transfer/ModeSelect，交换按钮使用原 `Transfer2.svg` 路径。状态、签名和费用查询仍在 Hyperliquid 的 hook 与业务层。

两套图表都由 `src/lib/chart-feed.ts` 提供数据。初始化时请求 Hyperliquid `candleSnapshot`；实时蜡烛复用 `useMarket` 的 WebSocket 推送。历史返回时按时间去重，并保留已经收到的更新；退订后不再触发旧回调。向左拖动会继续查询可用历史，不能突破 Hyperliquid 最近 5000 根的上限。首次加载目前会与页面行情摘要各查询一次快照，实时连接没有另开一套。

## 基础版绘图、指标与交易线

基础版左侧绘图栏复用 FameEX `packages/kline/src/drawing` 的 SVG 和 XABCD 模板，提供直线、射线、线段、价格通道、斐波那契与 XABCD，以及磁吸、锁定、隐藏和清除。已完成的绘图按市场写入 `hl-chart-drawings-v1:<币种>`，只保存时间、价格及锁定状态，切换周期仍使用同一市场的绘图。侧边箭头位于图表高度 72% 再向上 20px 处，用于收起与展开；顶部不再提供重复入口；切换时在绘制前同步尺寸，保留用户缩放和滚动位置。清除只操作绘图组；“重置图表”还移除额外指标并恢复默认 MA/VOL 和成交量窗格比例，恢复 6px 蜡烛间距、60px 右侧留白及自动价格轴，并回到最新行情。账户的实时持仓、订单仍由快照同步。指标面板按 FameEX 的 8 个主图、19 个副图指标分类，可搜索、叠加和恢复 MA/VOL。

交易线复用 FameEX `trade-overlays` 的模板、悬停命中、拖拽和生命周期实现。`chart-trade-lines.tsx` 只传入当前账户、当前市场的仓位及委托；持仓按开仓均价显示数量和盈亏，订单按限价或触发价显示。唯一的整仓止盈、止损附在持仓线上；部分仓位和同侧多笔保护单保留独立订单线。没有交易权限或操作忙碌时不接受拖拽。持仓、订单和止盈止损线共用 12px 字体、22px 标签及操作区域，左侧标签统一内缩 80px；右侧价格标签同步放大并保持垂直居中。

例如多仓开仓价 70,000，在持仓线的“止盈 / 止损”按钮向上拖动，弹窗会填入按市场精度转换的止盈价。确认后先重新读取仓位和标记价，再调用原来的只减仓保护单流程。拖动已有整仓保护线时，还会重新读取并逐项核对原订单，随后以 `batchModify` 修改对应订单，使用独立 client order ID 跟踪回报。触发单修改需要官方 API 的 `a: true`；原单若恰在校验后成交，交易所仍可能放置新的只减仓单，因此不自动重试，仍由既有未确认订单流程核对。取消弹窗则销毁临时图形并从账户快照重建；切换市场、钱包或图表引擎会清理旧图形和弹窗。

此处未复制 FameEX 的 CEX 下单服务，也未新增依赖。源文件的 `es-toolkit` 比较及钳位改为小型本地实现；补齐只读拖拽拦截、具体止盈/止损侧的弹窗回调和无障碍键盘入口。运行时仍只使用 Hyperliquid 测试网。

## 验证与已知依赖限制

项目根目录执行 `npm run lint`、`npm run typecheck`、`npm test`、`npm run test:e2e` 和 `npm run test:live`。后两项分别验证模拟交易流程与真实只读行情；具体结果见根目录 `VERIFICATION.md`。

先前的 `npm audit --audit-level=low` 报告 53 个低严重度条目，源头是 HeroUI 2 的 `deepmerge` 依赖，告警沿组件依赖链重复传播；没有中、高或严重级条目。主题合并目前只接收工程内定义的样式，但这不等于上游漏洞已修复。审计建议升级到不兼容的 HeroUI 3，本次仅调整资金交互，保留原组件版本，未重复依赖审计，也没有运行 `audit fix --force`；后续升级需要单独迁移和回归组件。
