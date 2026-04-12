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

// ─────────────────────────────────────────────────────────────
// Phase 1: extractUserStatusSummary_func tests
// Plan §Step 1 - stateVscdb.ts 파서 테스트
// ─────────────────────────────────────────────────────────────

// Wire format helpers used in test fixtures

/** encodeFloat32LE: QuotaInfo.remaining_fraction = field 1 (wire type 5 = fixed32 LE) */
function encodeFloat32LE(fieldNumber: number, value: number): Buffer {
  const tag = encodeTag(fieldNumber, 5);
  const floatBuf = Buffer.allocUnsafe(4);
  floatBuf.writeFloatLE(value, 0);
  return Buffer.concat([tag, floatBuf]);
}

/** encodeTimestamp: google.protobuf.Timestamp embedded in fieldNumber (wire type 2) */
function encodeTimestampField(fieldNumber: number, seconds: number): Buffer {
  // Timestamp: field 1 = int64 seconds (varint wire type 0)
  const secondsField = encodeVarintField(1, seconds);
  return encodeLengthDelimitedField(fieldNumber, secondsField);
}

/** encodeQuotaInfo: QuotaInfo embedded { field 1 = float, field 2 = Timestamp } */
function encodeQuotaInfo(remainingFraction: number, resetSeconds: number): Buffer {
  return Buffer.concat([
    encodeFloat32LE(1, remainingFraction),
    encodeTimestampField(2, resetSeconds),
  ]);
}

/** encodeClientModelConfig: for testing */
function encodeClientModelConfig(opts: {
  label: string;
  disabled?: boolean;
  isRecommended?: boolean;
  tagTitle?: string;
  quotaInfo?: { remainingFraction: number; resetSeconds: number };
}): Buffer {
  const parts: Buffer[] = [
    encodeStringField(1, opts.label),
  ];
  if (opts.disabled) parts.push(encodeVarintField(4, 1));
  if (opts.isRecommended) parts.push(encodeVarintField(11, 1));
  if (opts.quotaInfo) {
    const qi = encodeQuotaInfo(opts.quotaInfo.remainingFraction, opts.quotaInfo.resetSeconds);
    parts.push(encodeLengthDelimitedField(15, qi));
  }
  if (opts.tagTitle) parts.push(encodeStringField(16, opts.tagTitle));
  return Buffer.concat(parts);
}

/** encodeCascadeModelConfigData: field 1 repeated ClientModelConfig */
function encodeCascadeModelConfigData(models: Buffer[]): Buffer {
  return Buffer.concat(models.map((m) => encodeLengthDelimitedField(1, m)));
}

/** encodeUserTier: field 1 = id (string), field 2 = name (string) */
function encodeUserTier(id: string, name: string): Buffer {
  return Buffer.concat([encodeStringField(1, id), encodeStringField(2, name)]);
}

/**
 * encodeUserStatusProto: builds a UserStatus proto (raw bytes, not wrapped in topic rows)
 * field 7 = email, field 33 = cascadeModelConfigData, field 36 = userTier
 */
function encodeUserStatusProto(opts: {
  email?: string;
  userTierId?: string;
  userTierName?: string;
  models?: Array<{
    label: string;
    disabled?: boolean;
    isRecommended?: boolean;
    quotaInfo?: { remainingFraction: number; resetSeconds: number };
  }>;
}): Buffer {
  const parts: Buffer[] = [];
  if (opts.email) parts.push(encodeStringField(7, opts.email));
  if (opts.models) {
    const modelBufs = opts.models.map((m) => encodeClientModelConfig(m));
    parts.push(encodeLengthDelimitedField(33, encodeCascadeModelConfigData(modelBufs)));
  }
  if (opts.userTierId || opts.userTierName) {
    parts.push(encodeLengthDelimitedField(36, encodeUserTier(opts.userTierId ?? "", opts.userTierName ?? "")));
  }
  return Buffer.concat(parts);
}

/**
 * buildUserStatusTopicBytes: wraps UserStatusProto in a row topic with key="userStatusSentinelKey"
 * used to put into state.vscdb as 'antigravityUnifiedStateSync.userStatus'
 */
function buildUserStatusTopicBytes(userStatusProtoBytes: Buffer): Buffer {
  const rowValueBase64 = userStatusProtoBytes.toString("base64");
  // Row: field 1 = value (string = base64), field 2 = eTag (varint)
  const rowBytes = Buffer.concat([
    encodeStringField(1, rowValueBase64),
    encodeVarintField(2, 1),
  ]);
  // Entry: field 1 = key, field 2 = row message
  const entryBytes = Buffer.concat([
    encodeStringField(1, "userStatusSentinelKey"),
    encodeLengthDelimitedField(2, rowBytes),
  ]);
  // Topic: field 1 = entry
  return encodeLengthDelimitedField(1, entryBytes);
}

