import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { canonicalDigest } from "../release/contract.mjs";
import { assertApprovalIntent } from "./intent.mjs";
import { approvalSummary } from "./summary.mjs";
import {
  assertProductionBaselineAttestation,
  assertStagingQualification,
} from "./qualification.mjs";
import {
  APPROVER_ID,
  DeliveryError,
  REPOSITORY,
  WORKFLOWS,
  requireCondition,
  requireId,
  requireSha,
} from "./boundary.mjs";

const API = `https://api.github.com/repos/${REPOSITORY}`;
const MAX_ARCHIVE = 2 * 1024 * 1024;
const MAX_JSON = 1024 * 1024;

/** GitHub Actions artifact zip redirects land on these signed download hosts only. */
function allowedArtifactHost(hostname) {
  return (
    typeof hostname === "string" &&
    (hostname === "objects.githubusercontent.com" ||
      hostname.endsWith(".githubusercontent.com") ||
      hostname.endsWith(".blob.core.windows.net"))
  );
}

async function boundedBytes(response, limit) {
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    requireCondition(length <= limit, "PROVIDER_RESPONSE_TOO_LARGE");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createGitHub({ token, fetcher = fetch }) {
  requireCondition(typeof token === "string" && token.length > 0, "GITHUB_CREDENTIAL_MISSING");
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2026-03-10",
  };
  const request = async (method, path, body) => {
    requireCondition(path.startsWith("/") && !path.includes(".."), "GITHUB_PATH");
    let response;
    try {
      response = await fetcher(`${API}${path}`, {
        method,
        headers: { ...headers, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new DeliveryError("GITHUB_REQUEST_FAILED");
    }
    requireCondition(response.ok, "GITHUB_REQUEST_REJECTED");
    if (response.status === 204) return null;
    try {
      return JSON.parse((await boundedBytes(response, MAX_JSON)).toString("utf8"));
    } catch {
      throw new DeliveryError("GITHUB_RESPONSE_INVALID");
    }
  };
  return Object.freeze({
    request,
    async archive(id) {
      requireId(String(id));
      const redirect = await fetcher(`${API}/actions/artifacts/${id}/zip`, {
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
      });
      requireCondition(redirect.status === 302, "ARTIFACT_DOWNLOAD_REJECTED");
      let destination;
      try {
        destination = new URL(redirect.headers.get("location") ?? "");
      } catch {
        throw new DeliveryError("ARTIFACT_REDIRECT");
      }
      // Digest pins content; host allowlist still blocks runner SSRF to arbitrary HTTPS.
      requireCondition(
        destination.protocol === "https:" &&
          !destination.username &&
          !destination.password &&
          allowedArtifactHost(destination.hostname),
        "ARTIFACT_REDIRECT",
      );
      // The signed provider redirect receives no GitHub authorization header.
      const response = await fetcher(destination, {
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      requireCondition(response.ok, "ARTIFACT_DOWNLOAD_REJECTED");
      return boundedBytes(response, MAX_ARCHIVE);
    },
  });
}

/** Deliberately narrow single-file ZIP reader; nothing is extracted to disk. */
export function readArtifactJson(archive, expectedFile) {
  requireCondition(
    Buffer.isBuffer(archive) && archive.length >= 22 && archive.length <= MAX_ARCHIVE,
    "ARTIFACT_ZIP",
  );
  try {
    const end = archive.length - 22;
    requireCondition(archive.readUInt32LE(end) === 0x06054b50, "ARTIFACT_ZIP");
    requireCondition(
      archive.readUInt32LE(end + 4) === 0 &&
        archive.readUInt16LE(end + 8) === 1 &&
        archive.readUInt16LE(end + 10) === 1,
      "ARTIFACT_ZIP",
    );
    const directory = archive.readUInt32LE(end + 16);
    requireCondition(archive.readUInt32LE(directory) === 0x02014b50, "ARTIFACT_ZIP");
    const flags = archive.readUInt16LE(directory + 8);
    const method = archive.readUInt16LE(directory + 10);
    const compressed = archive.readUInt32LE(directory + 20);
    const expanded = archive.readUInt32LE(directory + 24);
    const nameLength = archive.readUInt16LE(directory + 28);
    const offset = archive.readUInt32LE(directory + 42);
    const name = archive.subarray(directory + 46, directory + 46 + nameLength).toString("utf8");
    requireCondition(
      name === expectedFile && [0, 8].includes(method) && (flags & 1) === 0 && expanded <= MAX_JSON,
      "ARTIFACT_CONTENT",
    );
    requireCondition(archive.readUInt32LE(offset) === 0x04034b50, "ARTIFACT_ZIP");
    const localNameLength = archive.readUInt16LE(offset + 26);
    const localExtraLength = archive.readUInt16LE(offset + 28);
    requireCondition(
      archive.subarray(offset + 30, offset + 30 + localNameLength).toString("utf8") ===
        expectedFile,
      "ARTIFACT_CONTENT",
    );
    const start = offset + 30 + localNameLength + localExtraLength;
    requireCondition(start + compressed <= directory, "ARTIFACT_ZIP");
    const data = archive.subarray(start, start + compressed);
    const result = method === 0 ? data : inflateRawSync(data, { maxOutputLength: MAX_JSON });
    requireCondition(result.length === expanded, "ARTIFACT_ZIP");
    return JSON.parse(result.toString("utf8"));
  } catch (error) {
    if (error instanceof DeliveryError) throw error;
    throw new DeliveryError("ARTIFACT_CONTENT");
  }
}

function trustedRun(run, { path, event, sha, completed = true }) {
  requireCondition(
    run.repository?.full_name === REPOSITORY && run.head_repository?.full_name === REPOSITORY,
    "RUN_REPOSITORY",
  );
  requireCondition(
    (run.path === path || run.path === `${path}@main`) &&
      run.event === event &&
      run.head_branch === "main",
    "RUN_PROVENANCE",
  );
  requireCondition(run.head_sha === requireSha(sha), "RUN_SHA");
  if (completed)
    requireCondition(
      run.status === "completed" && run.conclusion === "success",
      "RUN_NOT_SUCCESSFUL",
    );
}

export async function admitSuccessfulMain({ github, runId, sha }) {
  requireId(runId);
  const run = await github.request("GET", `/actions/runs/${runId}`);
  trustedRun(run, { path: WORKFLOWS.ci, event: "push", sha });
  const main = await github.request("GET", "/git/ref/heads/main");
  requireCondition(main.object?.sha === sha, "MAIN_MOVED");
  return run;
}

async function pinnedArtifact({ github, artifactId, run, name, filename, digest }) {
  const metadata = await github.request(
    "GET",
    `/actions/artifacts/${requireId(String(artifactId))}`,
  );
  requireCondition(
    metadata.id === Number(artifactId) && metadata.name === name && metadata.expired === false,
    "ARTIFACT_IDENTITY",
  );
  requireCondition(
    metadata.workflow_run?.id === run.id &&
      metadata.workflow_run?.head_sha === run.head_sha &&
      metadata.workflow_run?.head_branch === "main",
    "ARTIFACT_PROVENANCE",
  );
  requireCondition(
    /^sha256:[a-f0-9]{64}$/.test(metadata.digest) && (!digest || metadata.digest === digest),
    "ARTIFACT_DIGEST",
  );
  const bytes = await github.archive(artifactId);
  requireCondition(
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` === metadata.digest,
    "ARTIFACT_DIGEST",
  );
  return { value: readArtifactJson(bytes, filename), metadata };
}

/** Review history lacks attempt timestamps. Every release uses a fresh run, attempt 1. */
export async function verifyProductionApproval({
  github,
  runId,
  runAttempt,
  workflowSha,
  request,
  now = new Date().toISOString(),
}) {
  assertApprovalIntent(request, { now });
  requireCondition(runAttempt === 1, "FRESH_APPROVAL_RUN_REQUIRED");
  const run = await github.request("GET", `/actions/runs/${requireId(runId)}`);
  trustedRun(run, {
    path: WORKFLOWS.production,
    event: "workflow_dispatch",
    sha: workflowSha,
    completed: false,
  });
  requireCondition(run.run_attempt === 1 && run.status === "in_progress", "APPROVAL_RUN_STATE");
  requireCondition(
    request.runId === runId && request.runAttempt === 1 && request.workflowSha === workflowSha,
    "APPROVAL_BINDING",
  );
  const review = await readProductionReview({ github, runId });
  return Object.freeze({ ...request, ...review, requestDigest: canonicalDigest(request) });
}

async function readProductionReview({ github, runId }) {
  const environment = await github.request("GET", "/environments/Production");
  const rules = environment.protection_rules ?? [];
  const review = rules.find((rule) => rule.type === "required_reviewers");
  requireCondition(
    review?.prevent_self_review === false &&
      review.reviewers?.length === 1 &&
      review.reviewers[0].type === "User" &&
      review.reviewers[0].reviewer?.id === APPROVER_ID &&
      environment.can_admins_bypass === false,
    "PRODUCTION_PROTECTION_DRIFT",
  );
  requireCondition(
    environment.deployment_branch_policy?.protected_branches === false &&
      environment.deployment_branch_policy?.custom_branch_policies === true,
    "PRODUCTION_BRANCH_POLICY",
  );
  const branches = await github.request(
    "GET",
    "/environments/Production/deployment-branch-policies",
  );
  requireCondition(
    branches.total_count === 1 &&
      branches.branch_policies?.[0]?.name === "main" &&
      branches.branch_policies[0].type === "branch",
    "PRODUCTION_BRANCH_POLICY",
  );
  const history = await github.request("GET", `/actions/runs/${runId}/approvals`);
  const decisions = history.filter((item) =>
    item.environments?.some((entry) => entry.id === environment.id && entry.name === "Production"),
  );
  requireCondition(
    decisions.length === 1 &&
      decisions[0].state === "approved" &&
      decisions[0].user?.id === APPROVER_ID,
    "PRODUCTION_APPROVAL_MISSING",
  );
  return Object.freeze({
    reviewerId: APPROVER_ID,
    environmentId: environment.id,
  });
}

function withinProducerRun(timestamp, run) {
  const value = Date.parse(timestamp);
  const started = Date.parse(run.run_started_at);
  const completed = Date.parse(run.updated_at);
  requireCondition(
    Number.isFinite(started) &&
      Number.isFinite(completed) &&
      started <= value &&
      value <= completed,
    "ARTIFACT_PRODUCER_TIME",
  );
}

/** Authenticates stage-only evidence. This cannot establish production eligibility. */
export async function loadStagingQualification({ github, stagingRunId, artifactId, now }) {
  const run = await github.request("GET", `/actions/runs/${requireId(stagingRunId)}`);
  trustedRun(run, { path: WORKFLOWS.staging, event: "workflow_dispatch", sha: run.head_sha });
  const { value, metadata } = await pinnedArtifact({
    github,
    artifactId,
    run,
    name: `minted-staging-qualification-${run.id}-${run.run_attempt}`,
    filename: "staging-qualification.json",
  });
  requireCondition(
    value !== null &&
      typeof value === "object" &&
      Object.keys(value).length === 2 &&
      Object.hasOwn(value, "qualification") &&
      Object.hasOwn(value, "sourceCiRunId"),
    "QUALIFICATION_SHAPE",
  );
  const { qualification, sourceCiRunId } = value;
  const verified = assertStagingQualification(qualification, { now });
  requireCondition(
    verified.workflow.runId === stagingRunId &&
      verified.workflow.runAttempt === run.run_attempt &&
      verified.workflow.sha === run.head_sha,
    "RECORD_PRODUCER",
  );
  withinProducerRun(qualification.preflight.validatedAt, run);
  withinProducerRun(verified.recordedAt, run);
  await admitSuccessfulMain({ github, runId: sourceCiRunId, sha: verified.source.sha });
  return {
    qualification,
    ...verified,
    artifactId: metadata.id,
    artifactDigest: metadata.digest,
    stagingRunId,
    productionEligibility: "NOT_EVALUATED",
  };
}

/** Reads an authenticated, previously recorded baseline; never a live production observation. */
export async function loadProductionBaselineAttestation({
  github,
  runId,
  artifactId,
  artifactDigest,
  now,
}) {
  requireCondition(/^sha256:[a-f0-9]{64}$/.test(artifactDigest), "BASELINE_ARTIFACT_PIN_REQUIRED");
  const run = await github.request("GET", `/actions/runs/${requireId(runId)}`);
  trustedRun(run, { path: WORKFLOWS.production, event: "workflow_dispatch", sha: run.head_sha });
  requireCondition(run.run_attempt === 1, "FRESH_APPROVAL_RUN_REQUIRED");
  const review = await readProductionReview({ github, runId });
  const { value, metadata } = await pinnedArtifact({
    github,
    artifactId,
    run,
    name: `minted-production-baseline-${runId}-1`,
    filename: "production-baseline.json",
    digest: artifactDigest,
  });
  const verified = assertProductionBaselineAttestation(value, { now });
  requireCondition(
    value.workflow.runId === runId && value.workflow.sha === run.head_sha,
    "RECORD_PRODUCER",
  );
  withinProducerRun(value.recordedAt, run);
  return {
    attestation: value,
    ...verified,
    ...review,
    artifactId: metadata.id,
    artifactDigest: metadata.digest,
    runId,
    productionEligibility: "NOT_EVALUATED",
  };
}

export async function loadApprovalRequest({
  github,
  runId,
  workflowSha,
  artifactId,
  artifactDigest,
  now = new Date().toISOString(),
}) {
  requireCondition(/^sha256:[a-f0-9]{64}$/.test(artifactDigest), "APPROVAL_ARTIFACT_PIN_REQUIRED");
  const run = await github.request("GET", `/actions/runs/${requireId(runId)}`);
  trustedRun(run, {
    path: WORKFLOWS.production,
    event: "workflow_dispatch",
    sha: workflowSha,
    completed: false,
  });
  requireCondition(run.run_attempt === 1, "FRESH_APPROVAL_RUN_REQUIRED");
  const { value } = await pinnedArtifact({
    github,
    artifactId,
    run,
    name: `minted-approval-${runId}-1`,
    filename: "approval-request.json",
    digest: artifactDigest,
  });
  assertApprovalIntent(value, { now });
  requireCondition(
    Number.isFinite(Date.parse(run.run_started_at)) &&
      Date.parse(run.run_started_at) <= Date.parse(value.preparedAt),
    "ARTIFACT_PRODUCER_TIME",
  );
  requireCondition(
    value.runId === runId && value.workflowSha === workflowSha && value.runAttempt === 1,
    "APPROVAL_BINDING",
  );
  return value;
}

/** GitHub-only preparation: no production collector or production credentials are accepted. */
export async function prepareProductionApproval({
  github,
  stagingRunId,
  stagingArtifactId,
  baselineRunId,
  baselineArtifactId,
  baselineArtifactDigest,
  runId,
  runAttempt,
  workflowSha,
  now,
}) {
  requireCondition(runAttempt === 1, "FRESH_APPROVAL_RUN_REQUIRED");
  const run = await github.request("GET", `/actions/runs/${requireId(runId)}`);
  trustedRun(run, {
    path: WORKFLOWS.production,
    event: "workflow_dispatch",
    sha: workflowSha,
    completed: false,
  });
  requireCondition(run.run_attempt === 1 && run.status === "in_progress", "APPROVAL_RUN_STATE");
  requireCondition(
    Number.isFinite(Date.parse(run.run_started_at)) &&
      Date.parse(run.run_started_at) <= Date.parse(now),
    "ARTIFACT_PRODUCER_TIME",
  );
  const staging = await loadStagingQualification({
    github,
    stagingRunId,
    artifactId: stagingArtifactId,
    now,
  });
  const baseline = await loadProductionBaselineAttestation({
    github,
    runId: baselineRunId,
    artifactId: baselineArtifactId,
    artifactDigest: baselineArtifactDigest,
    now,
  });
  return approvalSummary({ staging, baseline, runId, runAttempt, workflowSha, now });
}
