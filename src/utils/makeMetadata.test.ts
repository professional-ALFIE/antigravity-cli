/**
 * makeMetadata.ts — Integration 테스트
 *
 * 원본: scripts/headless-backend/make_metadata.test.ts에서 이관.
 * protobuf wire format 바이트 동일성 검증.
 */

import { describe, test, expect } from "bun:test";
import { METADATA_FIELD_NUMBERS, buildMetadataArtifact } from "./makeMetadata.js";

function decodeVarint(buffer: Buffer, offset: number): { value: number; nextOffset: number } {
  let value = 0;
  let shift = 0;
  let index = offset;

  while (index < buffer.length) {
    const byte = buffer[index];
    value |= (byte & 0x7f) << shift;
    index += 1;
    if ((byte & 0x80) === 0) {
      return { value, nextOffset: index };
    }
    shift += 7;
  }

  throw new Error("unterminated varint");
}

function decodeStringFields(buffer: Buffer): Map<number, string> {
  const fields = new Map<number, string>();
  let offset = 0;

  while (offset < buffer.length) {
    const { value: tag, nextOffset: afterTag } = decodeVarint(buffer, offset);
    const fieldNumber = tag >> 3;
    const { value: length, nextOffset: afterLength } = decodeVarint(buffer, afterTag);
    const value = buffer.subarray(afterLength, afterLength + length).toString("utf8");
    fields.set(fieldNumber, value);
    offset = afterLength + length;
  }

  return fields;
}

describe("buildMetadataArtifact", () => {
  test("protobuf wire format — 필드 번호/값 정확", () => {
    const artifact = buildMetadataArtifact({
      ideName: "antigravity",
      extensionVersion: "0.3.0",
      apiKey: "ya29.token",
      locale: "ko",
      os: "mac",
      ideVersion: "1.20.6",
      hardware: "arm64",
      sessionId: "session-id",
      extensionName: "antigravity",
      extensionPath: "/Applications/Antigravity.app/Contents/Resources/app/extensions/antigravity",
      triggerId: "trigger-id",
      id: "metadata-id",
      userTierId: "",
    });

    const decoded = decodeStringFields(artifact.binary);
    expect(decoded.get(METADATA_FIELD_NUMBERS.ideName)).toBe("antigravity");
    expect(decoded.get(METADATA_FIELD_NUMBERS.extensionVersion)).toBe("0.3.0");
    expect(decoded.get(METADATA_FIELD_NUMBERS.apiKey)).toBe("ya29.token");
    expect(decoded.get(METADATA_FIELD_NUMBERS.ideVersion)).toBe("1.20.6");
    expect(decoded.get(METADATA_FIELD_NUMBERS.extensionPath)).toBe(
      "/Applications/Antigravity.app/Contents/Resources/app/extensions/antigravity",
    );
  });

  test("redactedTextproto에 토큰 미포함", () => {
    const artifact = buildMetadataArtifact({
      ideName: "antigravity",
      extensionVersion: "0.3.0",
      apiKey: "secret-token",
      locale: "ko",
      os: "mac",
      ideVersion: "1.20.6",
      hardware: "arm64",
      sessionId: "session-id",
      extensionName: "antigravity",
      extensionPath: "/path",
      triggerId: "trigger-id",
      id: "metadata-id",
      userTierId: "",
    });

    expect(artifact.textproto).toContain('api_key: "secret-token"');
    expect(artifact.redactedTextproto).not.toContain("secret-token");
    expect(artifact.redactedTextproto).toContain("[REDACTED]");
  });
});
