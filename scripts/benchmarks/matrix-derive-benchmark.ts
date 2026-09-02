#!/usr/bin/env -S npx vite-node

import os from "node:os";
import { performance } from "node:perf_hooks";
import {
  buildCasesMatrix,
  type CasesMatrixInput,
  type CasesMatrixTask,
} from "../../src/lib/casesMatrix";
import type { CaseStatus } from "../../src/lib/caseStatus";

const runs = Number.parseInt(process.env.MATRIX_DERIVE_RUNS ?? "10", 10);
if (!Number.isFinite(runs) || runs < 5) {
  throw new Error("MATRIX_DERIVE_RUNS must be at least 5.");
}

const statuses: readonly CaseStatus[] = [
  "not_started",
  "in_progress",
  "submitted",
  "in_review",
  "action_required",
  "approved",
  "denied",
  "not_pursuing",
];
const states = ["NC", "SC", "VA", "GA", "TN"] as const;

function fixture(providerCount: number): CasesMatrixInput {
  const payers = Array.from({ length: 20 }, (_, index) => ({
    id: `payer-${index + 1}`,
    name: `Payer ${String(index + 1).padStart(2, "0")}`,
  }));
  const groups = Array.from({ length: 7 }, (_, index) => ({
    id: `group-${index + 1}`,
    name: `Group ${index + 1}`,
  }));
  const providers = Array.from({ length: providerCount }, (_, index) => ({
    id: `provider-${index + 1}`,
    firstName: `Taylor${String(index + 1).padStart(5, "0")}`,
    lastName: `Provider${String(index + 1).padStart(5, "0")}`,
    status: "active" as const,
    referenceOnly: false,
    verificationState: "verified",
    isTestProvider: false,
  }));
  const cases = providers.flatMap((provider, providerIndex) => {
    const groupId = groups[providerIndex % groups.length].id;
    const state = states[providerIndex % states.length];
    return payers.map((payer, payerIndex) => ({
      id: `case-${providerIndex + 1}-${payerIndex + 1}`,
      providerId: provider.id,
      groupId,
      payerId: payer.id,
      state,
      caseStatus: statuses[(providerIndex + payerIndex) % statuses.length],
      confirmedEffectiveDate:
        (providerIndex + payerIndex) % statuses.length === 5 ? "2026-06-01" : null,
      createdAt: "2026-01-01T00:00:00.000Z",
      caseNumber: providerIndex * 20 + payerIndex + 1,
      submittedDate:
        (providerIndex + payerIndex) % statuses.length >= 2 ? "2026-03-01" : null,
    }));
  });
  const targets = groups.flatMap((group) =>
    states.flatMap((state) =>
      payers.map((payer) => ({
        payerId: payer.id,
        groupId: group.id,
        state,
        status: "active",
      })),
    ),
  );
  const tasks: CasesMatrixTask[] = cases.map((credentialCase, index) => ({
    caseId: credentialCase.id,
    status: index % 5 === 0 ? "completed" : "not_started",
    dueDate: index % 3 === 0 ? "2026-08-01" : "2026-10-01",
  }));
  const followUps = new Map(
    cases
      .filter((_, index) => index % 4 === 0)
      .map((credentialCase) => [credentialCase.id, { touchDate: "2026-08-01" }]),
  );
  return {
    today: "2026-09-02",
    providers,
    cases,
    payers,
    groups,
    targets,
    tasks,
    followUps,
    exclusions: [],
  };
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

const measurements = [];
for (const providerCount of [500, 1500, 3000]) {
  const input = fixture(providerCount);
  buildCasesMatrix(input);
  const samples = [];
  let sectionCount = 0;
  let renderedCellCount = 0;

  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    const matrix = buildCasesMatrix(input);
    samples.push(performance.now() - started);
    sectionCount = matrix.sections.length;
    renderedCellCount = matrix.sections.reduce(
      (total, section) => total + section.rows.length * section.columns.length,
      0,
    );
  }

  measurements.push({
    providerCount,
    payerCount: 20,
    caseCount: input.cases.length,
    taskCount: input.tasks.length,
    sectionCount,
    renderedCellCount,
    timing: {
      runs,
      p50Ms: Number(percentile(samples, 0.5).toFixed(1)),
      p95Ms: Number(percentile(samples, 0.95).toFixed(1)),
      minMs: Number(Math.min(...samples).toFixed(1)),
      maxMs: Number(Math.max(...samples).toFixed(1)),
    },
    heapUsedBytes: process.memoryUsage().heapUsed,
  });
}

process.stdout.write(
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      environment: {
        node: process.version,
        platform: `${os.platform()} ${os.release()} ${os.arch()}`,
        cpuModel: os.cpus()[0]?.model ?? null,
        cpuCount: os.cpus().length,
        totalMemoryBytes: os.totalmem(),
      },
      method: {
        runs,
        implementation: "src/lib/casesMatrix.ts buildCasesMatrix",
        inputs: "20 payers, seven groups, five states, one task per case, follow-up on 25% of cases",
        timingExcludes: "network, React reconciliation, and DOM layout/paint",
      },
      measurements,
    },
    null,
    2,
  )}\n`,
);
