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
  createSidebarWorkspaceRowValueBase64_func,
  createUnifiedStateUpdateEnvelope,
  decodeUnifiedStateUpdateRequestBytes_func,
  extractSelectedModelEnumFromModelPreferencesBase64_func,
  resolveSidebarWorkspaceRowValueBase64_func,
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
  db.run("CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)");
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

function readVarint(buffer: Buffer, offset: number): { value: bigint; nextOffset: number } {
  let value = 0n;
  let shift = 0n;
  let index = offset;

  while (index < buffer.length) {
    const byte = BigInt(buffer[index]);
    value |= (byte & 0x7fn) << shift;
    index += 1;
    if ((byte & 0x80n) === 0n) {
      return { value, nextOffset: index };
    }
    shift += 7n;
  }

  throw new Error("unterminated varint");
}

function skipField(buffer: Buffer, offset: number, wireType: number): number {
  if (wireType === 0) {
    return readVarint(buffer, offset).nextOffset;
  }
  if (wireType === 1) {
    return offset + 8;
  }
  if (wireType === 2) {
    const { value, nextOffset } = readVarint(buffer, offset);
    return nextOffset + Number(value);
  }
  if (wireType === 5) {
    return offset + 4;
  }

  throw new Error(`unsupported wire type ${wireType}`);
}

function buildSidebarWorkspaceSeedRowValue(fields: Buffer[]): string {
  return Buffer.concat(fields).toString("base64");
}

