# Python 参考项目对齐审计

审计日期：2026-10-08。参考仓库为 [ma-pony/scribd-downloader](https://github.com/ma-pony/scribd-downloader)，基线提交为 `1ae93a753cdb56581d3cc7ffd5d674480519e682`。已检查全部六个源码模块、五个测试文件、README、安装配置及设计/验收文档；设计文档中未实现的设想不算已有功能。

参考项目的本地浏览器启动文件已有宿主 OS、en-US 和登录窗口大小的调整，用来解决乱码。本次对照保留这项调整，没有修改参考源码。ScribdDock 保持自己的全新 Git 历史。

## 功能对应

| 参考行为 | TS 实现 | 验证 |
| --- | --- | --- |
| login、download、guest、-o、帮助 | `src/cli.ts` | 原 Python 解析器输出的固定样例；打包后实际 CLI |
| 成功 0、下载失败 1、参数错误 2 | `src/cli.ts` | 固定样例及模拟失败；实际安装的入口验证参数错误 |
| stdout 只有输出路径，stderr 显示页数进度 | `src/cli.ts` | 原行为对照测试和真实命令 |
| 标题清理、通用标题退回文档 ID | `src/filenames.ts`、`adapters/scribd/renderer.ts` | 原 Python 函数生成的标题样例 |
| document/doc/embeds 链接及有效文档 ID | `adapters/scribd/renderer.ts` | 原输入样例与无效输入测试 |
| 手动登录、持久 profile、权限 0700；guest 不使用 profile | `adapters/camoufox.ts`、`adapters/scribd/index.ts` | SDK 参数测试、已有目录权限收紧测试、真人登录和会话复用 |
| 主世界 docManager、注册数量与页尺寸检查 | `adapters/scribd/evaluate.ts`、`renderer.ts` | 执行上下文销毁重试、注册延迟、初始化超时及实际浏览器 |
| 按八页批次加载，预加载页面仍等待字体并开启图片 | `adapters/scribd/scripts.ts` | 与参考脚本的语义对照、可执行加载顺序测试、20 页真实样例 |
| 页面、图片、文档字体失败时中止；排除网页 UI 字体 | `adapters/scribd/renderer.ts` | 原资源分类固定样例、资源失败与敏感查询脱敏测试 |
| 按页序重建打印 DOM，检查分页和溢出 | `adapters/scribd/scripts.ts`、`renderer.ts` | 合成浏览器布局测试、真实逐页视觉检查 |
| Firefox 静默打印，保留文字、字体与图形 | `adapters/camoufox.ts`、`scripts.ts`、`adapters/pdf.ts` | 禁止截图/图片拼装的边界测试、实际原生打印、独立文字提取 |
| 等待完整 PDF，检查页数、页框与内容流 | `adapters/pdf.ts` | EOF、延迟追加、超时、空白/损坏/页数不符的正反测试 |
| 失败保留既有文件；成功后才替换 | `adapters/scribd/index.ts`、`adapters/pdf.ts` | 损坏 PDF、关闭浏览器失败、无效目标目录及临时文件清理测试 |

初始化状态、批次加载和批次就绪三个主世界脚本与参考实现一致。DOM 打印准备在同一流程上增加溢出处理；不能把这项改进称为源文件的逐字复制。

## 本次补齐

- 恢复参数错误退出码 2、纯路径 stdout 和原格式 stderr 进度。
- 排除 `/webpack/` 网站 UI 字体；按参考优先级分类页面资源，避免错误地阻止下载。
- 通用标题恢复为空的内部元数据，同时保持文档 ID 输出文件名。
- 补足初始化注册进度、导航、批次加载/就绪、打印 DOM 和输出目录的失败阶段。
- PDF 必须以 EOF 标记结束，不能仅在文件中找到该标记；额外等待文件大小稳定。
- 字体加载和 `document.fonts.ready` 共用 45 秒上限，防止最后一步无限等待。
- 缺少 Camoufox 内核时提示 TS 项目的安装命令。
- 构建前清理生成目录，打包前重新构建，避免发行包携带已删除的旧浏览器模块。
- 修正 Quartz 校验过严的问题：原生打印可能把整页等比缩放。现在要求裁剪区域与 DOM 纵横比一致、缩放在 0.5–2 范围且全部页面使用同一比例，再恢复 CSS 纸张尺寸；非等比或跨页不一致仍拒绝。
- 正文平移/缩放时同步调整注释坐标，保持超链接点击区域与文字的位置一致，不改变链接目标。

原 Python 函数/解析器的实际输出保存在 `tests/fixtures/legacy-contracts.json`，由 `tests/legacy-parity.test.ts` 执行对照。固定样例共 34 项，连同输出协议、字体等待顺序和打印参数共 37 项对照测试；CI 不需要安装 Python 或参考项目。升级基线时应在独立参考 checkout 重新生成输出并逐项审查，不能仅按 TS 实现更新期望值。

## 真实运行证据

环境为 macOS、Node 24、官方 `camoufox@0.5.8` TS SDK 和其兼容内核。Python 参考使用自己的既有 Python SDK/内核，所以比较内容与效果，不比较 PDF 字节。

| 样例/模式 | 结果 |
| --- | --- |
| 公开 [Sample 5 Page PDF](https://www.scribd.com/document/884183779/Sample-5-Page-PDF)，Python 与 TS guest | 各 5 页；每页提取文字逐字相同，每页 1479 字符；均有字体资源 |
| 公开 [AAGnet](https://www.scribd.com/document/990798737/AAGnet)，Python 与 TS guest | 各 20 页；Unicode 规范化并去除空白后，每页文字相同；页序一致 |
| 人工登录后关闭并重开保存的 profile | 账户页面返回 200，最终路径 `/your-account`，显示账户设置且没有登录表单；只记录这些布尔/状态证据，不记录账户信息或 Cookie |
| TS 保存会话下载上述 5 页样例 | 全部 5 页，文字和尺寸与 TS guest 逐页一致 |
| TS 保存会话下载上述 20 页样例 | 全部 20 页，尺寸与 TS guest 一致；每页仅多一个不换行空格和换行，规范化后的正文逐页一致 |
| 本地 Camoufox 原生打印两个不同尺寸的合成页面 | 两次均保留字体资源，最终页框符合对应 CSS 尺寸 |
| 并行复测捕获的等比缩放原生 PDF | 捕获约 98% 和 89.82% 的完整纸张缩放；正文与正常输出逐页一致。用保存的原始输出复验校正，保留字体、正文和链接目标 |
| 修复后编译 CLI 并行下载 20 页 guest / 5 页保存会话样例 | 两个命令均退出 0，并通过完整 PDF 校验 |

独立使用 pypdf 检查所有页的文字与字体资源，使用 Poppler 渲染 5 页和 20 页输出并逐页查看缩略图，放大检查首页、复杂图表页与末页。Python 的原始 Quartz 输出也存在 Letter MediaBox 与实际绘制区域不一致；仅为视觉比较创建另一个校正页框的副本，未修改原始输出或参考代码。

人工登录与复用测试不等于订阅权限测试：这些公开样例在 guest 模式也可访问，没有证明付费或受限内容可以导出。

最终离线测试 148 项通过，5 项真实测试默认跳过；本地 Camoufox 测试另有 4 项通过。参考 Python 自带测试为 37 项通过、1 项联网测试跳过。对捕获的 20 页缩放文件，独立复核 859 个链接的坐标变换及目标地址均保持正确。打包后安装到隔离目录，实际 bin 的帮助、参数退出码和旧构建模块清理检查通过。

## 保留的差异与限制

- 全部应用代码为 TS；使用官方 TS Camoufox SDK，不调用 Python 下载器，不自动换用 Chromium。两种 SDK 的内核、默认视口和字体环境可能不同；可见页面布局需要实际比较。
- 项目名称、profile 路径、中文提示，以及 sources/inspect 命令属于 ScribdDock。旧 profile 仅能通过明确配置路径复用，不自动复制凭据。
- 输入域名、端口和资源主机校验更严格；不复刻参考实现对相似域名的宽松处理。文件名也清理更多 Unicode 控制字符。
- 输出是阅读器重建 PDF，非上传原文件。扫描文档仍没有文本层，不添加 OCR，不退回截图。
- 页面实际溢出时扩展打印区域；Quartz 页框仅在开头裁剪矩形与布局纵横比及全局打印比例匹配时校正，并同步恢复文字、图形和链接坐标。纸张尺寸和文件大小可以不同。
- 最初把 CSS 像素到 PDF 点的比例固定为 0.75，并要求实际裁剪矩形逐点相等，错误地拒绝了完整的等比缩放输出。并行复测中保存原始文件，检查图片矩阵、文字、纸张边界确认整页同比缩放；这属于 TS 适配层的校验假设，而非 TS 语言无法实现原功能。关闭 shrink-to-fit 或固定窗口均不能可靠消除这个现象，最终保留参考打印设置并处理可验证的等比缩放，不猜测扩大裁剪区。
- 没有实测 Windows/Linux、订阅受限文档、扫描/超长/混合尺寸文档的完整视觉效果。默认 CI 只运行离线测试；平台私有接口变化仍可能导致明确失败。
- 参考项目只实现 Scribd。SlideShare、Everand、Fable 仍如实标记待适配，不能以本次对齐宣称这些产品已支持下载。

## 可重复检查

```bash
pnpm typecheck
pnpm check
pnpm test
pnpm build
pnpm test:browser
git diff --check
```

真人登录与真实 CLI 样例需在本地再次执行，并独立检查导出文件；不能用模拟浏览器或非空内容流代替完整效果验收。
