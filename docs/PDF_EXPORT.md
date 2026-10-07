# PDF 导出与验证

## 当前实现

Camoufox 加载完整阅读器页面和专用字体，经 Firefox 原生打印保留网页文本、嵌入字体和绘制内容。浏览器关闭成功后处理并校验临时 PDF，最后替换用户指定的输出文件。任何阶段失败都保留已有输出，不自动切换到截图。

源页面只有扫描图片时，导出的 PDF 同样没有文本层；不进行 OCR。阅读器重建的 PDF 与上传原文件不保证相同，文字的断行、复制顺序和间距取决于阅读器本身。

## Windows 原生 PDF 后端

Windows runner 实测发现 `window.print()` 配合原项目的偏好设置没有生成 PDF。Firefox 的静默打印流程没有像打印面板一样明确设置 PDF 输出格式，Windows 后端因此不能把虚拟打印机名称当作原生 PDF 后端。依据 [Firefox Windows 后端](https://github.com/mozilla/gecko-dev/blob/master/widget/windows/nsDeviceContextSpecWin.cpp) 和 [PDF 打印实现](https://github.com/mozilla/gecko-dev/blob/master/remote/shared/PDF.sys.mjs)，Windows 改用同一 Camoufox 内的 WebDriver 原生 PDF 打印。

浏览器由官方 TS SDK 启动和控制；Marionette 仅作为 Windows 的本机打印连接。按唯一 DOM 标记找到目标标签页，显式传入阅读器纸张尺寸、零边距、背景和缩放设置，保存返回的 PDF 后继续原有校验。连接、命令、PDF 响应大小都有上限；失败不回退。平台验证结果见 [Windows 指南](WINDOWS.md)。

## macOS 裁切问题

2026-10-08 的真实样例中，Quartz 已生成文本和图片，但 PDF 的 MediaBox 仍为 Letter，而内容按 CSS 纸张尺寸绘制在不同区域。PDF 查看器据此裁掉正文，严重时整页呈空白。此现象不能证明原生打印没有生成文本。

修复只识别 Quartz 页面内容流开头的裁剪矩形。Firefox 也可能把整页等比缩放；要求其纵横比与阅读器布局相符、比例位于 0.5–2 且所有页面一致，再把内容平移到原点并恢复到预期纸张尺寸，同步 MediaBox、CropBox 和超链接注释坐标。保留文本、字体、矢量及链接目标。无法识别边界、非等比缩放或跨页比例不一致时明确失败，不用任意扩大页框隐藏问题。

## 验证证据

- 普通测试覆盖 Quartz 页框修复后保留文本操作与字体资源、无法识别或尺寸不匹配时拒绝写回、普通打印纸张尺寸，以及不完整文件的有界超时。
- 等比缩放正例覆盖 100%、98%、89.82% 及链接 Rect/QuadPoints；反例拒绝非等比和跨页不一致。真实失败原始输出另外用于复验。
- 本地 Camoufox 测试使用合成页面，验证主世界脚本调用和导出布局。
- macOS 实际运行完整 CLI，使用公开的 [AAGnet 样例](https://www.scribd.com/document/990798737/AAGnet)，导出全部 20 页；通过独立的 pypdf 提取每页文字并核对字体资源。
- 使用 Poppler 渲染全部页并查看逐页缩略图，放大检查首页、图表页和末页，核对页首、正文、图表和页码没有裁切。
- 5 页和 20 页样例分别用参考 Python CLI 与 TS CLI 导出，并独立对比每页提取文字；另在真人登录后验证保存会话下载。详细结果与差异见 [对齐审计](PARITY_AUDIT.md)。

上述真实验证针对这个 macOS 样例，不替代其他文档、登录权限或其他操作系统的验证。默认 CI 不联网下载，也不安装浏览器；真实测试需明确执行。
