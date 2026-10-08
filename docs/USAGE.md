# 使用与排障

基本安装和下载见 [README](../README.md)，Windows 的 PowerShell 用法见 [Windows 指南](WINDOWS.md)。支持来源和实际能力以当前 CLI 为准；目前仅实现 Scribd，SlideShare、Everand、Fable 仍待适配。

## 环境与内核安装问题

最低 Node.js 版本为 22.15，推荐 24 LTS；使用 pnpm 11.19.0。应用使用官方 Camoufox TypeScript SDK，不需要 Python。

`pnpm browser:install` 会复用兼容的已有内核。需要重新安装内核时使用 `pnpm browser:install --force`，兼容版本由锁定的 SDK 决定。

如果安装报 GitHub API 403/rate limit，可以稍后重试，或通过本机环境变量 `GITHUB_TOKEN` 提供令牌。不要把令牌存入仓库或发到聊天中。

如果 PowerShell 禁止执行 `npm.ps1` 或 `pnpm.ps1`，可改用 `npm.cmd`、`pnpm.cmd` 执行相同命令。

## 其他命令

```bash
pnpm dev sources --json
pnpm dev inspect "https://www.scribd.com/document/990798737/AAGnet"
```

`sources` 显示实际来源能力；`inspect` 只识别链接，不联网、不验证内容权限。输入支持完整 Markdown 链接，建议直接使用纯 URL。

构建后也可以运行编译后的 CLI：

```bash
pnpm build
node dist/cli.js --help
```

下载默认复用保存的登录会话；`--guest` 不读取已保存的 profile。`login` 中按 Enter 表示保存并关闭会话，不代表程序已经验证了账号或订阅权限。

## Profile 与缓存

| 数据 | macOS | Windows |
| --- | --- | --- |
| 登录 profile | `~/.scribddock/profiles/scribd` | `%USERPROFILE%\.scribddock\profiles\scribd` |
| Camoufox 内核缓存 | `~/Library/Caches/camoufox` | `%LOCALAPPDATA%\camoufox\camoufox\Cache` |

环境变量 `SCRIBDDOCK_PROFILE_DIR` 可覆盖 profile 路径，支持 `~/`、`~\` 展开。登录和后续下载需要使用同一配置；内核缓存和登录 profile 互相独立。

重置登录时，先关闭使用该 profile 的 Camoufox，再把自己的 profile 目录改名备份，然后重新运行 `login`。不要直接删除 profile 或把 Cookie、密码、环境变量文件和下载内容提交到 Git。

## 输出与 PDF

省略 `-o` 时使用文档标题命名，只有通用网站标题时使用文档 ID。Windows 文件名和被查看器占用的输出处理见 [Windows 指南](WINDOWS.md)。

下载成功时 stdout 只有最终文件路径，进度和错误输出到 stderr。退出码为成功 0、运行失败 1、参数错误 2。

每次下载使用独立临时目录，PDF 校验成功后才替换目标；失败保留已有文件并清理本次临时目录。

结果是阅读器导出的 PDF，与上传原文件不保证相同。保留原有文字层、字体和图形，扫描件不自动 OCR。页数、资源和非空内容流不证明视觉完整性；需要时逐页检查。不绕过登录、订阅、验证码或 DRM，不把预览当作完整文档。

字体等待、页面溢出和平台打印行为见 [PDF 导出与验证](PDF_EXPORT.md)。

## AI Agent skill

将仓库的整个 `skills/scribddock` 目录复制到 `$CODEX_HOME/skills`；未配置 `CODEX_HOME` 时使用用户主目录的 `.codex/skills`，Windows 通常为 `%USERPROFILE%\.codex\skills`。已有同名 skill 时先比较版本，保留自己的修改。

使用 `$scribddock` 安装、登录、下载或排障。项目更新后，重新复制 skill 目录。

## 开发与验收资料

- [开发约定与检查命令](../AGENTS.md)
- [来源契约](SOURCE_CONTRACT.md)
- [Python 参考对齐审计](PARITY_AUDIT.md)
- [路线图](ROADMAP.md)
- [来源说明](PROVENANCE.md)
