import test from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import {
  autoApply,
  getPatchState,
  patchFile,
  revertFile,
  setAppRootOverrideForTesting,
  setSyntaxCheckOverrideForTesting,
} from '../src/auto-run.ts';

type FixtureName = 'workbench-input.js' | 'jetski-input.js';

interface AppRootContext {
  rootPath: string;
  productPath: string;
  workbenchPath: string;
  jetskiPath: string;
  originalWorkbenchContent: string;
  originalJetskiContent: string;
  originalProductRaw: string;
}

function computeChecksum_func(content_var: string): string {
  return crypto.createHash('sha256').update(Buffer.from(content_var, 'utf8')).digest('base64').replace(/=+$/, '');
}

async function readFixture_func(name_var: FixtureName): Promise<string> {
  const fixture_path_var = new URL(`./fixtures/${name_var}`, import.meta.url);
  return readFile(fixture_path_var, 'utf8');
}

async function createAppRoot_func(
  workbench_name_var: FixtureName = 'workbench-input.js',
  jetski_name_var: FixtureName = 'jetski-input.js',
): Promise<AppRootContext> {
  const root_path_var = await mkdtemp(path.join(os.tmpdir(), 'ag-auto-run-'));
  const workbench_path_var = path.join(root_path_var, 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
  const jetski_path_var = path.join(root_path_var, 'out', 'jetskiAgent', 'main.js');
  const product_path_var = path.join(root_path_var, 'product.json');

  await mkdir(path.dirname(workbench_path_var), { recursive: true });
  await mkdir(path.dirname(jetski_path_var), { recursive: true });

  const original_workbench_content_var = await readFixture_func(workbench_name_var);
  const original_jetski_content_var = await readFixture_func(jetski_name_var);

  await writeFile(workbench_path_var, original_workbench_content_var, 'utf8');
  await writeFile(jetski_path_var, original_jetski_content_var, 'utf8');

  const product_raw_var = JSON.stringify({
    checksums: {
      'vs/workbench/workbench.desktop.main.js': computeChecksum_func(original_workbench_content_var),
      'jetskiAgent/main.js': computeChecksum_func(original_jetski_content_var),
    },
  }, null, '\t');

  await writeFile(product_path_var, product_raw_var, 'utf8');

  return {
    rootPath: root_path_var,
    productPath: product_path_var,
    workbenchPath: workbench_path_var,
    jetskiPath: jetski_path_var,
    originalWorkbenchContent: original_workbench_content_var,
    originalJetskiContent: original_jetski_content_var,
    originalProductRaw: product_raw_var,
  };
}

async function cleanupAppRoot_func(root_path_var: string): Promise<void> {
  await rm(root_path_var, { recursive: true, force: true });
}

async function readProductJson_func(product_path_var: string): Promise<{ checksums: Record<string, string> }> {
  return JSON.parse(await readFile(product_path_var, 'utf8'));
}

test('workbench patch inserts fn-based autorun snippet and updates only its checksum', async () => {
  const app_var = await createAppRoot_func();

  try {
    const result_var = await patchFile(app_var.workbenchPath, 'workbench', app_var.rootPath);
    assert.equal(result_var.status, 'patched');

    const patched_content_var = await readFile(app_var.workbenchPath, 'utf8');
    assert.match(patched_content_var, /;\/\*BA:autorun\*\/fn\(\(\)=>\{u===uF\.EAGER&&!d&&b\(!0\)\},\[\]\);return/);
    assert.doesNotMatch(patched_content_var, /;\/\*BA:autorun\*\/xi\(/);

    const product_var = await readProductJson_func(app_var.productPath);
    assert.equal(
      product_var.checksums['vs/workbench/workbench.desktop.main.js'],
      computeChecksum_func(patched_content_var),
    );
    assert.equal(
      product_var.checksums['jetskiAgent/main.js'],
      computeChecksum_func(app_var.originalJetskiContent),
    );
  } finally {
    await cleanupAppRoot_func(app_var.rootPath);
  }
});

test('jetski patch chooses At instead of memo alias', async () => {
  const app_var = await createAppRoot_func();

  try {
    const result_var = await patchFile(app_var.jetskiPath, 'jetskiAgent', app_var.rootPath);
    assert.equal(result_var.status, 'patched');

    const patched_content_var = await readFile(app_var.jetskiPath, 'utf8');
    assert.match(patched_content_var, /;\/\*BA:autorun\*\/At\(\(\)=>\{v===Dhe\.EAGER&&!m&&F\(!0\)\},\[\]\);return/);
    assert.doesNotMatch(patched_content_var, /;\/\*BA:autorun\*\/Oe\(/);
  } finally {
    await cleanupAppRoot_func(app_var.rootPath);
  }
});

test('marker-only content is treated as patch-corrupted', async () => {
  const app_var = await createAppRoot_func();

  try {
    await writeFile(app_var.workbenchPath, '/*BA:autorun*/', 'utf8');

    assert.equal(await getPatchState(app_var.workbenchPath), 'patch-corrupted');

    const result_var = await patchFile(app_var.workbenchPath, 'workbench', app_var.rootPath);
    assert.equal(result_var.status, 'patch-corrupted');
  } finally {
    await cleanupAppRoot_func(app_var.rootPath);
  }
});

test('reapplying a valid patch is byte-identical and reports already-patched', async () => {
  const app_var = await createAppRoot_func();

  try {
    const first_result_var = await patchFile(app_var.workbenchPath, 'workbench', app_var.rootPath);
    assert.equal(first_result_var.status, 'patched');

    const first_content_var = await readFile(app_var.workbenchPath, 'utf8');
    const second_result_var = await patchFile(app_var.workbenchPath, 'workbench', app_var.rootPath);
    const second_content_var = await readFile(app_var.workbenchPath, 'utf8');

    assert.equal(second_result_var.status, 'already-patched');
    assert.equal(second_content_var, first_content_var);
    assert.equal(await getPatchState(app_var.workbenchPath), 'patched');
  } finally {
    await cleanupAppRoot_func(app_var.rootPath);
  }
});

test('partial revert restores only the requested checksum key', async () => {
  const app_var = await createAppRoot_func();

  try {
    assert.equal((await patchFile(app_var.workbenchPath, 'workbench', app_var.rootPath)).status, 'patched');
    assert.equal((await patchFile(app_var.jetskiPath, 'jetskiAgent', app_var.rootPath)).status, 'patched');

    const patched_jetski_content_var = await readFile(app_var.jetskiPath, 'utf8');
    const patched_jetski_checksum_var = computeChecksum_func(patched_jetski_content_var);
    const original_product_var = JSON.parse(app_var.originalProductRaw) as { checksums: Record<string, string> };

    const revert_result_var = await revertFile(app_var.workbenchPath, 'workbench', app_var.rootPath);
    assert.equal(revert_result_var.status, 'reverted');

    assert.equal(await readFile(app_var.workbenchPath, 'utf8'), app_var.originalWorkbenchContent);
    assert.notEqual(await readFile(app_var.jetskiPath, 'utf8'), app_var.originalJetskiContent);

    const product_var = await readProductJson_func(app_var.productPath);
    assert.equal(
      product_var.checksums['vs/workbench/workbench.desktop.main.js'],
      original_product_var.checksums['vs/workbench/workbench.desktop.main.js'],
    );
    assert.equal(
      product_var.checksums['jetskiAgent/main.js'],
      patched_jetski_checksum_var,
    );
  } finally {
    await cleanupAppRoot_func(app_var.rootPath);
  }
});

test('checksum write failure rolls back JS and leaves product.json untouched', async () => {
  const app_var = await createAppRoot_func();

  try {
    await mkdir(app_var.productPath + '.ba-tmp');

    const result_var = await patchFile(app_var.workbenchPath, 'workbench', app_var.rootPath);
    assert.equal(result_var.status, 'error');
    assert.match(result_var.error ?? '', /checksum update failed during product\.json commit/);

    assert.equal(await readFile(app_var.workbenchPath, 'utf8'), app_var.originalWorkbenchContent);
    assert.equal(await readFile(app_var.productPath, 'utf8'), app_var.originalProductRaw);
    assert.equal(await getPatchState(app_var.workbenchPath), 'unpatched');
  } finally {
    await cleanupAppRoot_func(app_var.rootPath);
  }
});

test('syntax-check failure keeps JS, product.json, backup, and tmp state unchanged', async () => {
  const app_var = await createAppRoot_func();

  try {
    setSyntaxCheckOverrideForTesting(() => {
      throw new Error('forced syntax failure');
    });

    const result_var = await patchFile(app_var.workbenchPath, 'workbench', app_var.rootPath);
    assert.equal(result_var.status, 'syntax-check-failed');

    assert.equal(await readFile(app_var.workbenchPath, 'utf8'), app_var.originalWorkbenchContent);
    assert.equal(await readFile(app_var.productPath, 'utf8'), app_var.originalProductRaw);

    await assert.rejects(access(app_var.workbenchPath + '.ba-backup'));
    await assert.rejects(access(app_var.workbenchPath + '.ba-tmp'));
    await assert.rejects(access(app_var.workbenchPath + '.ba-tmp.js'));
  } finally {
    setSyntaxCheckOverrideForTesting(null);
    await cleanupAppRoot_func(app_var.rootPath);
  }
});

test('checksum restore failure rolls JS back to patched snapshot during revert', async () => {
  const app_var = await createAppRoot_func();

  try {
    assert.equal((await patchFile(app_var.workbenchPath, 'workbench', app_var.rootPath)).status, 'patched');

    const patched_content_var = await readFile(app_var.workbenchPath, 'utf8');
    const patched_product_raw_var = await readFile(app_var.productPath, 'utf8');

    await mkdir(app_var.productPath + '.ba-tmp');

    const result_var = await revertFile(app_var.workbenchPath, 'workbench', app_var.rootPath);
    assert.equal(result_var.status, 'error');
    assert.match(result_var.error ?? '', /checksum restore failed during product\.json commit/);

    assert.equal(await readFile(app_var.workbenchPath, 'utf8'), patched_content_var);
    assert.equal(await readFile(app_var.productPath, 'utf8'), patched_product_raw_var);
    assert.equal(await getPatchState(app_var.workbenchPath), 'patched');
  } finally {
    await cleanupAppRoot_func(app_var.rootPath);
  }
});

test('autoApply waits for app-wide lock and then patches successfully', async () => {
  const app_var = await createAppRoot_func();
  const lock_path_var = path.join(app_var.rootPath, '.ba-autorun.lock');

  try {
    setAppRootOverrideForTesting(app_var.rootPath);
    await writeFile(lock_path_var, JSON.stringify({ pid: 999999, createdAt: new Date().toISOString() }), 'utf8');

    const release_timer_var = setTimeout(() => {
      void unlink(lock_path_var).catch(() => {
        // ignore
      });
    }, 250);

    const started_at_var = Date.now();
    const results_var = await autoApply();
    clearTimeout(release_timer_var);

    assert.ok(Date.now() - started_at_var >= 200);
    assert.deepEqual(
      results_var.map((result_var) => result_var.status),
      ['patched', 'patched'],
    );
  } finally {
    setAppRootOverrideForTesting(undefined);
    await cleanupAppRoot_func(app_var.rootPath);
  }
});
