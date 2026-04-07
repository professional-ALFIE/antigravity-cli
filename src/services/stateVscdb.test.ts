/**
 * stateVscdb.ts — Integration 테스트
 *
 * 원본: scripts/headless-backend/state_vscdb.test.ts에서 이관.
 * SQLite DB 생성 → topic bytes 추출 → USS envelope 검증.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  TOPIC_STORAGE_KEYS,
  StateDbReader,
  createUnifiedStateUpdateEnvelope,
  decodeUnifiedStateUpdateRequestBytes_func,
} from "./stateVscdb.js";

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

describe("StateDbReader", () => {
  test("oauth/enterprise topic bytes 정확히 반환", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-state-db-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      const oauthBytes = Buffer.from("010203", "hex");
      const prefsBytes = Buffer.from("aabbccdd", "hex");
      await createStateDb(dbPath, [
        {
          key: TOPIC_STORAGE_KEYS["uss-oauth"],
          value: oauthBytes.toString("base64"),
        },
        {
          key: TOPIC_STORAGE_KEYS["uss-enterprisePreferences"],
          value: prefsBytes.toString("base64"),
        },
      ]);

      const reader = new StateDbReader(dbPath);
      expect(await reader.getTopicBytes("uss-oauth")).toEqual(oauthBytes);
      expect(await reader.getTopicBytes("uss-enterprisePreferences")).toEqual(prefsBytes);
      await reader.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("trajectorySummaries push update를 state.vscdb에 반영", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-state-db-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      await createStateDb(dbPath, []);

      const reader = new StateDbReader(dbPath);
      const requestBody = buildPushUpdateRequestBody({
        topicName: "trajectorySummaries",
        key: "cascade-123",
        rowValue: Buffer.from("summary-payload", "utf8").toString("base64"),
        eTag: 7,
      });

      const decoded = decodeUnifiedStateUpdateRequestBytes_func(requestBody);
      expect(decoded.topicName).toBe("trajectorySummaries");
      expect(decoded.appliedUpdate?.key).toBe("cascade-123");

      await reader.applyUnifiedStateUpdateRequestBytes(requestBody);

      const raw = await reader.getBase64Value("antigravityUnifiedStateSync.trajectorySummaries");
      expect(raw).not.toBeNull();
      const topicText = Buffer.from(raw!, "base64").toString("utf8");
      expect(topicText).toContain("cascade-123");
      expect(topicText).toContain("c3VtbWFyeS1wYXlsb2Fk");

      await reader.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("trajectorySummaries row를 직접 upsert할 수 있다", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-state-db-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      await createStateDb(dbPath, []);

      const reader = new StateDbReader(dbPath);
      await reader.upsertTopicRowValue(
        "trajectorySummaries",
        "cascade-direct",
        Buffer.from("direct-summary-payload", "utf8").toString("base64"),
        11n,
      );

      const raw = await reader.getBase64Value("antigravityUnifiedStateSync.trajectorySummaries");
      expect(raw).not.toBeNull();
      const topicText = Buffer.from(raw!, "base64").toString("utf8");
      expect(topicText).toContain("cascade-direct");
      expect(topicText).toContain("ZGlyZWN0LXN1bW1hcnktcGF5bG9hZA==");

      await reader.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("createUnifiedStateUpdateEnvelope", () => {
  test("Connect frame + field 1 bytes 구조", () => {
    const envelope = createUnifiedStateUpdateEnvelope(Buffer.from("deadbeef", "hex"));
    // flags byte = 0
    expect(envelope[0]).toBe(0);
    // length = 6 (0x0a tag + 0x04 length varint + 4 bytes payload)
    expect(envelope.readUInt32BE(1)).toBe(6);
    // 내용: 0x0a(field 1, LEN) + 0x04(length) + deadbeef
    expect(envelope.subarray(5)).toEqual(Buffer.from("0a04deadbeef", "hex"));
  });
});
