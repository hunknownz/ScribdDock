# ScribdDock

将 Scribd 文档下载为 PDF，支持登录和游客模式，保留文档已有的文字层。

目前支持 Scribd 文档及嵌入链接，适用于 macOS 和 Windows x64。

## 安装

用 AI Agent 安装：

> 帮我安装 https://github.com/hunknownz/ScribdDock

安装时一并安装仓库附带的 [`scribddock` skill](skills/scribddock/SKILL.md)，用于登录、下载和排障。

手动安装需先准备 Node.js 24 和 Git：

```bash
git clone https://github.com/hunknownz/ScribdDock.git
cd ScribdDock
npm install -g pnpm@11.19.0
pnpm install --frozen-lockfile
pnpm browser:install
```

skill 的手动安装方法见[使用说明](docs/USAGE.md#ai-agent-skill)。

## 使用

通过 skill 下载，直接对 Codex 说：

> 用 $scribddock 下载 https://www.scribd.com/document/990798737/AAGnet，保存到 Downloads 目录。

需要登录时，按 Agent 提示在浏览器中完成登录，再告诉它“已登录”。

也可以使用命令行。

先登录：

```bash
pnpm dev login
```

在弹出的浏览器中完成登录，再回终端按 Enter。登录会话会保存在本机。

下载文档：

```bash
pnpm dev download "https://www.scribd.com/document/990798737/AAGnet" -o document.pdf
```

公开且可完整访问的文档可加 `--guest`，无需登录。省略 `-o` 会自动命名文件；更多命令见 `pnpm dev --help`。

PDF 可选择、复制和搜索原有文字；扫描图片不会自动转成文字。仅下载自己有权访问和导出的内容。

## 更多说明

[使用与排障](docs/USAGE.md) · [Windows 指南](docs/WINDOWS.md) · [AI Agent skill](skills/scribddock/SKILL.md)
