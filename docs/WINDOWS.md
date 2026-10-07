# Windows 安装与验证

支持目标为 Windows x64，推荐 Windows 11、Node.js 24 LTS x64 和 PowerShell。当前锁定的 Camoufox SDK 提供 Windows x64 内核；本项目没有验证 Windows ARM64 或 32 位系统。

## 安装和使用

先安装 [Node.js 24 LTS x64](https://nodejs.org/en/download) 和 [Git for Windows](https://git-scm.com/download/win)，重新打开终端。下面的命令使用 HTTPS 克隆，不需要配置 SSH 密钥。

```powershell
git clone https://github.com/hunknownz/ScribdDock.git
cd ScribdDock
npm install -g pnpm@11.19.0
pnpm install --frozen-lockfile
pnpm browser:install
pnpm dev login
```

在 Camoufox 中手动登录，回终端按 Enter 保存会话。随后下载自己有权导出的内容：

```powershell
pnpm dev download "https://www.scribd.com/document/990798737/AAGnet" -o "D:\Documents\AAGnet.pdf"
```

输出目录需要已经存在；路径含空格时加引号。公开可完整访问的文档可以加 `--guest`，该模式不读取保存的登录会话。命令、权限边界与 macOS 相同。

如果 PowerShell 提示禁止运行 `npm.ps1` 或 `pnpm.ps1`，可以使用 `npm.cmd`、`pnpm.cmd` 执行相同命令，不需要修改系统执行策略。

## Profile 和浏览器缓存

| 数据 | Windows 默认目录 |
| --- | --- |
| Scribd 登录 profile | `%USERPROFILE%\.scribddock\profiles\scribd` |
| Camoufox 内核缓存 | `%LOCALAPPDATA%\camoufox\camoufox\Cache` |

两者独立。重新安装内核不会清除登录；清理 profile 也不需要重新下载内核。macOS 的 profile 为 `~/.scribddock/profiles/scribd`，内核缓存为 `~/Library/Caches/camoufox`。

在当前 PowerShell 会话中可以覆盖 profile 目录：

```powershell
$env:SCRIBDDOCK_PROFILE_DIR = "D:\ScribdDock Data\profile"
pnpm dev login
```

后续下载要使用同一个环境变量。路径支持 `~/` 和 `~\` 展开为当前用户主目录。不要把 profile 放进仓库或共享目录；Windows 使用目录继承的 NTFS 权限，POSIX 系统才设置 `0700`。

重置登录时，先关闭使用这个 profile 的 Camoufox，再把目录改名作为备份，然后重新执行 `login`。旧 Python 项目的默认目录是 `~/.scribd-downloader/profile`，ScribdDock 不自动迁移其中的登录数据。

## 文件和打印行为

自动文件名会避开 Windows 的 `CON`、`NUL`、`COM1` 等保留名称，包括带扩展名和微软列出的上标数字形式。显式指定保留文件名时，Windows 会在启动浏览器前拒绝。规则参考 [Microsoft 文件命名说明](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file)。

PDF 仍由 Camoufox / Firefox 原生打印生成，经过页数、纸张尺寸和内容流校验后才替换输出。如果目标 PDF 被阅读器独占锁定，先关闭阅读器再重试；替换失败会保留旧文件并清理临时文件，不退回截图导出。

Windows 使用同一个 Camoufox 的 WebDriver 原生打印接口，明确选择 PDF 输出格式和页面尺寸。Marionette 只监听本机 loopback；不需要额外安装 PDF 打印机，不通过网络服务生成 PDF。该后端的整数点页框会校正到阅读器尺寸，同时保持正文与链接坐标对齐。macOS 保持原有 `window.print()` 流程。后端在启动时按平台确定，失败不切换后端。

## 验证范围

默认 CI 在 Linux 和 Windows 上运行类型检查、格式检查、离线测试及构建，不登录网站。独立的 `Windows smoke` 工作流按需安装真实 Camoufox，检查主世界脚本、打印布局、不同纸张尺寸、字体资源，以及含中文和空格的 profile 目录能否在重启后恢复合成会话；选择公开样例下载时还检查五页文档及每页文字绘制指令。

本地六项合成浏览器测试已在 macOS 通过，包含原生 WebDriver 打印。Windows runner 已通过启动、DOM 布局、合成 profile 重启恢复和原生 PDF 字体检查，正在验证整数点页框校正及真实公开样例。Windows 人工账号登录和逐页视觉效果尚未验收。文字绘制指令检查不能代替实际文字提取、复制和完整视觉审核。

公开样例的按需验收还会运行编译后的 CLI，用 CI 专用 pypdf 6.10.0 独立提取每页文字，并与 Python 参考的五页文字 SHA-256 对照（NFKC 规范化、去除空白）。该 Python 工具仅用于独立验收；应用安装、登录、下载不依赖 Python。CI 清理临时 PDF，不上传文档或 profile。

```powershell
pnpm test:browser
pnpm test:live
```

上述测试入口不依赖 Unix 的环境变量赋值语法，可以在 PowerShell 和 cmd 中执行。真实测试只使用有权访问的内容，不提交 Cookie、profile 或 PDF。