/**
 * buildModelCreditsTopicBytes: builds uss-modelCredits topic with sentinel key entries
 * PrimitiveValue: int32Value = field 2 (varint)
 */
function buildPrimitiveValueInt32(value: number): Buffer {
  return encodeVarintField(2, value);
}

function buildModelCreditsSentinelRow(key: string, int32Value: number): Buffer {
  const pvBase64 = buildPrimitiveValueInt32(int32Value).toString("base64");
  const rowBytes = Buffer.concat([
    encodeStringField(1, pvBase64),
    encodeVarintField(2, 1),
  ]);
  const entryBytes = Buffer.concat([
    encodeStringField(1, key),
    encodeLengthDelimitedField(2, rowBytes),
  ]);
  return encodeLengthDelimitedField(1, entryBytes);
}

function buildModelCreditsTopicBytes(available: number | null, minimum: number | null): Buffer {
  const parts: Buffer[] = [];
  if (available !== null) parts.push(buildModelCreditsSentinelRow("availableCreditsSentinelKey", available));
  if (minimum !== null) parts.push(buildModelCreditsSentinelRow("minimumCreditAmountForUsageKey", minimum));
  return Buffer.concat(parts);
}

// ──────────────────────────────────────────────
// extractUserStatusSummary_func tests
// ──────────────────────────────────────────────

