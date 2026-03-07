/**
 * 커맨드 파일에서 공유하는 헬퍼 유틸리티.
 * program 인스턴스를 받아 getClient / isJsonMode / run을 생성한다.
 */

import type { Command } from 'commander';
import { discoverInstance } from './discovery.js';
import { BridgeClient } from './client.js';
import { printError } from './output.js';

export interface Helpers {
  getClient: () => BridgeClient;
  isJsonMode: () => boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
}

export function createHelpers(program: Command): Helpers {
  function getClient(): BridgeClient {
    const opts_var = program.opts();
    const instance_var = discoverInstance(opts_var.port as number | undefined);
    return new BridgeClient(instance_var.port);
  }

  function isJsonMode(): boolean {
    return Boolean(program.opts().json);
  }

  async function run(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }

  return { getClient, isJsonMode, run };
}