function findSidebarWorkspaceUriFieldRange(bytes: Buffer): {
  workspaceUri: string;
  fieldStart: number;
  fieldEnd: number;
} {
  let offset = 0;
  let match:
    | {
        workspaceUri: string;
        fieldStart: number;
        fieldEnd: number;
      }
    | null = null;

  while (offset < bytes.length) {
    const fieldStart = offset;
    const { value: tag, nextOffset } = readVarint(bytes, offset);
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 0x07n);
    offset = nextOffset;

    if (fieldNumber === 4) {
      if (wireType !== 2 || match) {
        throw new Error("invalid sidebar workspaceUri field");
      }
      const { value: length, nextOffset: dataOffset } = readVarint(bytes, offset);
      const fieldEnd = dataOffset + Number(length);
      match = {
        workspaceUri: bytes.subarray(dataOffset, fieldEnd).toString("utf8"),
        fieldStart,
        fieldEnd,
      };
      offset = fieldEnd;
      continue;
    }

    offset = skipField(bytes, offset, wireType);
  }

  if (!match) {
    throw new Error("workspaceUri field not found");
  }

  return match;
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
  test("modelPreferences sentinel에서 마지막 선택 모델 enum을 읽는다", async () => {
    const selected_model_enum_var = extractSelectedModelEnumFromModelPreferencesBase64_func(
      "CjAKJmxhc3Rfc2VsZWN0ZWRfYWdlbnRfbW9kZWxfc2VudGluZWxfa2V5EgYKBEVJSUk=",
    );

    expect(selected_model_enum_var).toBe(1026);
  });

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

  test("state.vscdb modelPreferences row에서 마지막 선택 모델 enum을 읽는다", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-state-db-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      await createStateDb(dbPath, [
        {
          key: TOPIC_STORAGE_KEYS["uss-modelPreferences"],
          value: "CjAKJmxhc3Rfc2VsZWN0ZWRfYWdlbnRfbW9kZWxfc2VudGluZWxfa2V5EgYKBEVJSUk=",
        },
      ]);

      const reader = new StateDbReader(dbPath);
      expect(await reader.extractLastSelectedModelEnum()).toBe(1026);
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

  test("trajectorySummaries upsert는 기존 logical row를 유지한 채 새 row를 병합한다", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-state-db-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      const reader = new StateDbReader(dbPath);
      try {
        await createStateDb(dbPath, []);

        await reader.upsertTopicRowValue(
          "trajectorySummaries",
          "cascade-a",
          Buffer.from("payload-a", "utf8").toString("base64"),
          3n,
        );
        await reader.upsertTopicRowValue(
          "trajectorySummaries",
          "cascade-b",
          Buffer.from("payload-b", "utf8").toString("base64"),
          5n,
        );

        const raw = await reader.getBase64Value("antigravityUnifiedStateSync.trajectorySummaries");
        expect(raw).not.toBeNull();
        const topicText = Buffer.from(raw!, "base64").toString("utf8");
        expect(topicText).toContain("cascade-a");
        expect(topicText).toContain("cGF5bG9hZC1h");
        expect(topicText).toContain("cascade-b");
        expect(topicText).toContain("cGF5bG9hZC1i");
      } finally {
        await reader.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("trajectorySummaries upsert는 unrelated key를 덮어쓰지 않는다", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-state-db-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      const originalOauthBase64 = Buffer.from("oauth-preserved", "utf8").toString("base64");
      await createStateDb(dbPath, [
        {
          key: TOPIC_STORAGE_KEYS["uss-oauth"],
          value: originalOauthBase64,
        },
      ]);

      const reader = new StateDbReader(dbPath);
      try {
        await reader.upsertTopicRowValue(
          "trajectorySummaries",
          "cascade-preserve",
          Buffer.from("payload-preserve", "utf8").toString("base64"),
          9n,
        );

        expect(await reader.getBase64Value(TOPIC_STORAGE_KEYS["uss-oauth"])).toBe(originalOauthBase64);
      } finally {
        await reader.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("atomic upsert는 trajectorySummaries와 sidebarWorkspaces를 함께 반영한다", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-state-db-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      await createStateDb(dbPath, []);

      const reader = new StateDbReader(dbPath);
      try {
        await reader.upsertTopicRowValuesAtomic([
          {
            topicName: "trajectorySummaries",
            rowKey: "cascade-atomic",
            rowValue: Buffer.from("atomic-summary-payload", "utf8").toString("base64"),
            eTag: 13n,
          },
          {
            topicName: "sidebarWorkspaces",
            rowKey: "file:///Users/noseung-gyeong/test-workspace",
            rowValue: createSidebarWorkspaceRowValueBase64_func("file:///Users/noseung-gyeong/test-workspace"),
            eTag: 17n,
          },
        ]);

        const summaryRaw = await reader.getBase64Value(TOPIC_STORAGE_KEYS.trajectorySummaries);
        const sidebarRaw = await reader.getBase64Value(TOPIC_STORAGE_KEYS.sidebarWorkspaces);
        expect(summaryRaw).not.toBeNull();
        expect(sidebarRaw).not.toBeNull();
        expect(Buffer.from(summaryRaw!, "base64").toString("utf8")).toContain("cascade-atomic");
        expect(Buffer.from(sidebarRaw!, "base64").toString("utf8")).toContain("file:///Users/noseung-gyeong/test-workspace");
      } finally {
        await reader.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("sidebarWorkspaces row 준비는 runtime seed clone에서 workspaceUri만 바꾸고 나머지 bytes를 유지한다", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-state-db-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      const runtimeSeedWorkspaceUri = "file:///Users/runtime-seed/workspace";
      const targetWorkspaceUri = "file:///Users/clone-target/workspace";
      const runtimeSeedRowValue = buildSidebarWorkspaceSeedRowValue([
        encodeStringField(3, "prefix-marker"),
        encodeStringField(4, runtimeSeedWorkspaceUri),
        encodeLengthDelimitedField(5, Buffer.from([0x10, 0x01])),
        encodeStringField(9, "suffix-marker"),
      ]);
      await createStateDb(dbPath, [
        {
          key: TOPIC_STORAGE_KEYS.sidebarWorkspaces,
          value: Buffer.concat(
            [
              encodeLengthDelimitedField(1, Buffer.concat([
                encodeStringField(1, runtimeSeedWorkspaceUri),
                encodeLengthDelimitedField(2, Buffer.concat([
                  encodeStringField(1, runtimeSeedRowValue),
                  encodeVarintField(2, 29),
                ])),
              ])),
            ],
          ).toString("base64"),
        },
      ]);

      const reader = new StateDbReader(dbPath);
      try {
        const preparedSidebarRow = await reader.createSidebarWorkspaceTopicRowAtomicUpsert_func(
          targetWorkspaceUri,
        );

        expect(preparedSidebarRow).not.toBeNull();
        const runtimeSeedBytes = Buffer.from(runtimeSeedRowValue, "base64");
        const { fieldStart, fieldEnd } = findSidebarWorkspaceUriFieldRange(runtimeSeedBytes);
        const expectedBytes = Buffer.concat([
          runtimeSeedBytes.subarray(0, fieldStart),
          encodeStringField(4, targetWorkspaceUri),
          runtimeSeedBytes.subarray(fieldEnd),
        ]);
        const actualBytes = Buffer.from(preparedSidebarRow!.rowValue, "base64");

        expect(actualBytes).toEqual(expectedBytes);
        expect(findSidebarWorkspaceUriFieldRange(actualBytes).workspaceUri).toBe(targetWorkspaceUri);
      } finally {
        await reader.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("sidebarWorkspaces row 준비는 runtime seed를 golden fallback보다 우선한다", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-state-db-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      const runtimeSeedWorkspaceUri = "file:///Users/runtime-priority/workspace";
      const targetWorkspaceUri = "file:///Users/runtime-priority/target";
      const runtimeSeedRowValue = buildSidebarWorkspaceSeedRowValue([
        encodeStringField(4, runtimeSeedWorkspaceUri),
        encodeLengthDelimitedField(5, Buffer.from([0x10, 0x01])),
        encodeStringField(11, "runtime-only-marker"),
      ]);
      await createStateDb(dbPath, [
        {
          key: TOPIC_STORAGE_KEYS.sidebarWorkspaces,
          value: Buffer.concat(
            [
              encodeLengthDelimitedField(1, Buffer.concat([
                encodeStringField(1, runtimeSeedWorkspaceUri),
                encodeLengthDelimitedField(2, Buffer.concat([
                  encodeStringField(1, runtimeSeedRowValue),
                  encodeVarintField(2, 31),
                ])),
              ])),
            ],
          ).toString("base64"),
        },
      ]);

      const reader = new StateDbReader(dbPath);
      try {
        const preparedSidebarRow = await reader.createSidebarWorkspaceTopicRowAtomicUpsert_func(
          targetWorkspaceUri,
        );

        expect(preparedSidebarRow).not.toBeNull();
        expect(preparedSidebarRow!.rowValue).not.toBe(
          createSidebarWorkspaceRowValueBase64_func(targetWorkspaceUri),
        );

        const preparedBytes = Buffer.from(preparedSidebarRow!.rowValue, "base64");
        expect(preparedBytes.toString("utf8")).toContain("runtime-only-marker");
        expect(findSidebarWorkspaceUriFieldRange(preparedBytes).workspaceUri).toBe(targetWorkspaceUri);
      } finally {
        await reader.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("sidebarWorkspaces target row가 이미 정상이면 기존 row.value와 eTag를 재사용한다", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-state-db-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      const targetWorkspaceUri = "file:///Users/existing-target/workspace";
      const targetRowValue = buildSidebarWorkspaceSeedRowValue([
        encodeStringField(4, targetWorkspaceUri),
        encodeLengthDelimitedField(5, Buffer.from([0x10, 0x01])),
        encodeStringField(12, "keep-existing"),
      ]);
      const otherSeedWorkspaceUri = "file:///Users/other-runtime/workspace";
      const otherSeedRowValue = buildSidebarWorkspaceSeedRowValue([
        encodeStringField(4, otherSeedWorkspaceUri),
        encodeLengthDelimitedField(5, Buffer.from([0x10, 0x01])),
      ]);
      await createStateDb(dbPath, [
        {
          key: TOPIC_STORAGE_KEYS.sidebarWorkspaces,
          value: Buffer.concat(
            [
              encodeLengthDelimitedField(1, Buffer.concat([
                encodeStringField(1, targetWorkspaceUri),
                encodeLengthDelimitedField(2, Buffer.concat([
                  encodeStringField(1, targetRowValue),
                  encodeVarintField(2, 37),
                ])),
              ])),
              encodeLengthDelimitedField(1, Buffer.concat([
                encodeStringField(1, otherSeedWorkspaceUri),
                encodeLengthDelimitedField(2, Buffer.concat([
                  encodeStringField(1, otherSeedRowValue),
                  encodeVarintField(2, 41),
                ])),
              ])),
            ],
          ).toString("base64"),
        },
      ]);

      const reader = new StateDbReader(dbPath);
      try {
        const preparedSidebarRow = await reader.createSidebarWorkspaceTopicRowAtomicUpsert_func(
          targetWorkspaceUri,
        );

        expect(preparedSidebarRow).toEqual({
          topicName: "sidebarWorkspaces",
          rowKey: targetWorkspaceUri,
          rowValue: targetRowValue,
          eTag: 37n,
        });
      } finally {
        await reader.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("sidebarWorkspaces row 준비는 runtime seed가 없으면 golden seed로 fallback한다", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-state-db-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      const targetWorkspaceUri = "file:///Users/golden-fallback/workspace";
      await createStateDb(dbPath, []);

      const reader = new StateDbReader(dbPath);
      try {
        const preparedSidebarRow = await reader.createSidebarWorkspaceTopicRowAtomicUpsert_func(
          targetWorkspaceUri,
        );

        expect(preparedSidebarRow).toEqual({
          topicName: "sidebarWorkspaces",
          rowKey: targetWorkspaceUri,
          rowValue: createSidebarWorkspaceRowValueBase64_func(targetWorkspaceUri),
          eTag: 1n,
        });
      } finally {
        await reader.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("sidebarWorkspaces payload 생성이 fail-closed면 trajectorySummaries와 sidebarWorkspaces를 둘 다 기록하지 않는다", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-state-db-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      await createStateDb(dbPath, []);

      const reader = new StateDbReader(dbPath);
      try {
        const targetWorkspaceUri = "file:///Users/fail-closed/workspace";
        const sidebarResolution = resolveSidebarWorkspaceRowValueBase64_func(
          targetWorkspaceUri,
          [
            {
              rowKey: "file:///Users/invalid-runtime/workspace",
              rowValue: "@@not-base64@@",
            },
          ],
          {
            goldenSeedRow_var: {
              rowKey: "file:///Users/golden-mismatch/workspace",
              rowValue: createSidebarWorkspaceRowValueBase64_func("file:///Users/other-workspace"),
            },
          },
        );

        expect(sidebarResolution).toBeNull();

        if (sidebarResolution) {
          await reader.upsertTopicRowValuesAtomic([
            {
              topicName: "trajectorySummaries",
              rowKey: "cascade-fail-closed",
              rowValue: Buffer.from("should-not-write", "utf8").toString("base64"),
            },
            {
              topicName: "sidebarWorkspaces",
              rowKey: targetWorkspaceUri,
              rowValue: sidebarResolution.rowValue,
            },
          ]);
        }

        expect(await reader.getBase64Value(TOPIC_STORAGE_KEYS.trajectorySummaries)).toBeNull();
        expect(await reader.getBase64Value(TOPIC_STORAGE_KEYS.sidebarWorkspaces)).toBeNull();
      } finally {
        await reader.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("atomic upsert는 두 번째 row 직전 실패 시 둘 다 반영하지 않는다", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-state-db-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      const originalOauthBase64 = Buffer.from("oauth-preserved", "utf8").toString("base64");
      await createStateDb(dbPath, [
        {
          key: TOPIC_STORAGE_KEYS["uss-oauth"],
          value: originalOauthBase64,
        },
      ]);

      const reader = new StateDbReader(dbPath);
      try {
        (reader as unknown as {
          _test_before_atomic_topic_write_var: ((storage_key_var: string, write_index_var: number) => void) | null;
        })._test_before_atomic_topic_write_var = (_storage_key_var, write_index_var) => {
          if (write_index_var === 1) {
            throw new Error("inject-failure-before-second-topic-write");
          }
        };

        await expect(reader.upsertTopicRowValuesAtomic([
          {
            topicName: "trajectorySummaries",
            rowKey: "cascade-rollback",
            rowValue: Buffer.from("rollback-summary-payload", "utf8").toString("base64"),
            eTag: 19n,
          },
          {
            topicName: "sidebarWorkspaces",
            rowKey: "file:///Users/noseung-gyeong/rollback-workspace",
            rowValue: createSidebarWorkspaceRowValueBase64_func("file:///Users/noseung-gyeong/rollback-workspace"),
            eTag: 23n,
          },
        ])).rejects.toThrow("inject-failure-before-second-topic-write");

        expect(await reader.getBase64Value(TOPIC_STORAGE_KEYS.trajectorySummaries)).toBeNull();
        expect(await reader.getBase64Value(TOPIC_STORAGE_KEYS.sidebarWorkspaces)).toBeNull();
        expect(await reader.getBase64Value(TOPIC_STORAGE_KEYS["uss-oauth"])).toBe(originalOauthBase64);
      } finally {
        (reader as unknown as {
          _test_before_atomic_topic_write_var: ((storage_key_var: string, write_index_var: number) => void) | null;
        })._test_before_atomic_topic_write_var = null;
        await reader.close();
      }
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
