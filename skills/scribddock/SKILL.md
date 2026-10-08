---
name: scribddock
description: 使用 ScribdDock 安装环境、手动登录、下载已获授权的 Scribd 文档，或排查 Camoufox、profile 与 PDF 导出问题。用户提到 ScribdDock 或明确要求用该项目处理 Scribd 链接时使用；不用于普通网页下载、其他下载器或未实现来源的下载。
---

# ScribdDock

把用户的请求落实为可验证的安装、登录或下载结果；排障时给出失败阶段和下一步依据。项目是 TypeScript CLI，通过官方 Camoufox TS SDK 启动浏览器；不要换成 Python 桥接、系统浏览器或截图拼 PDF。

## 定位项目与能力

从当前项目、用户给出的路径或此前已确认的 checkout 定位仓库，确认 `package.json` 的包名为 `scribddock`。没有 checkout 且用户要求安装时，clone `https://github.com/hunknownz/ScribdDock.git` 到不冲突的目录；不覆盖已有目录。不要把技能安装目录当作项目目录，也不要硬编码原作者机器路径。

先读该 checkout 的 `AGENTS.md`、`README.md`；需要安装排障、profile 配置或高级命令时读 `docs/USAGE.md`，涉及导出效果或平台支持时再读 `docs/PDF_EXPORT.md`、`docs/PARITY_AUDIT.md` 或 `docs/WINDOWS.md`。命令和兼容版本以实际 checkout 为准。

运行 `pnpm dev sources --json` 查看当前能力，`pnpm dev inspect "<url>"` 仅识别链接，不联网、不证明权限。当前只有 Scribd 实现下载；SlideShare、Everand、Fable 是规划中的来源，明确拒绝尚未实现的操作。用户要求调研或开发时可说明缺口，不伪装成已经能下载。

## 安装与执行

在已定位的项目目录执行命令。按 `package.json` 的 engines/packageManager 检查 Node.js、pnpm；当前推荐 Node.js 24，pnpm 11.19.0，Windows 使用 x64。缺少依赖时运行 `pnpm install --frozen-lockfile`，缺少兼容内核时运行 `pnpm browser:install`。只有证据指向内核损坏时才使用 `--force`；不清空整个浏览器缓存，也不调用 Python 的 `camoufox fetch`。

常用命令：

```text
pnpm dev --help
pnpm dev sources --json
pnpm dev inspect "<url>"
pnpm dev login
pnpm dev download "<url>" -o "<output.pdf>"
pnpm dev download "<url>" --guest -o "<output.pdf>"
```

已有构建可用 `node dist/cli.js` 替换 `pnpm dev`。只有源码变化或缺少构建时才需要 `pnpm build`。优先传纯 URL，并引用含空格的路径；CLI 也接受完整 Markdown 链接。不要把 `uv run scribd-downloader` 当作本项目命令。

## 登录与 profile

默认下载复用保存的 profile；`--guest` 使用临时会话，不读取登录状态。不要因为登录下载失败就静默改为游客模式。

`pnpm dev login` 打开可见 Camoufox。让用户在该窗口中手动完成登录和验证码，不索要聊天中的密码、Cookie 或验证码。只有用户完成操作后才向登录进程发送 Enter，随后等待正常退出；如需用户配合，保留交互进程并说明等待什么。按 Enter 只是保存并关闭会话，不能称为账号或订阅权限验证成功。

profile 默认位于用户主目录的 `.scribddock/profiles/scribd`；Windows 通常为 `%USERPROFILE%\.scribddock\profiles\scribd`。`SCRIBDDOCK_PROFILE_DIR` 可覆盖位置，支持 `~/`、`~\` 展开；使用当前进程环境和项目路径函数确认实际位置，不输出完整环境变量。内核缓存与 profile 是两个目录。

只有用户要求重置时才处理 profile。先确认相关会话已关闭，然后把实际 profile 重命名为带时间戳的备份，再重新登录；不要递归删除、杀掉全部浏览器、迁移原 Python 项目的 profile，或把备份提交到 Git。

## 下载与验收

只导出用户能够合法完整访问的内容；不绕过登录、订阅、验证码或 DRM，不把预览页当作完整结果。已有保存会话按默认模式下载；仅在用户要求或确认无需登录时选择 `--guest`。

明确输出位置，避免无意覆盖现有文件；未要求覆盖时可选择不冲突的文件名并告知用户。程序在完整 PDF 校验后才替换目标，失败应保留既有文件并清理本次临时目录。不要手工删掉旧文件来“修复”导出失败。

成功后确认退出码为 0、返回的文件存在，再按请求核查页数、文字或外观。报告绝对路径和实际检查过的结果。原生打印保留阅读器已有文字层，扫描图片没有可复制文字，本项目不自动 OCR；结果是阅读器导出的 PDF，不保证与上传原文件字节相同。非空文件、字体资源或内容流都不足以证明每页完整，要求视觉验收时需逐页检查。

stdout 成功时只有最终路径；渲染进度和错误在 stderr。退出码 0/1/2 分别表示成功、运行失败、参数错误。不要把截图、复制日志或技能校验代替真实下载验收。

## 排障

出现内核缺失、乱码、登录未生效、空白/裁切/不可复制 PDF 或 Windows 打印问题时，按 [references/troubleshooting.md](references/troubleshooting.md) 选择与证据匹配的分支。只记录脱敏后的错误阶段、系统与版本、模式、页数和检查结果；不读取或上传 profile 数据库、浏览记录、令牌或文档内容。

修复环境属于安装/排障请求的范围；修改程序、扩大来源范围、提交代码或发布版本仍按用户本次授权判断。提出优化建议不等于自动实现全部建议。
