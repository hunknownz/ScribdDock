#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Command, CommanderError, Option } from "commander";
import { createService } from "./composition.js";
import { type SourceId, sourceIds, sources } from "./domain.js";
import { errorMessage } from "./errors.js";
import { type DownloadService, normalizeUrl, resolveSource } from "./service.js";

export interface CliIO {
  readonly out: (message: string) => void;
  readonly err: (message: string) => void;
}

export async function runCli(
  args: string[],
  service: DownloadService = createService(),
  io: CliIO = {
    out: (message) => process.stdout.write(message),
    err: (message) => process.stderr.write(message),
  },
): Promise<number> {
  const program = new Command()
    .name("scribddock")
    .description("Scribd 家族内容下载器")
    .version("0.1.0")
    .exitOverride()
    .configureOutput({ writeOut: io.out, writeErr: io.err });
  program
    .command("sources")
    .description("显示来源和实际能力")
    .option("--json", "输出 JSON")
    .action((options: { json?: boolean }) => {
      if (options.json) io.out(`${JSON.stringify(sources, null, 2)}\n`);
      else
        for (const source of sources) io.out(`${source.name}\t${source.status}\t${source.note}\n`);
    });
  program
    .command("inspect")
    .description("识别链接来源；不联网、不检查内容权限")
    .argument("<url>")
    .action((input: string) => {
      const url = normalizeUrl(input);
      io.out(`${JSON.stringify({ url, source: resolveSource(url) }, null, 2)}\n`);
    });
  program
    .command("login")
    .description("打开浏览器，手动登录并保存本地会话")
    .addOption(
      new Option("--source <source>", "登录来源").choices([...sourceIds]).default("scribd"),
    )
    .action(async (options: { source: SourceId }) => {
      await service.login(options.source);
      io.out("浏览器会话已保存；下载时请省略 --guest。\n");
    });
  program
    .command("download")
    .description("下载获授权的文档并校验 PDF")
    .argument("<url>")
    .option("-o, --output <path>", "PDF 输出路径")
    .option("--guest", "使用临时会话，不读取已保存登录")
    .action(async (url: string, options: { output?: string; guest?: boolean }) => {
      const request = {
        url,
        guest: options.guest ?? false,
        ...(options.output ? { output: options.output } : {}),
      };
      const output = await service.download(request, (loaded, total) =>
        io.err(`已加载 ${loaded}/${total} 页\n`),
      );
      io.out(`已保存：${output}\n`);
    });
  try {
    await program.parseAsync(args, { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode;
    io.err(`error: ${errorMessage(error)}\n`);
    return 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(realpathSync(resolve(invokedPath))).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
