import test from "node:test";
import assert from "node:assert/strict";
import { captureLiveStagingBackup } from "./live-backup.mjs";

const recipient = `age1${"q".repeat(58)}`;

test("coordinator acquires one login in memory and persists only sanitized evidence", async () => {
  const calls = [];
  let saved;
  const result = await captureLiveStagingBackup(
    { workspace: "/private/tmp/recovery", recipient },
    {
      loadToken: async () => {
        calls.push("token");
        return "private-token";
      },
      observe: async ({ token }) => {
        assert.equal(token, "private-token");
        calls.push("observe");
        return {
          capturedAt: "2026-09-19T04:00:00.000Z",
          source: {
            ref: "vmznysvietfaddakkegt",
            host: "aws-0-ca-central-1.pooler.supabase.com",
            port: 5432,
            database: "postgres",
            serverVersion: "17.6",
            schemaDigest: "a".repeat(64),
            lineageDigest: "b".repeat(64),
          },
          providerDigest: "c".repeat(64),
        };
      },
      withLogin: async ({ token, operation }) => {
        assert.equal(token, "private-token");
        calls.push("lifecycle");
        const credentials = {
          requestedAt: "2026-09-19T04:00:01.000Z",
          receivedAt: "2026-09-19T04:00:02.000Z",
          response: { role: "cli_login_h10", password: "private-password", ttl_seconds: 900 },
        };
        return {
          output: await operation(credentials),
          lifecycle: {
            prestateRequestedAt: "2026-09-19T04:00:00.000Z",
            prestateReceivedAt: "2026-09-19T04:00:00.100Z",
            prestateInventoryDigest: "d".repeat(64),
            loginRequestedAt: credentials.requestedAt,
            loginReceivedAt: credentials.receivedAt,
            deleteRequestedAt: "2026-09-19T04:00:03.000Z",
            deleteReceivedAt: "2026-09-19T04:00:03.100Z",
            verifiedAt: "2026-09-19T04:00:03.200Z",
            roleDigest: "e".repeat(64),
            poststateInventoryDigest: "d".repeat(64),
          },
        };
      },
      capture: async (options) => {
        calls.push("capture");
        assert.equal(options.response.password, "private-password");
        return { status: "CAPTURED_ONLY", artifacts: [{ name: "backup" }] };
      },
      save: async (path, value, options) => {
        calls.push("save");
        saved = { path, value, options };
      },
    },
  );
  assert.deepEqual(calls, ["token", "observe", "lifecycle", "capture", "save"]);
  assert.equal(result.providerDigest, "c".repeat(64));
  assert.equal(saved.path, "/private/tmp/recovery/capture.json");
  assert.deepEqual(saved.options, { encoding: "utf8", flag: "wx", mode: 0o600 });
  assert.ok(!saved.value.includes("private-token"));
  assert.ok(!saved.value.includes("private-password"));
});