describe("extractUserStatusSummary_func", () => {
  test("1. 정상: email + tier + Gemini/Claude quota 1개씩", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-us-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      const now = Math.floor(Date.now() / 1000) + 3600; // 1시간 후
      const userStatusBytes = encodeUserStatusProto({
        email: "test@example.com",
        userTierId: "g1-ultra-tier",
        userTierName: "Google AI Ultra",
        models: [
          { label: "Gemini 3 Flash", isRecommended: true, quotaInfo: { remainingFraction: 0.87, resetSeconds: now } },
          { label: "Claude Sonnet 4.6", isRecommended: true, quotaInfo: { remainingFraction: 0.23, resetSeconds: now } },
        ],
      });
      const topicBytes = buildUserStatusTopicBytes(userStatusBytes);
      await createStateDb(dbPath, [
        { key: TOPIC_STORAGE_KEYS["uss-userStatus"], value: topicBytes.toString("base64") },
      ]);

      const reader = new StateDbReader(dbPath);
      const summary = await reader.extractUserStatusSummary_func();
      await reader.close();

      expect(summary).not.toBeNull();
      expect(summary!.email).toBe("test@example.com");
      expect(summary!.userTierId).toBe("g1-ultra-tier");
      expect(summary!.userTierName).toBe("Google AI Ultra");
      expect(summary!.familyQuotaSummaries.length).toBeGreaterThanOrEqual(2);
      const gemini = summary!.familyQuotaSummaries.find((f) => f.familyName === "GEMINI");
      const claude = summary!.familyQuotaSummaries.find((f) => f.familyName === "CLAUDE");
      expect(gemini).toBeDefined();
      expect(claude).toBeDefined();
      expect(gemini!.remainingPercentage).toBe(87);
      expect(claude!.remainingPercentage).toBe(23);
      expect(gemini!.exhausted).toBe(false);
      expect(gemini!.resetTime).not.toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("2. email만 있고 tier/quota 없음", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-us-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      const userStatusBytes = encodeUserStatusProto({ email: "only@email.com" });
      const topicBytes = buildUserStatusTopicBytes(userStatusBytes);
      await createStateDb(dbPath, [
        { key: TOPIC_STORAGE_KEYS["uss-userStatus"], value: topicBytes.toString("base64") },
      ]);

      const reader = new StateDbReader(dbPath);
      const summary = await reader.extractUserStatusSummary_func();
      await reader.close();

      expect(summary).not.toBeNull();
      expect(summary!.email).toBe("only@email.com");
      expect(summary!.userTierId).toBeNull();
      expect(summary!.userTierName).toBeNull();
      expect(summary!.familyQuotaSummaries).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("3. 여러 모델, family별 earliest reset 사용", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-us-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      const earlier = Math.floor(Date.now() / 1000) + 1800; // 30분 후
      const later = Math.floor(Date.now() / 1000) + 3600;   // 1시간 후
      const userStatusBytes = encodeUserStatusProto({
        email: "x@x.com",
        models: [
          { label: "Gemini 3 Flash", quotaInfo: { remainingFraction: 0.5, resetSeconds: later } },
          { label: "Gemini 3.1 Pro", quotaInfo: { remainingFraction: 0.8, resetSeconds: earlier } },
          { label: "Claude Opus 4.6", quotaInfo: { remainingFraction: 0.1, resetSeconds: later } },
        ],
      });
      await createStateDb(dbPath, [
        { key: TOPIC_STORAGE_KEYS["uss-userStatus"], value: buildUserStatusTopicBytes(userStatusBytes).toString("base64") },
      ]);

      const reader = new StateDbReader(dbPath);
      const summary = await reader.extractUserStatusSummary_func();
      await reader.close();

      const gemini = summary!.familyQuotaSummaries.find((f) => f.familyName === "GEMINI");
      expect(gemini).toBeDefined();
      // earliest reset time = earlier (30분 후)
      expect(gemini!.resetTime).toBe(new Date(earlier * 1000).toISOString());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("4. malformed quotaInfo.resetTime → skip null, no throw", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-us-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      // Build ClientModelConfig with broken quotaInfo (just a float, no timestamp)
      const brokenQuota = encodeFloat32LE(1, 0.5); // only remaining_fraction, no reset_time
      const modelBuf = Buffer.concat([
        encodeStringField(1, "Gemini 3 Flash"),
        encodeLengthDelimitedField(15, brokenQuota),
      ]);
      const userStatusBytes = Buffer.concat([
        encodeStringField(7, "x@x.com"),
        encodeLengthDelimitedField(33, encodeLengthDelimitedField(1, modelBuf)),
      ]);
      await createStateDb(dbPath, [
        { key: TOPIC_STORAGE_KEYS["uss-userStatus"], value: buildUserStatusTopicBytes(userStatusBytes).toString("base64") },
      ]);

      const reader = new StateDbReader(dbPath);
      expect(async () => reader.extractUserStatusSummary_func()).not.toThrow();
      const summary = await reader.extractUserStatusSummary_func();
      await reader.close();

      expect(summary).not.toBeNull();
      const gemini = summary!.familyQuotaSummaries.find((f) => f.familyName === "GEMINI");
      expect(gemini).toBeDefined();
      expect(gemini!.resetTime).toBeNull(); // no valid reset time
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("5. topic 없음 → null 반환", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-us-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      await createStateDb(dbPath, []);

      const reader = new StateDbReader(dbPath);
      const summary = await reader.extractUserStatusSummary_func();
      await reader.close();

      expect(summary).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("6. malformed bytes → null 반환 (no throw)", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-us-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      await createStateDb(dbPath, [
        { key: TOPIC_STORAGE_KEYS["uss-userStatus"], value: "not-base64!!!" },
      ]);

      const reader = new StateDbReader(dbPath);
      const summary = await reader.extractUserStatusSummary_func();
      await reader.close();

      expect(summary).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("7. malformed nested userTier → email 정상, tier null", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-us-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      // field 36 에 garbage bytes
      const userStatusBytes = Buffer.concat([
        encodeStringField(7, "ok@email.com"),
        encodeLengthDelimitedField(36, Buffer.from("garbage bytesXXXX")),
      ]);
      await createStateDb(dbPath, [
        { key: TOPIC_STORAGE_KEYS["uss-userStatus"], value: buildUserStatusTopicBytes(userStatusBytes).toString("base64") },
      ]);

      const reader = new StateDbReader(dbPath);
      const summary = await reader.extractUserStatusSummary_func();
      await reader.close();

      expect(summary).not.toBeNull();
      expect(summary!.email).toBe("ok@email.com");
      // garbage bytes → id/name null 이거나 partial parse (no throw)
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("8. unknown extra field → 정상 파싱 (unknown field ignore)", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-us-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      // unknown field 99 추가
      const userStatusBytes = Buffer.concat([
        encodeStringField(7, "user@test.com"),
        encodeStringField(99, "some-unknown-data"),
        encodeLengthDelimitedField(36, encodeUserTier("tier-id", "Tier Name")),
      ]);
      await createStateDb(dbPath, [
        { key: TOPIC_STORAGE_KEYS["uss-userStatus"], value: buildUserStatusTopicBytes(userStatusBytes).toString("base64") },
      ]);

      const reader = new StateDbReader(dbPath);
      const summary = await reader.extractUserStatusSummary_func();
      await reader.close();

      expect(summary!.email).toBe("user@test.com");
      expect(summary!.userTierId).toBe("tier-id");
      expect(summary!.userTierName).toBe("Tier Name");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("9. disabled 모델은 quota 집계에서 제외", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-us-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      const now = Math.floor(Date.now() / 1000) + 3600;
      const userStatusBytes = encodeUserStatusProto({
        email: "x@x.com",
        models: [
          { label: "Gemini 3 Flash (disabled)", disabled: true, quotaInfo: { remainingFraction: 0.5, resetSeconds: now } },
          { label: "Claude Opus 4.6", quotaInfo: { remainingFraction: 0.3, resetSeconds: now } },
        ],
      });
      await createStateDb(dbPath, [
        { key: TOPIC_STORAGE_KEYS["uss-userStatus"], value: buildUserStatusTopicBytes(userStatusBytes).toString("base64") },
      ]);

      const reader = new StateDbReader(dbPath);
      const summary = await reader.extractUserStatusSummary_func();
      await reader.close();

      // GEMINI disabled → no GEMINI family entry (or entry with no quota)
      const gemini = summary!.familyQuotaSummaries.find((f) => f.familyName === "GEMINI");
      expect(gemini).toBeUndefined(); // disabled model excluded
      const claude = summary!.familyQuotaSummaries.find((f) => f.familyName === "CLAUDE");
      expect(claude!.remainingPercentage).toBe(30);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ──────────────────────────────────────────────
// extractModelCreditsSummary_func tests
// ──────────────────────────────────────────────

describe("extractModelCreditsSummary_func", () => {
  test("1. 정상: available + minimum 모두 존재", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-mc-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      const topicBytes = buildModelCreditsTopicBytes(100, 10);
      await createStateDb(dbPath, [
        { key: TOPIC_STORAGE_KEYS["uss-modelCredits"], value: topicBytes.toString("base64") },
      ]);

      const reader = new StateDbReader(dbPath);
      const summary = await reader.extractModelCreditsSummary_func();
      await reader.close();

      expect(summary).not.toBeNull();
      expect(summary!.availableCredits).toBe(100);
      expect(summary!.minimumCreditAmountForUsage).toBe(10);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("2. availableCreditsSentinelKey만 있음", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-mc-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      const topicBytes = buildModelCreditsTopicBytes(50, null);
      await createStateDb(dbPath, [
        { key: TOPIC_STORAGE_KEYS["uss-modelCredits"], value: topicBytes.toString("base64") },
      ]);

      const reader = new StateDbReader(dbPath);
      const summary = await reader.extractModelCreditsSummary_func();
      await reader.close();

      expect(summary!.availableCredits).toBe(50);
      expect(summary!.minimumCreditAmountForUsage).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("3. row map 있지만 sentinel key 없음", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-mc-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      const topicBytes = buildModelCreditsSentinelRow("someOtherKey", 42);
      await createStateDb(dbPath, [
        { key: TOPIC_STORAGE_KEYS["uss-modelCredits"], value: encodeLengthDelimitedField(1, topicBytes).toString("base64") },
      ]);

      const reader = new StateDbReader(dbPath);
      const summary = await reader.extractModelCreditsSummary_func();
      await reader.close();

      expect(summary!.availableCredits).toBeNull();
      expect(summary!.minimumCreditAmountForUsage).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("4. row value decode 실패 → null graceful", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-mc-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      // row value가 invalid base64인 경우
      const rowBytes = Buffer.concat([
        encodeStringField(1, "@@NOT_BASE64@@"),
        encodeVarintField(2, 1),
      ]);
      const entryBytes = Buffer.concat([
        encodeStringField(1, "availableCreditsSentinelKey"),
        encodeLengthDelimitedField(2, rowBytes),
      ]);
      const topicBytes = encodeLengthDelimitedField(1, entryBytes);
      await createStateDb(dbPath, [
        { key: TOPIC_STORAGE_KEYS["uss-modelCredits"], value: topicBytes.toString("base64") },
      ]);

      const reader = new StateDbReader(dbPath);
      const summary = await reader.extractModelCreditsSummary_func();
      await reader.close();

      expect(summary).not.toBeNull();
      expect(summary!.availableCredits).toBeNull(); // decode failed → null
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("5. topic 자체가 없음 → null 반환", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ag-mc-"));
    try {
      const dbPath = path.join(root, "state.vscdb");
      await createStateDb(dbPath, []);

      const reader = new StateDbReader(dbPath);
      const summary = await reader.extractModelCreditsSummary_func();
      await reader.close();

      expect(summary).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
