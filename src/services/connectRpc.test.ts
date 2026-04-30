/**
 * connectRpc.ts — Integration 테스트
 *
 * 원본: scripts/headless-backend/connect_rpc.test.ts에서 이관.
 * stub HTTP 서버를 띄워 callConnectRpc, callConnectProtoRpc, startConnectProtoStream의
 * CSRF 헤더, content-type, raw capture, frame parsing을 실제 HTTP로 검증.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  buildSendUserCascadeMessageRequestProto,
  buildStartCascadeRequestProto,
  buildStartChatClientRequestStreamRequestProto,
  callConnectProtoRpc,
  callConnectRpc,
  decodeSendUserCascadeMessageResponseProto,
  decodeStartCascadeResponseProto,
  frameConnectMessage,
  parseConnectFrames,
  buildSignalExecutableIdleRequestProto,
  startConnectProtoStream,
  buildStreamAgentStateUpdatesRequestProto,
  buildCascadeTrajectorySummaryProto,
  resolveCascadeRunStatusNumber,
  isoToTimestampProto,
} from "./connectRpc.js";

// ---------------------------------------------------------------------------
// Stub HTTP server
// ---------------------------------------------------------------------------

function startStubServer(): Promise<{
  port: number;
  requests: Array<{
    path: string;
    headers: http.IncomingHttpHeaders;
    body: string;
  }>;
  close: () => Promise<void>;
}> {
  const requests: Array<{
    path: string;
    headers: http.IncomingHttpHeaders;
    body: string;
  }> = [];

  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      requests.push({
        path: req.url ?? "/",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, endpoint: req.url }));
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("failed");
      resolve({
        port: addr.port,
        requests,
        close: () =>
          new Promise((ok, fail) =>
            server.close((e) => (e ? fail(e) : ok())),
          ),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Protobuf test helpers
// ---------------------------------------------------------------------------

function encodeVarint(value: number | bigint): Buffer {
  let remaining = typeof value === "bigint" ? value : BigInt(value);
  const bytes: number[] = [];
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining > 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0n);
  return Buffer.from(bytes);
}

function encodeVarintField(fieldNumber: number, value: number | bigint): Buffer {
  return Buffer.concat([encodeVarint((fieldNumber << 3) | 0), encodeVarint(value)]);
}

function encodeStringField(fieldNumber: number, value: string): Buffer {
  const raw = Buffer.from(value, "utf8");
  return Buffer.concat([encodeVarint((fieldNumber << 3) | 2), encodeVarint(raw.length), raw]);
}

function readVarint(buffer: Buffer, offset: number): { value: bigint; next: number } {
  let value = 0n;
  let shift = 0n;
  let i = offset;
  while (i < buffer.length) {
    const byte = BigInt(buffer[i]);
    value |= (byte & 0x7fn) << shift;
    i += 1;
    if ((byte & 0x80n) === 0n) return { value, next: i };
    shift += 7n;
  }
  throw new Error("unterminated varint");
}

function decodeFields(
  buffer: Buffer,
): Map<number, Array<{ wireType: number; buffer?: Buffer; value?: bigint }>> {
  const out = new Map<number, Array<{ wireType: number; buffer?: Buffer; value?: bigint }>>();
  let offset = 0;
  while (offset < buffer.length) {
    const { value: tag, next } = readVarint(buffer, offset);
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 0x07n);
    offset = next;
    let decoded: { wireType: number; buffer?: Buffer; value?: bigint };
    if (wireType === 0) {
      const parsed = readVarint(buffer, offset);
      decoded = { wireType, value: parsed.value };
      offset = parsed.next;
    } else if (wireType === 2) {
      const { value: len, next: afterLen } = readVarint(buffer, offset);
      decoded = { wireType, buffer: buffer.subarray(afterLen, afterLen + Number(len)) };
      offset = afterLen + Number(len);
    } else {
      throw new Error(`Unsupported wire type: ${wireType}`);
    }
    const existing = out.get(fieldNumber) ?? [];
    existing.push(decoded);
    out.set(fieldNumber, existing);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tests: frame roundtrip (순수 로직)
// ---------------------------------------------------------------------------

describe("frameConnectMessage / parseConnectFrames roundtrip", () => {
  test("프레임 래핑 → 파싱하면 원본 복원", () => {
    const payload = Buffer.from("hello world");
    const framed = frameConnectMessage(payload);
    const { frames, rest } = parseConnectFrames(framed);
    expect(frames.length).toBe(1);
    expect(frames[0].flags).toBe(0);
    expect(frames[0].data).toEqual(payload);
    expect(rest.length).toBe(0);
  });

  test("다중 프레임 파싱", () => {
    const a = frameConnectMessage(Buffer.from("aaa"));
    const b = frameConnectMessage(Buffer.from("bbb"));
    const { frames } = parseConnectFrames(Buffer.concat([a, b]));
    expect(frames.length).toBe(2);
    expect(frames[0].data.toString()).toBe("aaa");
    expect(frames[1].data.toString()).toBe("bbb");
  });

  test("불완전 프레임은 rest로 반환", () => {
    const full = frameConnectMessage(Buffer.from("full"));
    const partial = Buffer.alloc(5);
    partial.writeUInt8(0, 0);
    partial.writeUInt32BE(999, 1);
    const { frames, rest } = parseConnectFrames(Buffer.concat([full, partial]));
    expect(frames.length).toBe(1);
    expect(rest.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Tests: protobuf builders (순수 로직)
// ---------------------------------------------------------------------------

describe("protobuf request builders", () => {
  test("buildStartCascadeRequestProto는 Buffer를 반환", () => {
    const result = buildStartCascadeRequestProto({
      workspaceUris: ["file:///Users/test/project"],
    });
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
  });

  test("buildSendUserCascadeMessageRequestProto — cascadeId/text + planner config 구조 검증", () => {
    const request = buildSendUserCascadeMessageRequestProto({
      cascadeId: "cascade-123",
      text: "Reply with exactly OK.",
      cascadeConfig: {
        planModel: 1018,
        requestedModel: { kind: "model", value: 1018 },
        agenticMode: true,
      },
    });

    const topFields = decodeFields(request);
    expect(topFields.get(1)?.[0]?.buffer?.toString("utf8")).toBe("cascade-123");
    expect(topFields.get(11)?.[0]?.value).toBe(1n);
    expect(topFields.get(16)?.[0]?.value).toBe(1n);
    expect(topFields.get(18)?.[0]?.value).toBe(2n);

    // userInput → text
    const itemFields = decodeFields(topFields.get(2)?.[0]?.buffer ?? Buffer.alloc(0));
    expect(itemFields.get(1)?.[0]?.buffer?.toString("utf8")).toBe("Reply with exactly OK.");

    // cascadeConfig → plannerConfig
    const ccFields = decodeFields(topFields.get(5)?.[0]?.buffer ?? Buffer.alloc(0));
    const pcFields = decodeFields(ccFields.get(1)?.[0]?.buffer ?? Buffer.alloc(0));
    expect(pcFields.get(1)?.[0]?.value).toBe(1018n);

    // conversationalPlannerConfig → agenticMode
    const convFields = decodeFields(pcFields.get(2)?.[0]?.buffer ?? Buffer.alloc(0));
    expect(convFields.get(14)?.[0]?.value).toBe(1n);

    // requestedModel
    const rmFields = decodeFields(pcFields.get(15)?.[0]?.buffer ?? Buffer.alloc(0));
    expect(rmFields.get(1)?.[0]?.value).toBe(1018n);
  });

  test("buildSignalExecutableIdleRequestProto는 conversationId 포함", () => {
    const result = buildSignalExecutableIdleRequestProto({ conversationId: "conv-123" });
    expect(result.toString("hex")).toContain(Buffer.from("conv-123").toString("hex"));
  });
});

// ---------------------------------------------------------------------------
// Tests: protobuf response decoders (순수 로직)
// ---------------------------------------------------------------------------

describe("protobuf response decoders", () => {
  test("decodeStartCascadeResponseProto — cascadeId 추출", () => {
    const encoded = Buffer.concat([
      Buffer.from([0x0a]),
      Buffer.from([10]),
      Buffer.from("my-cascade"),
    ]);
    expect(decodeStartCascadeResponseProto(encoded).cascadeId).toBe("my-cascade");
  });

  test("decodeSendUserCascadeMessageResponseProto — queued true/false", () => {
    expect(decodeSendUserCascadeMessageResponseProto(Buffer.from([0x08, 0x01])).queued).toBe(true);
    expect(decodeSendUserCascadeMessageResponseProto(Buffer.from([0x08, 0x00])).queued).toBe(false);
    expect(
      decodeSendUserCascadeMessageResponseProto(Buffer.concat([encodeVarintField(1, 1)])).queued,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: transport (HTTP stub 사용)
// ---------------------------------------------------------------------------

describe("callConnectRpc — JSON unary transport", () => {
  test("CSRF 헤더 전달 + raw capture 파일 생성", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-connect-rpc-"));
    const stub = await startStubServer();
    try {
      const result = await callConnectRpc({
        discovery: { httpsPort: 0, httpPort: stub.port, csrfToken: "csrf-token" },
        protocol: "http",
        method: "GetUserStatus",
        payload: { metadata: {} },
        outputDirPath: root,
      });

      expect(result.responseBody).toEqual({
        ok: true,
        endpoint: "/exa.language_server_pb.LanguageServerService/GetUserStatus",
      });
      expect(stub.requests[0]?.path).toBe(
        "/exa.language_server_pb.LanguageServerService/GetUserStatus",
      );
      expect(stub.requests[0]?.headers["x-codeium-csrf-token"]).toBe("csrf-token");
      expect(stub.requests[0]?.body).toBe('{"metadata":{}}');

      const reqCapture = readFileSync(path.join(root, "GetUserStatus.request.json"), "utf8");
      const resCapture = readFileSync(path.join(root, "GetUserStatus.response.json"), "utf8");
      expect(reqCapture).toContain('"method": "GetUserStatus"');
      expect(resCapture).toContain('"ok": true');
    } finally {
      await stub.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("callConnectProtoRpc — protobuf unary transport", () => {
  test("protobuf bytes post + responseDecoder 적용", async () => {
    const requests: Array<{
      path: string;
      headers: http.IncomingHttpHeaders;
      body: Buffer;
    }> = [];

    const server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      requests.push({ path: req.url ?? "/", headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(200, {
        "Content-Type": "application/proto",
        "Connect-Protocol-Version": "1",
      });
      res.end(encodeStringField(1, "cascade-from-stub"));
    });

    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("failed");

    try {
      const reqBody = buildStartCascadeRequestProto({
        workspaceUris: ["file:///Users/example/Dropbox"],
      });

      const result = await callConnectProtoRpc({
        discovery: { httpsPort: 0, httpPort: addr.port },
        protocol: "http",
        method: "StartCascade",
        requestBody: reqBody,
        responseDecoder: decodeStartCascadeResponseProto,
      });

      expect(result.responseBody).toEqual({ cascadeId: "cascade-from-stub" });
      expect(requests[0]?.path).toBe(
        "/exa.language_server_pb.LanguageServerService/StartCascade",
      );
      expect(requests[0]?.headers["content-type"]).toBe("application/proto");
      expect(requests[0]?.body).toEqual(reqBody);
    } finally {
      await new Promise<void>((ok, fail) => server.close((e) => (e ? fail(e) : ok())));
    }
  });
});

describe("startConnectProtoStream — server-stream transport", () => {
  test("request framing + 분할 응답 frame 파싱 + firstFrame/completed", async () => {
    const requests: Array<{
      path: string;
      headers: http.IncomingHttpHeaders;
      body: Buffer;
    }> = [];
    const frameOne = frameConnectMessage(Buffer.from("0a0361636b", "hex"));
    const frameTwo = frameConnectMessage(Buffer.from("0801", "hex"));

    const server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      requests.push({ path: req.url ?? "/", headers: req.headers, body: Buffer.concat(chunks) });

      res.writeHead(200, {
        "Content-Type": "application/connect+proto",
        "Connect-Protocol-Version": "1",
      });
      // 일부러 분할 전송
      res.write(frameOne.subarray(0, 3));
      res.write(frameOne.subarray(3));
      res.end(frameTwo);
    });

    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("failed");

    const handle = startConnectProtoStream({
      discovery: { httpsPort: 0, httpPort: addr.port },
      protocol: "http",
      method: "StartChatClientRequestStream",
      requestBody: buildStartChatClientRequestStreamRequestProto(),
    });

    try {
      const responseStarted = await handle.responseStarted;
      expect(responseStarted.statusCode).toBe(200);

      const firstFrame = await handle.firstFrame;
      expect(firstFrame.flags).toBe(0);
      expect(firstFrame.data).toEqual(Buffer.from("0a0361636b", "hex"));

      await handle.completed;

      expect(requests[0]?.path).toBe(
        "/exa.chat_client_server_pb.ChatClientServerService/StartChatClientRequestStream",
      );
      expect(requests[0]?.headers["content-type"]).toBe("application/connect+proto");
      expect(requests[0]?.body).toEqual(
        frameConnectMessage(buildStartChatClientRequestStreamRequestProto()),
      );
      expect(handle.frames.length).toBe(2);
      expect(handle.frames[1]?.data).toEqual(Buffer.from("0801", "hex"));
    } finally {
      handle.close();
      await new Promise<void>((ok, fail) => server.close((e) => (e ? fail(e) : ok())));
    }
  });
});

// ---------------------------------------------------------------------------
// bundleRuntime 제거용 builder 테스트
// ---------------------------------------------------------------------------

describe("buildStreamAgentStateUpdatesRequestProto", () => {
  test("conversationId + subscriberId만 있을 때 field 1, 2 인코딩", () => {
    const buf = buildStreamAgentStateUpdatesRequestProto({
      conversationId: "conv-abc",
      subscriberId: "sub-123",
    });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
    // field 1 (tag 0x0a = field 1, wire type 2) → "conv-abc"
    expect(buf.includes(Buffer.from("conv-abc"))).toBe(true);
    expect(buf.includes(Buffer.from("sub-123"))).toBe(true);
  });

  test("initialStepsPageBounds가 있으면 field 3에 nested Slice 인코딩", () => {
    const buf = buildStreamAgentStateUpdatesRequestProto({
      conversationId: "c",
      subscriberId: "s",
      initialStepsPageBounds: { startIndex: 5, endIndexExclusive: 10 },
    });
    expect(buf.length).toBeGreaterThan(
      buildStreamAgentStateUpdatesRequestProto({
        conversationId: "c",
        subscriberId: "s",
      }).length,
    );
    // field 3 tag = (3 << 3) | 2 = 0x1a
    expect(buf[buf.indexOf(0x1a)] ?? -1).toBe(0x1a);
  });

  test("initialStepsPageBounds.endIndexExclusive 생략 가능", () => {
    const buf = buildStreamAgentStateUpdatesRequestProto({
      conversationId: "c",
      subscriberId: "s",
      initialStepsPageBounds: { startIndex: 0 },
    });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });
});

describe("buildCascadeTrajectorySummaryProto", () => {
  test("최소 필드(summary, stepCount, trajectoryId, status)만으로 생성", () => {
    const buf = buildCascadeTrajectorySummaryProto({
      summary: "test summary",
      stepCount: 3,
      trajectoryId: "traj-001",
      status: 1,
    });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.includes(Buffer.from("test summary"))).toBe(true);
    expect(buf.includes(Buffer.from("traj-001"))).toBe(true);
  });

  test("lastModifiedTime, createdTime 포함 시 field 3, 7에 Timestamp 인코딩", () => {
    const minimal = buildCascadeTrajectorySummaryProto({
      summary: "s",
      stepCount: 1,
      trajectoryId: "t",
      status: 1,
    });
    const withTimestamps = buildCascadeTrajectorySummaryProto({
      summary: "s",
      stepCount: 1,
      trajectoryId: "t",
      status: 1,
      lastModifiedTime: { seconds: 1700000000n, nanos: 500_000_000 },
      createdTime: { seconds: 1699000000n },
    });
    expect(withTimestamps.length).toBeGreaterThan(minimal.length);
  });

  test("workspaces repeated field 9에 CortexWorkspaceMetadata 인코딩", () => {
    const buf = buildCascadeTrajectorySummaryProto({
      summary: "s",
      stepCount: 1,
      trajectoryId: "t",
      status: 1,
      workspaces: [
        { workspaceFolderAbsoluteUri: "file:///workspace" },
        { workspaceFolderAbsoluteUri: "file:///other", gitRootAbsoluteUri: "file:///git", branchName: "main" },
      ],
    });
    expect(buf.includes(Buffer.from("file:///workspace"))).toBe(true);
    expect(buf.includes(Buffer.from("file:///other"))).toBe(true);
    expect(buf.includes(Buffer.from("file:///git"))).toBe(true);
    expect(buf.includes(Buffer.from("main"))).toBe(true);
  });
});

describe("resolveCascadeRunStatusNumber", () => {
  test("숫자 입력은 그대로 반환", () => {
    expect(resolveCascadeRunStatusNumber(1)).toBe(1);
    expect(resolveCascadeRunStatusNumber(4)).toBe(4);
  });

  test("정식 문자열 → 올바른 number", () => {
    expect(resolveCascadeRunStatusNumber("CASCADE_RUN_STATUS_IDLE")).toBe(1);
    expect(resolveCascadeRunStatusNumber("CASCADE_RUN_STATUS_RUNNING")).toBe(2);
    expect(resolveCascadeRunStatusNumber("CASCADE_RUN_STATUS_CANCELING")).toBe(3);
    expect(resolveCascadeRunStatusNumber("CASCADE_RUN_STATUS_BUSY")).toBe(4);
  });

  test("축약 alias → 올바른 number", () => {
    expect(resolveCascadeRunStatusNumber("IDLE")).toBe(1);
    expect(resolveCascadeRunStatusNumber("RUNNING")).toBe(2);
    expect(resolveCascadeRunStatusNumber("CANCELING")).toBe(3);
    expect(resolveCascadeRunStatusNumber("BUSY")).toBe(4);
  });

  test("알 수 없는 문자열은 UNSPECIFIED(0)으로 fallback — 의도된 계약", () => {
    expect(resolveCascadeRunStatusNumber("UNKNOWN_STATUS")).toBe(0);
    expect(resolveCascadeRunStatusNumber("")).toBe(0);
  });
});

describe("isoToTimestampProto", () => {
  test("유효한 ISO 문자열 → seconds + nanos 변환", () => {
    const result = isoToTimestampProto("2023-11-14T22:13:20.500Z");
    expect(result.seconds).toBe(1700000000n);
    expect(result.nanos).toBe(500_000_000);
  });

  test("밀리초 0인 경우 nanos는 0", () => {
    const result = isoToTimestampProto("2023-11-14T22:13:20.000Z");
    expect(result.nanos).toBe(0);
  });

  test("유효하지 않은 ISO 문자열은 에러", () => {
    expect(() => isoToTimestampProto("not-a-date")).toThrow("Invalid ISO timestamp");
  });
});
