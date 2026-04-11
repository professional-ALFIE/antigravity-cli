/**
 * fakeExtensionServer.ts — Integration 테스트
 *
 * 원본: scripts/headless-backend/fake_extension_server.test.ts에서 이관.
 * 실제 HTTP 서버를 띄워서 USS 구독, keepalive, shell support 응답을 검증.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";

import { FakeExtensionServer } from "./fakeExtensionServer.js";
import { TOPIC_STORAGE_KEYS, StateDbReader } from "./stateVscdb.js";

async function createStateDb(
  dbPath: string,
  rows: Array<{ key: string; value: string }>,
): Promise<void> {
  const module = await import("sql.js");
  const initSqlJs = (module.default ?? module) as (
    options?: object,
  ) => Promise<{
    Database: new () => {
      run(sql: string, params?: unknown[]): void;
      export(): Uint8Array;
      close(): void;
    };
  }>;

  const sql = await initSqlJs({});
  const db = new sql.Database();
  db.run("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)");
  for (const row of rows) {
    db.run("INSERT INTO ItemTable (key, value) VALUES (?, ?)", [row.key, row.value]);
  }
  writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
}

function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining >>= 7;
    if (remaining > 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0);
  return Buffer.from(bytes);
}

function buildSubscribeBody(topicName: string): Buffer {
  const topicBytes = Buffer.from(topicName, "utf8");
  const message = Buffer.concat([
    Buffer.from([0x0a]),
    encodeVarint(topicBytes.length),
    topicBytes,
  ]);
  const header = Buffer.alloc(5);
  header.writeUInt8(0, 0);
  header.writeUInt32BE(message.length, 1);
  return Buffer.concat([header, message]);
}

function postForFirstChunk(
  port: number,
  urlPath: string,
  body: Buffer,
  contentType = "application/proto",
): Promise<{ response: http.IncomingMessage; chunk: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: urlPath,
        method: "POST",
        headers: { "Content-Type": contentType, "Content-Length": body.length },
      },
      (res) => {
        res.once("data", (chunk) => {
          resolve({ response: res, chunk: Buffer.from(chunk) });
          res.destroy();
        });
      },
    );
    req.once("error", reject);
    req.write(body);
    req.end();
  });
}

function frameConnectMessage(body: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header.writeUInt8(0, 0);
  header.writeUInt32BE(body.length, 1);
  return Buffer.concat([header, body]);
}

function encodeTag(fieldNumber: number, wireType: number): Buffer {
  return encodeVarint((fieldNumber << 3) | wireType);
}

function encodeLengthDelimitedField(fieldNumber: number, value: Buffer): Buffer {
  return Buffer.concat([encodeTag(fieldNumber, 2), encodeVarint(value.length), value]);
}

function encodeStringField(fieldNumber: number, value: string): Buffer {
  return encodeLengthDelimitedField(fieldNumber, Buffer.from(value, "utf8"));
}

function encodeVarintField(fieldNumber: number, value: number): Buffer {
  return Buffer.concat([encodeTag(fieldNumber, 0), encodeVarint(value)]);
}

function buildPushUpdateRequestBody(options: {
  topicName: string;
  key: string;
  rowValue: string;
  eTag?: number;
}): Buffer {
  const row = Buffer.concat([
    encodeStringField(1, options.rowValue),
    encodeVarintField(2, options.eTag ?? 1),
  ]);
  const appliedUpdate = Buffer.concat([
    encodeStringField(1, options.key),
    encodeLengthDelimitedField(2, row),
  ]);
  return Buffer.concat([
    encodeStringField(1, options.topicName),
    encodeLengthDelimitedField(5, appliedUpdate),
  ]);
}

describe("FakeExtensionServer", () => {
  test("unary keepalive endpoints (LanguageServerStarted) → 200 + application/proto", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-fake-extsrv-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      await createStateDb(dbPath, []);
      const server = new FakeExtensionServer({ stateDbPath: dbPath });
      await server.start();

      const req = http.request({
        host: "127.0.0.1",
        port: server.port,
        path: "/exa.extension_server_pb.ExtensionSidecarService/LanguageServerStarted",
        method: "POST",
        headers: { "Content-Length": 0 },
      });
      req.end();

      const [res] = (await once(req, "response")) as [http.IncomingMessage];
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("application/proto");
      await server.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("USS 구독 → exact topic bytes를 Connect envelope로 스트리밍", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-fake-extsrv-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      await createStateDb(dbPath, [
        {
          key: TOPIC_STORAGE_KEYS["uss-oauth"],
          value: Buffer.from("010203", "hex").toString("base64"),
        },
      ]);

      const server = new FakeExtensionServer({ stateDbPath: dbPath });
      await server.start();

      const { response, chunk } = await postForFirstChunk(
        server.port,
        "/exa.extension_server_pb.ExtensionSidecarService/SubscribeToUnifiedStateSyncTopic",
        buildSubscribeBody("uss-oauth"),
      );

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe("application/connect+proto");
      expect(chunk).toEqual(Buffer.from("00000000050a03010203", "hex"));
      expect(server.requests[0]?.topicName).toBe("uss-oauth");

      await server.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("auxiliary topic + CheckTerminalShellSupport (proto + connect+proto)", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-fake-extsrv-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      await createStateDb(dbPath, [
        {
          key: TOPIC_STORAGE_KEYS["uss-browserPreferences"],
          value: Buffer.from("beef", "hex").toString("base64"),
        },
      ]);

      const server = new FakeExtensionServer({ stateDbPath: dbPath });
      await server.start();

      // auxiliary topic 구독
      const topicResult = await postForFirstChunk(
        server.port,
        "/exa.extension_server_pb.ExtensionSidecarService/SubscribeToUnifiedStateSyncTopic",
        buildSubscribeBody("uss-browserPreferences"),
      );
      expect(topicResult.chunk).toEqual(Buffer.from("00000000040a02beef", "hex"));
      expect(server.requests[0]?.topicName).toBe("uss-browserPreferences");

      // CheckTerminalShellSupport — plain proto
      const shellReq = http.request({
        host: "127.0.0.1",
        port: server.port,
        path: "/exa.extension_server_pb.ExtensionSidecarService/CheckTerminalShellSupport",
        method: "POST",
        headers: { "Content-Length": 0 },
      });
      shellReq.end();

      const [shellRes] = (await once(shellReq, "response")) as [http.IncomingMessage];
      const shellChunks: Buffer[] = [];
      shellRes.on("data", (c) => shellChunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      await once(shellRes, "end");

      expect(shellRes.statusCode).toBe(200);
      expect(Buffer.concat(shellChunks)).toEqual(
        Buffer.from("080112037a73681a082f62696e2f7a7368", "hex"),
      );

      // CheckTerminalShellSupport — connect+proto
      const connectShellResult = await postForFirstChunk(
        server.port,
        "/exa.extension_server_pb.ExtensionServerService/CheckTerminalShellSupport",
        frameConnectMessage(Buffer.alloc(0)),
        "application/connect+proto",
      );
      expect(connectShellResult.response.statusCode).toBe(200);
      expect(connectShellResult.response.headers["content-type"]).toBe(
        "application/connect+proto",
      );
      expect(connectShellResult.chunk).toEqual(
        Buffer.from("0000000011080112037a73681a082f62696e2f7a7368", "hex"),
      );

      await server.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("PushUnifiedStateSyncUpdate를 trajectorySummaries storage에 반영", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-fake-extsrv-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      await createStateDb(dbPath, []);

      const server = new FakeExtensionServer({ stateDbPath: dbPath });
      await server.start();

      const pushBody = buildPushUpdateRequestBody({
        topicName: "trajectorySummaries",
        key: "cascade-xyz",
        rowValue: Buffer.from("summary-payload", "utf8").toString("base64"),
        eTag: 11,
      });

      const req = http.request({
        host: "127.0.0.1",
        port: server.port,
        path: "/exa.extension_server_pb.ExtensionServerService/PushUnifiedStateSyncUpdate",
        method: "POST",
        headers: {
          "Content-Type": "application/proto",
          "Content-Length": pushBody.length,
        },
      });
      req.write(pushBody);
      req.end();

      const [res] = (await once(req, "response")) as [http.IncomingMessage];
      expect(res.statusCode).toBe(200);
      res.resume();
      await once(res, "end");

      const reader = new StateDbReader(dbPath);
      const raw = await reader.getBase64Value("antigravityUnifiedStateSync.trajectorySummaries");
      expect(raw).not.toBeNull();
      expect(Buffer.from(raw!, "base64").toString("utf8")).toContain("cascade-xyz");
      expect(server.requests.at(-1)?.unifiedStateTopicName).toBe("trajectorySummaries");

      await reader.close();
      await server.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("workspaceRootUri가 있으면 trajectorySummaries push와 sidebarWorkspaces를 함께 반영", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-fake-extsrv-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      const workspaceRootUri = "file:///Users/noseung-gyeong/.claude";
      await createStateDb(dbPath, []);

      const server = new FakeExtensionServer({
        stateDbPath: dbPath,
        workspaceRootUri,
      });
      await server.start();

      const pushBody = buildPushUpdateRequestBody({
        topicName: "trajectorySummaries",
        key: "cascade-xyz",
        rowValue: Buffer.from("summary-payload", "utf8").toString("base64"),
        eTag: 11,
      });

      const req = http.request({
        host: "127.0.0.1",
        port: server.port,
        path: "/exa.extension_server_pb.ExtensionServerService/PushUnifiedStateSyncUpdate",
        method: "POST",
        headers: {
          "Content-Type": "application/proto",
          "Content-Length": pushBody.length,
        },
      });
      req.write(pushBody);
      req.end();

      const [res] = (await once(req, "response")) as [http.IncomingMessage];
      expect(res.statusCode).toBe(200);
      res.resume();
      await once(res, "end");

      const reader = new StateDbReader(dbPath);
      const summaryRaw = await reader.getBase64Value(TOPIC_STORAGE_KEYS.trajectorySummaries);
      const sidebarRaw = await reader.getBase64Value(TOPIC_STORAGE_KEYS.sidebarWorkspaces);

      expect(summaryRaw).not.toBeNull();
      expect(sidebarRaw).not.toBeNull();
      expect(Buffer.from(summaryRaw!, "base64").toString("utf8")).toContain("cascade-xyz");
      expect(Buffer.from(sidebarRaw!, "base64").toString("utf8")).toContain(workspaceRootUri);

      await reader.close();
      await server.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
