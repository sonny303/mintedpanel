import { readFile } from "node:fs/promises";
import { runLocalAlignmentRehearsal } from "./staging-alignment-local-rehearsal.mjs";
import { canonicalDigest } from "./contract.mjs";

const workspace = "/Users/ar/Codex-Minted/staging-recovery-fresh-20260924-4oF4BR";
try {
  if (process.argv.length !== 2) throw Error("ARGUMENTS_REJECTED");
  const qualificationReceipt = `${workspace}/application-baseline.json`;
  const qualified = JSON.parse(await readFile(qualificationReceipt, "utf8"));
  if (
    canonicalDigest(qualified) !==
    "d0171353c3a1c18a832f8b81b639d79d13f210f9a3c34095d8d7b9488c84506b"
  )
    throw Error("QUALIFICATION_DIGEST_REJECTED");
  const result = await runLocalAlignmentRehearsal({
    qualificationReceipt,
    target: {
      runId: "6715aa4a0f245dc4",
      containerId: "581afff54fa0479785d736848200a690b4d3b6c87d2b911c5bbb1e790c472c6e",
      systemIdentifier: "7689124870789845031",
    },
    untouchedBaseline: {
      runId: "775640d53985dcdc",
      containerId: "7d20268b9b8ad829dd494948498c284c40d168d8ceef3e865da980f7344dbcd4",
      systemIdentifier: "7689124825780498471",
    },
    receiptPath: `${workspace}/alignment-slices-1-5-6715aa4a0f245dc4.json`,
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
