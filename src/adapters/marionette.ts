import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { createConnection, createServer, type Socket } from "node:net";
import type { Page } from "playwright-core";
import { DownloaderError } from "../errors.js";
import { evaluateMainWorld } from "./scribd/evaluate.js";

const maxFrameBytes = 128 * 1024 * 1024;

export async function reserveMarionettePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!address || typeof address === "string") throw new DownloaderError("print: no local port");
  return address.port;
}

export class MarionetteClient {
  private buffer: Buffer = Buffer.alloc(0);
  private sequence = 0;
  private pending:
    | { id: number; resolve(value: unknown): void; reject(error: Error): void }
    | undefined;
  private hello: { resolve(value: unknown): void; reject(error: Error): void } | undefined;
  private readonly ready: Promise<unknown>;

  private constructor(private readonly socket: Socket) {
    this.ready = new Promise((resolve, reject) => {
      this.hello = { resolve, reject };
    });
    socket.on("data", (chunk: Buffer) => {
      try {
        this.receive(chunk);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.on("error", (error) => this.fail(error));
    socket.on("close", () => this.fail(new DownloaderError("print: Marionette disconnected")));
  }

  static async connect(port: number): Promise<MarionetteClient> {
    const client = new MarionetteClient(createConnection({ host: "127.0.0.1", port }));
    const timer = setTimeout(
      () => client.fail(new DownloaderError("print: Marionette handshake timed out")),
      10_000,
    );
    try {
      const hello = (await client.ready) as {
        applicationType?: string;
        marionetteProtocol?: number;
      };
      if (hello?.applicationType !== "gecko" || hello.marionetteProtocol !== 3)
        throw new DownloaderError("print: unsupported Marionette protocol");
      return client;
    } catch (error) {
      client.close();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private fail(error: Error): void {
    this.hello?.reject(error);
    this.hello = undefined;
    this.pending?.reject(error);
    this.pending = undefined;
    this.socket.destroy();
  }

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length) {
      const colon = this.buffer.indexOf(58);
      if (colon < 0) {
        if (this.buffer.length > 10) throw new DownloaderError("print: invalid Marionette frame");
        return;
      }
      const prefix = this.buffer.subarray(0, colon).toString("ascii");
      const size = Number(prefix);
      if (!/^\d+$/.test(prefix) || size < 1 || size > maxFrameBytes)
        throw new DownloaderError("print: invalid Marionette frame size");
      if (this.buffer.length < colon + 1 + size) return;
      const value: unknown = JSON.parse(
        this.buffer.subarray(colon + 1, colon + 1 + size).toString("utf8"),
      );
      this.buffer = this.buffer.subarray(colon + 1 + size);
      if (this.hello) {
        this.hello.resolve(value);
        this.hello = undefined;
        continue;
      }
      if (
        !Array.isArray(value) ||
        value.length !== 4 ||
        value[0] !== 1 ||
        value[1] !== this.pending?.id
      )
        throw new DownloaderError("print: mismatched Marionette response");
      const pending = this.pending;
      this.pending = undefined;
      if (value[2])
        pending?.reject(
          new DownloaderError(`print: ${String(value[2].message ?? "native printing failed")}`),
        );
      else pending?.resolve(value[3]);
    }
  }

  async command(
    name: string,
    parameters: Record<string, unknown> = {},
    timeoutMs = 30_000,
  ): Promise<unknown> {
    if (this.pending || this.socket.destroyed)
      throw new DownloaderError("print: Marionette unavailable");
    const id = ++this.sequence;
    const response = new Promise<unknown>((resolve, reject) => {
      this.pending = { id, resolve, reject };
    });
    const timer = setTimeout(
      () => this.fail(new DownloaderError(`print: ${name} timed out`)),
      timeoutMs,
    );
    const body = Buffer.from(JSON.stringify([0, id, name, parameters]));
    this.socket.write(Buffer.concat([Buffer.from(`${body.length}:`), body]));
    try {
      return await response;
    } finally {
      clearTimeout(timer);
    }
  }

  close(): void {
    this.fail(new DownloaderError("print: Marionette closed"));
  }
}

function resultValue(result: unknown): unknown {
  return result && typeof result === "object" && "value" in result ? result.value : result;
}

export async function printMarionettePdf(
  port: number,
  path: string,
  page: Page,
  layout: { width: number; height: number },
): Promise<void> {
  const token = randomUUID();
  await evaluateMainWorld(
    page,
    "mw:(token) => document.documentElement.setAttribute('data-scribddock-print', token)",
    token,
  );
  let client: MarionetteClient | undefined;
  let started = false;
  try {
    client = await MarionetteClient.connect(port);
    await client.command("WebDriver:NewSession", { capabilities: { alwaysMatch: {} } });
    started = true;
    const handles = resultValue(await client.command("WebDriver:GetWindowHandles"));
    if (!Array.isArray(handles)) throw new DownloaderError("print: invalid native window list");
    let matched = false;
    for (const handle of handles) {
      await client.command("WebDriver:SwitchToWindow", { handle });
      const marker = resultValue(
        await client.command("WebDriver:ExecuteScript", {
          script: "return document.documentElement.getAttribute('data-scribddock-print');",
          args: [],
          newSandbox: true,
          sandbox: "default",
        }),
      );
      if (marker === token) {
        matched = true;
        break;
      }
    }
    if (!matched) throw new DownloaderError("print: native target page was not found");
    // WebDriver paper dimensions use cm. The Firefox command explicitly selects
    // its PDF output backend; window.print() on Windows leaves the native format.
    const result = resultValue(
      await client.command(
        "WebDriver:Print",
        {
          background: true,
          orientation: "portrait",
          scale: 1,
          page: { width: (layout.width * 2.54) / 96, height: (layout.height * 2.54) / 96 },
          margin: { top: 0, bottom: 0, left: 0, right: 0 },
          shrinkToFit: true,
        },
        90_000,
      ),
    );
    if (
      typeof result !== "string" ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(result) ||
      result.length % 4 !== 0
    )
      throw new DownloaderError("print: native PDF response is invalid");
    const bytes = Buffer.from(result, "base64");
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-")
      throw new DownloaderError("print: native response is not a PDF");
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  } finally {
    if (started && client)
      await client.command("WebDriver:DeleteSession", {}, 5_000).catch(() => {});
    client?.close();
    await evaluateMainWorld(
      page,
      "mw:() => document.documentElement.removeAttribute('data-scribddock-print')",
    ).catch(() => {});
  }
}
