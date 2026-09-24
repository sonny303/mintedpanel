import { readFile } from "node:fs/promises";
import { runLocalAlignmentRehearsal } from "./staging-alignment-local-rehearsal.mjs";
import { canonicalDigest } from "./contract.mjs";

const workspace = "/Users/ar/Codex-Minted/staging-recovery-acl-20260924-vD8bsl";
try {
  if (process.argv.length !== 2) throw Error("ARGUMENTS_REJECTED");
  const qualificationReceipt = `${workspace}/application-baseline.json`;
  const qualified = JSON.parse(await readFile(qualificationReceipt, "utf8"));
  if (
    canonicalDigest(qualified) !==
    "b4f73c3f4a37d349b4dc886b506e5f0520fa052dcf52ffaf5d80de63a5cfc5df"
  )
    throw Error("QUALIFICATION_DIGEST_REJECTED");
  const result = await runLocalAlignmentRehearsal({
    qualificationReceipt,
    target: {
      runId: "1e65c046d5fd0fec",
      containerId: "9fb878f8776e684b8ce2c97f17fcb7d6c6e5d8cb1da797152686ba807ad4f88c",
      systemIdentifier: "7689139001490436135",
    },
    untouchedBaseline: {
      runId: "775640d53985dcdc",
      containerId: "7d20268b9b8ad829dd494948498c284c40d168d8ceef3e865da980f7344dbcd4",
      systemIdentifier: "7689124825780498471",
    },
    receiptPath: `${workspace}/alignment-slices-1-5-1e65c046d5fd0fec.json`,
  });
  process.stdout.write(JSON.stringify(result) + "\n");
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      status: "BLOCKED",
      code: /^[A-Z_]+$/.test(error?.message) ? error.message : "LOCAL_REHEARSAL_FAILED",
    }) + "\n",
  );
  process.exitCode = 2;
}
