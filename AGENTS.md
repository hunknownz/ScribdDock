# ScribdDock 开发约定

先读 README.md 和 docs/SOURCE_CONTRACT.md。产品范围仅限 Scribd、SlideShare、Everand、Fable；当前只实现 Scribd，其他来源如实标记待适配。

## 架构

使用严格 TypeScript、Node.js、pnpm 和 ES Modules。domain、ports、service、errors 仅导入自有契约或标准库。浏览器 SDK、网页阅读器、PDF 处理留在 adapters，composition 负责装配。Camoufox 是默认浏览器，不自动替换浏览器或来源。

## 验证

运行 pnpm typecheck、pnpm check、pnpm test、pnpm build 和 git diff --check。来源契约变化必须验证正常输入、无效输入、明确拒绝和参数传递。模拟测试、真实联网运行及视觉审核分别报告。真实测试默认跳过。

## 数据

不提交密码、Cookie、profile、环境变量文件或下载内容。不覆盖失败下载的既有输出。不得绕过登录、订阅、验证码或 DRM，不以预览或非空内容流证明完整性。新来源未通过真实授权样例验证前，canDownload 不得设为 true。

## 风格与范围

两空格缩进，camelCase，UTF-8，LF，Biome 检查和格式化。提交使用 Conventional Commit。没有用户明确要求时，不扩大产品范围、不增加定时任务、不调用付费模型。
