import { once } from "node:events";
import { createServer, type Server, type Socket } from "node:net";
import { afterEach, expect, it } from "vitest";
import { MarionetteClient, reserveMarionettePort } from "../src/adapters/marionette.js";

const servers: Server[] = [];
const sockets: Socket[] = [];
const clients: MarionetteClient[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

function frame(value: unknown): Buffer {
  const bytes = Buffer.from(JSON.stringify(value));
  return Buffer.concat([Buffer.from(`${bytes.length}:`), bytes]);
}

async function peer(handler: (socket: Socket) => void): Promise<number> {
  const server = createServer((socket) => {
    sockets.push(socket);
    handler(socket);
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  return address.port;
}

const hello = { applicationType: "gecko", marionetteProtocol: 3 };

it("uses UTF-8 byte lengths and accepts fragmented responses", async () => {
  const port = await peer((socket) => {
    const greeting = frame(hello);
    socket.write(greeting.subarray(0, 2));
    setTimeout(() => socket.write(greeting.subarray(2)), 5);
    socket.once("data", (request) => {
      const colon = request.indexOf(58);
      expect(Number(request.subarray(0, colon).toString())).toBe(request.length - colon - 1);
      expect(JSON.parse(request.subarray(colon + 1).toString())).toEqual([
        0,
        1,
        "Test",
        { title: "中文" },
      ]);
      const reply = frame([1, 1, null, { value: "中文结果" }]);
      socket.write(reply.subarray(0, reply.length - 2));
      setTimeout(() => socket.write(reply.subarray(reply.length - 2)), 5);
    });
  });
  const client = await MarionetteClient.connect(port);
  clients.push(client);
  await expect(client.command("Test", { title: "中文" })).resolves.toEqual({ value: "中文结果" });
});

it("propagates native rejection without accepting a PDF", async () => {
  const port = await peer((socket) => {
    socket.write(frame(hello));
    socket.once("data", () => socket.write(frame([1, 1, { message: "native failure" }, null])));
  });
  const client = await MarionetteClient.connect(port);
  clients.push(client);
  await expect(client.command("WebDriver:Print")).rejects.toThrow("native failure");
});

it("rejects a mismatched response ID", async () => {
  const port = await peer((socket) => {
    socket.write(frame(hello));
    socket.once("data", () => socket.write(frame([1, 99, null, "wrong page"])));
  });
  const client = await MarionetteClient.connect(port);
  clients.push(client);
  await expect(client.command("Test")).rejects.toThrow("mismatched");
});

it("bounds a command that never receives a response", async () => {
  const port = await peer((socket) => socket.write(frame(hello)));
  const client = await MarionetteClient.connect(port);
  clients.push(client);
  await expect(client.command("Test", {}, 20)).rejects.toThrow("timed out");
});

it("rejects disconnect during a command", async () => {
  const port = await peer((socket) => {
    socket.write(frame(hello));
    socket.once("data", () => socket.destroy());
  });
  const client = await MarionetteClient.connect(port);
  clients.push(client);
  await expect(client.command("Test")).rejects.toThrow("disconnected");
});

it.each(["bad:", "134217729:"])("rejects malformed or excessive frame %s", async (value) => {
  const port = await peer((socket) => socket.write(value));
  await expect(MarionetteClient.connect(port)).rejects.toThrow("frame");
});

it("rejects incompatible handshake", async () => {
  const port = await peer((socket) => socket.write(frame({ ...hello, marionetteProtocol: 2 })));
  await expect(MarionetteClient.connect(port)).rejects.toThrow("unsupported");
});

it("reserves a loopback port that a browser can subsequently bind", async () => {
  const port = await reserveMarionettePort();
  const server = createServer();
  servers.push(server);
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
});
