# 来源适配契约 v0

产品目录仅包含 Scribd、SlideShare、Everand、Fable。只有 Scribd 绑定可用下载适配器；其余来源的登录和下载能力为 false。

## 核心应用层

`SourceSpec` 描述来源 ID、域名、状态、能力和说明。`DownloadRequest` 包含规范化 URL、可选输出路径和 guest 标志。`SourceAdapter` 提供异步 login 和 download，后者接收只包含页数的进度回调，返回文件路径。

`DownloadService` 检查 URL、来源与能力，然后调用明确绑定的适配器。domain、ports、service、errors 不依赖浏览器或 PDF SDK；依赖边界由测试检查。composition.ts 装配具体实现。

## 浏览器集成

集成层的 `BrowserProvider` 接收 headless 和可选 profile，返回 `BrowserSession`，来源适配器负责关闭会话。Playwright 对象不进入核心应用层。

默认 `CamoufoxProvider` 通过官方 camoufox TypeScript SDK 启动 Camoufox，使用与宿主一致的 OS、en-US locale 和主世界脚本执行。登录有界面并保存 profile，下载无界面；不自动回退到其他浏览器。浏览器使用官方 SDK 的平台缓存，profile 默认为 ~/.scribddock/profiles/scribd。

Camoufox 官方 SDK 自身控制支持的内核版本范围。锁定 Node 依赖不等于锁定远端平台接口；不能擅自启动不受 SDK 支持的内核。

## 输入与失败

只接受完整 HTTP/HTTPS URL 或完整 Markdown 链接。域名精确匹配，不接受相似域名、URL 内账号密码和非标准端口。未实现的来源在启动浏览器前失败，不跨来源兜底。

每次下载在目标目录内创建唯一临时目录。通过 PDF 校验后才使用 rename 替换目标；失败保留已有输出并删除本次临时文件。资源失败、页面不全、布局异常和 PDF 内容流缺失必须有明确错误。

## 内容边界

Scribd 输出为阅读器 DOM 经 Firefox 打印重建的 PDF，非上传原文件的字节副本。检查页数、尺寸、资源、加载、布局和内容流不证明每一页视觉完整。

截图页面同时考虑可见边框和实际滚动内容尺寸，容纳阅读器已有的右侧或底部溢出。重新布局后仍检查页面边框、宽高及内容溢出，不通过扩大超时或跳过校验掩盖裁切。

阅读器的字体清单通过 FontFace 加载并注册；只接受 HTTPS 的 scribdassets.com 及其子域资源，45 秒内未加载完则明确失败。空字体清单允许纯图片文档通过。

浏览器能看见内容、可以完整阅读、允许下载/导出是不同能力。遵守平台授权，不绕过登录、订阅、验证码或 DRM，不把预览当作完整文档。Everand、Fable 在确认允许导出的内容及真实样例之前保持待调研。

导出使用 Camoufox 的页面元素截图；每张 PNG 对应一页 PDF，CSS 像素按 0.75 转为 PDF 点。输出不包含可选择的文本层。暂不使用 Firefox 原生打印，以避免当前阅读器的页首裁切。
