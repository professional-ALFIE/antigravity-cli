/**
 * bundleRuntime.test.ts → golden protobuf builder 테스트 (v3.1 전환)
 *
 * 이전: 실제 앱 번들을 VM으로 로드해서 schema 검증.
 * 현재: connectRpc.ts의 raw protobuf builder가 올바른 wire format을 생성하는지 검증.
 *
 * golden bytes 비교: 알려진 입력에 대해 기대되는 protobuf wire bytes를 fixture로 고정.
 */

import { describe, test, expect } from "bun:test";

import {
  buildStreamAgentStateUpdatesRequestProto,
  buildCascadeTrajectorySummaryProto,
  resolveCascadeRunStatusNumber,
  isoToTimestampProto,
} from "./connectRpc.js";

// ---------------------------------------------------------------------------
// Protobuf wire decode helpers (golden 검증용)
// ---------------------------------------------------------------------------

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
// Golden: StreamAgentStateUpdatesRequest wire format
// ---------------------------------------------------------------------------

describe("golden: buildStreamAgentStateUpdatesRequestProto wire format", () => {
  test("field 1=conversationId, field 2=subscriberId — wire 구조 검증", () => {
    const buf = buildStreamAgentStateUpdatesRequestProto({
      conversationId: "conv-abc-123",
      subscriberId: "sub-xyz-456",
    });

    const fields = decodeFields(buf);
    expect(fields.get(1)?.[0]?.buffer?.toString("utf8")).toBe("conv-abc-123");
    expect(fields.get(2)?.[0]?.buffer?.toString("utf8")).toBe("sub-xyz-456");
    expect(fields.has(3)).toBe(false); // no page bounds
  });

  test("field 3=initialStepsPageBounds nested Slice — startIndex + endIndexExclusive", () => {
    const buf = buildStreamAgentStateUpdatesRequestProto({
      conversationId: "c",
      subscriberId: "s",
      initialStepsPageBounds: { startIndex: 5, endIndexExclusive: 10 },
    });

    const fields = decodeFields(buf);
    expect(fields.has(3)).toBe(true);

    const sliceFields = decodeFields(fields.get(3)![0].buffer!);
    expect(Number(sliceFields.get(1)?.[0]?.value ?? -1n)).toBe(5);
    expect(Number(sliceFields.get(2)?.[0]?.value ?? -1n)).toBe(10);
  });

  test("endIndexExclusive 생략 시 Slice에 field 2 없음", () => {
    const buf = buildStreamAgentStateUpdatesRequestProto({
      conversationId: "c",
      subscriberId: "s",
      initialStepsPageBounds: { startIndex: 0 },
    });

    const fields = decodeFields(buf);
    const sliceFields = decodeFields(fields.get(3)![0].buffer!);
    expect(sliceFields.has(1)).toBe(true);
    expect(sliceFields.has(2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Golden: CascadeTrajectorySummary wire format
// ---------------------------------------------------------------------------

describe("golden: buildCascadeTrajectorySummaryProto wire format", () => {
  test("최소 필드 — field 1/2/4/5 wire 구조 검증", () => {
    const buf = buildCascadeTrajectorySummaryProto({
      summary: "Hello world",
      stepCount: 7,
      trajectoryId: "traj-999",
      status: 2,
    });

    const fields = decodeFields(buf);
    expect(fields.get(1)?.[0]?.buffer?.toString("utf8")).toBe("Hello world");
    expect(Number(fields.get(2)?.[0]?.value ?? -1n)).toBe(7);
    expect(fields.get(4)?.[0]?.buffer?.toString("utf8")).toBe("traj-999");
    expect(Number(fields.get(5)?.[0]?.value ?? -1n)).toBe(2);
    expect(fields.has(3)).toBe(false); // no lastModifiedTime
    expect(fields.has(7)).toBe(false); // no createdTime
    expect(fields.has(9)).toBe(false); // no workspaces
  });

  test("Timestamp fields — field 3 lastModifiedTime, field 7 createdTime", () => {
    const buf = buildCascadeTrajectorySummaryProto({
      summary: "s",
      stepCount: 1,
      trajectoryId: "t",
      status: 1,
      lastModifiedTime: { seconds: 1700000000n, nanos: 500_000_000 },
      createdTime: { seconds: 1699000000n },
    });

    const fields = decodeFields(buf);

    // field 3 = lastModifiedTime (Timestamp)
    const lmtFields = decodeFields(fields.get(3)![0].buffer!);
    expect(lmtFields.get(1)?.[0]?.value).toBe(1700000000n);
    expect(Number(lmtFields.get(2)?.[0]?.value ?? 0n)).toBe(500_000_000);

    // field 7 = createdTime (Timestamp)
    const ctFields = decodeFields(fields.get(7)![0].buffer!);
    expect(ctFields.get(1)?.[0]?.value).toBe(1699000000n);
    expect(ctFields.has(2)).toBe(false); // nanos=0 → 생략됨
  });

  test("workspaces repeated — field 9 CortexWorkspaceMetadata (field 1/2/4)", () => {
    const buf = buildCascadeTrajectorySummaryProto({
      summary: "s",
      stepCount: 1,
      trajectoryId: "t",
      status: 1,
      workspaces: [
        { workspaceFolderAbsoluteUri: "file:///proj1" },
        {
          workspaceFolderAbsoluteUri: "file:///proj2",
          gitRootAbsoluteUri: "file:///git2",
          branchName: "main",
        },
      ],
    });

    const fields = decodeFields(buf);
    const wsEntries = fields.get(9);
    expect(wsEntries?.length).toBe(2);

    // workspace 1: field 1만
    const ws1 = decodeFields(wsEntries![0].buffer!);
    expect(ws1.get(1)?.[0]?.buffer?.toString("utf8")).toBe("file:///proj1");
    expect(ws1.has(2)).toBe(false);
    expect(ws1.has(4)).toBe(false);

    // workspace 2: field 1 + 2 + 4
    const ws2 = decodeFields(wsEntries![1].buffer!);
    expect(ws2.get(1)?.[0]?.buffer?.toString("utf8")).toBe("file:///proj2");
    expect(ws2.get(2)?.[0]?.buffer?.toString("utf8")).toBe("file:///git2");
    expect(ws2.get(4)?.[0]?.buffer?.toString("utf8")).toBe("main");
  });
});

// ---------------------------------------------------------------------------
// Golden: resolveCascadeRunStatusNumber 계약 검증
// ---------------------------------------------------------------------------

describe("golden: resolveCascadeRunStatusNumber 계약", () => {
  test("ref 번들 기준 enum 전체 매핑 일치", () => {
    const expected: [string, number][] = [
      ["CASCADE_RUN_STATUS_UNSPECIFIED", 0],
      ["CASCADE_RUN_STATUS_IDLE", 1],
      ["CASCADE_RUN_STATUS_RUNNING", 2],
      ["CASCADE_RUN_STATUS_CANCELING", 3],
      ["CASCADE_RUN_STATUS_BUSY", 4],
      ["UNSPECIFIED", 0],
      ["IDLE", 1],
      ["RUNNING", 2],
      ["CANCELING", 3],
      ["BUSY", 4],
    ];

    for (const [input, expected_number] of expected) {
      expect(resolveCascadeRunStatusNumber(input)).toBe(expected_number);
    }
  });

  test("number passthrough", () => {
    expect(resolveCascadeRunStatusNumber(0)).toBe(0);
    expect(resolveCascadeRunStatusNumber(4)).toBe(4);
    expect(resolveCascadeRunStatusNumber(99)).toBe(99);
  });

  test("unknown → UNSPECIFIED(0) fallback — 의도된 계약", () => {
    expect(resolveCascadeRunStatusNumber("NONEXISTENT")).toBe(0);
    expect(resolveCascadeRunStatusNumber("CASCADE_RUN_STATUS_ERROR")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Golden: isoToTimestampProto 정밀도
// ---------------------------------------------------------------------------

describe("golden: isoToTimestampProto 정밀도", () => {
  test("epoch → seconds=0, nanos=0", () => {
    const result = isoToTimestampProto("1970-01-01T00:00:00.000Z");
    expect(result.seconds).toBe(0n);
    expect(result.nanos).toBe(0);
  });

  test("밀리초 정밀도 유지", () => {
    const result = isoToTimestampProto("2023-11-14T22:13:20.123Z");
    expect(result.seconds).toBe(1700000000n);
    expect(result.nanos).toBe(123_000_000);
  });

  test("정수 초 → nanos=0", () => {
    const result = isoToTimestampProto("2023-11-14T22:13:20.000Z");
    expect(result.seconds).toBe(1700000000n);
    expect(result.nanos).toBe(0);
  });

  test("invalid date → throw", () => {
    expect(() => isoToTimestampProto("invalid")).toThrow("Invalid ISO timestamp");
    expect(() => isoToTimestampProto("")).toThrow("Invalid ISO timestamp");
  });
});
