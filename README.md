# ScribdDock

TypeScript 命令行工具，围绕 Scribd 家族组织来源适配器。使用 **Camoufox + Playwright** 处理浏览器登录和网页导出；通过官方 `camoufox` TypeScript SDK 接入，不需要 Python。

## 支持情况

| 来源 | 当前能力 |
| --- | --- |
| Scribd | 手动登录、保存会话、文档及嵌入链接导出为 PDF |
| SlideShare | 待适配 |
| Everand | 待调研，不移除 DRM |
| Fable | 待调研 |

未实现的来源会明确拒绝下载，不自动转交其他适配器。`inspect` 仅识别域名，不能验证内容权限。

## 安装

需要 Node.js 22.15+，推荐 24 LTS；使用 pnpm 11.19.0。macOS 可先运行 `brew install node@24` 和 `brew link --force node@24`。

支持 Windows x64，推荐 Windows 11 和 Node.js 24 LTS x64；安装命令、PowerShell 用法和验证范围见 [Windows 指南](docs/WINDOWS.md)。

已在 Windows x64 runner 验证真实 Camoufox、profile 重启复用和公开五页下载；独立提取的每页文字与 Python 参考一致。桌面真人账号登录和逐页视觉效果尚未验收。

```bash
git clone git@github.com:hunknownz/ScribdDock.git
cd ScribdDock
npm install -g pnpm@11.19.0
pnpm install --frozen-lockfile
pnpm browser:install
```

Camoufox 内核使用官方 SDK 的平台缓存目录（macOS 为 `~/Library/Caches/camoufox`，Windows 为 `%LOCALAPPDATA%\camoufox\camoufox\Cache`），可复用兼容的已有安装。登录 profile 单独存放。

安装器会复用兼容的已有内核；需要重新安装时运行 `pnpm browser:install --force`。浏览器版本由锁定的 JS SDK 的兼容范围决定。

若浏览器安装报 GitHub API 403/rate limit，可以稍后重试，或通过本机环境变量 `GITHUB_TOKEN` 提供令牌。不要把令牌存入仓库。

## 命令

```bash
pnpm dev --help
pnpm dev sources --json
pnpm dev inspect "https://www.scribd.com/document/990798737/AAGnet"
pnpm dev login
pnpm dev download "https://www.scribd.com/document/990798737/AAGnet" -o document.pdf
```

`login` 打开 Camoufox，完成网页登录后回终端按 Enter 保存并关闭会话。此确认表示保存浏览器会话，不代表验证了账号或所有文档的下载权限。程序不代填密码或验证码。

下载默认使用保存的会话。无需登录且允许完整访问的内容，可以使用游客模式：

```bash
pnpm dev download "https://www.scribd.com/document/990798737/AAGnet" --guest -o document.pdf
```

省略 `-o` 使用阅读器提供的文档标题命名；只有通用网站标题时使用文档 ID。支持完整 Markdown 链接，但建议直接使用纯 URL。

下载成功时 stdout 只输出最终文件路径，加载进度和错误输出到 stderr。退出码：成功 0、运行失败 1、参数错误 2。

构建后也可运行：

```bash
pnpm build
node dist/cli.js sources
node dist/cli.js download "https://www.scribd.com/document/990798737/AAGnet" --guest -o document.pdf
```

## 数据和失败行为

- profile 在当前用户主目录下的 `.scribddock/profiles/scribd`（Windows 为 `%USERPROFILE%\.scribddock\profiles\scribd`）；环境变量 `SCRIBDDOCK_PROFILE_DIR` 可以覆盖该位置。支持 `~/`、`~\` 路径。
- `--guest` 不读取已保存 profile；登录后请省略这个选项。
- 每次下载使用独立的临时目录。PDF 校验成功后才替换目标，失败保留已有文件并清理本次临时文件。
- 浏览器内核、profile、Cookie、密码、环境变量文件和下载内容不提交到 Git。
- 重置登录时先关闭相关 Camoufox 进程，再移走自己的 profile 目录作为备份，然后重新运行 `login`。

## PDF 的含义

结果由 Camoufox 加载 Scribd 阅读器，经 Firefox 原生打印导出，保留网页原有的文本层、字体和矢量绘制。网页中原本可选的文字可以在 PDF 中选择、复制或搜索；扫描图片不会自动变成可选文字，本项目不做 OCR。结果不保证与上传原文件相同。实现依赖平台私有接口，网页变化可能导致失败。

当前检查页面数量和尺寸、页面加载、字体与图片请求、导出布局、PDF 页数以及非空内容流。这些检查不能证明视觉完整性，下载后仍需检查每页。有登录、订阅、验证码或 DRM 限制时遵守平台授权，不把预览视为完整文档。

文档专用字体从阅读器提供的清单加载并注册，避免使用替代字体造成文字重叠。字体加载有超时限制，失败会中止导出。

阅读器内容超过标称纸张尺寸时，导出区域会扩展以容纳内容。纸张尺寸可能与原文件不同；扩展后仍发生溢出会报错。macOS Quartz 的 PDF 页框可能与绘制区域不一致，整页也可能等比缩放；程序检查布局比例后恢复页框、正文和链接坐标，避免裁切和点击位置错位。详见 [PDF 导出与验证](docs/PDF_EXPORT.md)。

## Codex skill

项目附带 [ScribdDock 助手](skills/scribddock/SKILL.md)，用于安装、手动登录、下载与排障。它按当前 checkout 的能力执行操作，保留 profile 和既有输出，不代表新增了下载来源。

将整个 `skills/scribddock` 目录复制到 Codex 的 `$CODEX_HOME/skills`；未配置 `CODEX_HOME` 时使用用户主目录下的 `.codex/skills`，Windows 通常为 `%USERPROFILE%\.codex\skills`。已有同名 skill 时先比较版本，避免覆盖自己的修改。

调用示例：`使用 $scribddock 下载这个 Scribd 链接，保存到我的 Downloads 目录。` 安装到本机的副本与仓库分开；更新项目后需同步 skill 的三个文件。

## 开发与验证

```bash
pnpm typecheck
pnpm check
pnpm test
pnpm build
```

普通测试不访问外部网络、不启动浏览器，在 Linux、Windows CI 中运行。需要明确执行真实下载验证时运行 `pnpm test:live`；可用 `SCRIBD_TEST_URL` 提供自己有权下载的样例。真实测试创建并清理临时 PDF，不包含人工视觉审核。

安装内核后，可以运行 `pnpm test:browser` 检查本地 Camoufox 的脚本调用和导出布局；该测试使用合成页面，不访问 Scribd。

应用契约位于 `src/domain.ts`、`ports.ts`、`service.ts`；集成实现在 `adapters/`；`composition.ts` 绑定具体来源。参见 [Python 参考对齐审计](docs/PARITY_AUDIT.md)、[来源契约](docs/SOURCE_CONTRACT.md)、[路线图](docs/ROADMAP.md)、[开发约定](AGENTS.md) 和 [来源说明](docs/PROVENANCE.md)。
