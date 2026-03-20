import type { Command } from 'commander';
import type { Helpers } from '../helpers.js';
import { printError, printResult } from '../output.js';
import {
  jobExists_func,
  listJobRecords_func,
  readJobRecord_func,
} from '../jobs/store.js';
import { waitForJobCompletion_func, JobTimeoutError } from '../jobs/runtime.js';
import { resolveClientForWorkspace_func } from '../auto-launch.js';
import { Spinner } from '../spinner.js';
import { timeout_exit_code_var } from '../jobs/types.js';

function formatListItems_func(): Array<Record<string, string>> {
  return listJobRecords_func().map((job_var) => ({
    jobId: job_var.jobId,
    status: job_var.status,
    cascadeId: job_var.cascadeId,
    workspace: job_var.workspace,
    prompt: job_var.prompt,
  }));
}

export function register(program: Command, h: Helpers): void {
  const jobs_cmd_var = program
    .command('jobs')
    .description('List local CLI jobs and inspect results');

  jobs_cmd_var
    .command('list')
    .description('List local jobs')
    .action(async () => {
      await h.run(async () => {
        const items_var = formatListItems_func();
        if (h.isJsonMode()) {
          printResult(items_var, true);
        } else {
          printResult(items_var, false);
        }
      });
    });

  jobs_cmd_var
    .command('status <jobId>')
    .description('Show local job status')
    .action(async (job_id_var: string) => {
      await h.run(async () => {
        if (!jobExists_func(job_id_var)) {
          throw new Error(`Unknown job: ${job_id_var}`);
        }

        printResult(readJobRecord_func(job_id_var), h.isJsonMode());
      });
    });

  jobs_cmd_var
    .command('wait <jobId>')
    .description('Wait for a local job to finish')
    .action(async (job_id_var: string) => {
      let spinner_var: Spinner | null = null;
      try {
        if (!jobExists_func(job_id_var)) {
          throw new Error(`Unknown job: ${job_id_var}`);
        }

        const job_var = readJobRecord_func(job_id_var);
        if (job_var.status === 'completed' && job_var.result) {
          printResult(job_var.result, h.isJsonMode());
          return;
        }

        spinner_var = new Spinner();
        spinner_var.start('Connecting');
        const resolved_var = await resolveClientForWorkspace_func(undefined, job_var.workspace, spinner_var);
        const completed_job_var = await waitForJobCompletion_func({
          client_var: resolved_var.client_var,
          job_var,
          idle_timeout_var: 10000,
          approval_policy_var: job_var.approvalPolicy,
          spinner_var,
        });

        spinner_var.succeed(`Job ${completed_job_var.jobId.substring(0, 8)} completed`);
        printResult(completed_job_var.result, h.isJsonMode());
      } catch (error_var) {
        spinner_var?.stop();
        printError(error_var instanceof Error ? error_var.message : String(error_var));
        if (error_var instanceof JobTimeoutError) {
          process.exitCode = timeout_exit_code_var;
        } else {
          process.exitCode = 1;
        }
      }
    });

  jobs_cmd_var
    .command('result <jobId>')
    .description('Show stored job result')
    .action(async (job_id_var: string) => {
      await h.run(async () => {
        if (!jobExists_func(job_id_var)) {
          throw new Error(`Unknown job: ${job_id_var}`);
        }

        const job_var = readJobRecord_func(job_id_var);
        if (!job_var.result) {
          throw new Error(`Job ${job_id_var} has no stored result yet. Use \`jobs wait ${job_id_var}\`.`);
        }

        printResult(job_var.result, h.isJsonMode());
      });
    });
}
