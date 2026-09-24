# Operational Runbook: Automated Nightly Backups to Google Cloud Storage (GCS)

This runbook covers the architecture, one-time setup, secrets configuration, verification, and disaster recovery procedures for the automated nightly backup system of the `mintedpanel` repository and database.

---

## 1. Overview & Schedule

| Property                | Value                                                                                                                                      |
| :---------------------- | :----------------------------------------------------------------------------------------------------------------------------------------- |
| **Schedule**            | Every night at **04:00 UTC** (off-peak hours)                                                                                              |
| **Trigger**             | GitHub Actions Cron + Manual Dispatch (production only)                                                                                    |
| **GitHub Environment**  | `Production Backup`                                                                                                                        |
| **Target Environment**  | `production` (fixed in the workflow; staging is not a hosted workflow target)                                                              |
| **Workflow**            | [`.github/workflows/scheduled-backup.yml`](file:///Users/ar/gemini/antigravity/scratch/mintedpanel/.github/workflows/scheduled-backup.yml) |
| **Coordinator Script**  | [`scripts/backup/nightly-backup.mjs`](file:///Users/ar/gemini/antigravity/scratch/mintedpanel/scripts/backup/nightly-backup.mjs)           |
| **Provisioning Script** | [`scripts/backup/provision-gcs-backup.sh`](file:///Users/ar/gemini/antigravity/scratch/mintedpanel/scripts/backup/provision-gcs-backup.sh) |
| **Repo Backup**         | Full Git bundle (`git bundle create --all`) + SHA-256 verification                                                                         |
| **Database Backup**     | `pg_dump` custom format streamed through client-side `age` encryption                                                                      |
| **Storage Destination** | Google Cloud Storage: `gs://<GCS_BACKUP_BUCKET>/backups/YYYY-MM-DD/`                                                                       |
| **Authentication**      | Keyless OIDC via GCP Workload Identity Federation (WIF)                                                                                    |

---

## 2. One-Time Setup (2 Minutes in Google Cloud)

You do **not** need to install `gcloud` on your local computer. You can run the entire configuration using Google's free in-browser terminal (**Google Cloud Shell**).

### Step 1: Open Google Cloud Console

1. Navigate to **[console.cloud.google.com](https://console.cloud.google.com/)** and sign in with your Google account.
2. Accept the Terms of Service. If this is a new GCP account, activate the free trial ($300 credits).
3. Create a project (e.g. `mintedpanel-cloud`) or note your active Project ID.

### Step 2: Open Cloud Shell & Run Provisioning Script

1. Click the **Activate Cloud Shell** icon (`>_`) in the top navigation bar of Google Cloud Console (or visit [console.cloud.google.com/?cloudshell=true](https://console.cloud.google.com/?cloudshell=true)).
2. In the terminal window, paste and run:
   ```bash
   curl -sSL https://raw.githubusercontent.com/sonny303/mintedpanel/main/scripts/backup/provision-gcs-backup.sh | bash
   ```
   _(Or if running before pushing to main, paste the script content directly)._
3. The script will automatically:
   - Enable Cloud Storage, IAM Credentials, and Security Token Service APIs.
   - Create a hardened GCS bucket (`UBLA` enabled, `PAP` enforced, 7-day soft-delete).
   - Configure Object Lifecycle Management (auto-archive to Nearline at 30 days, auto-delete at 90 days).
   - Create a dedicated Service Account (`sa-github-backups`).
   - Create the Workload Identity Pool and Provider bound to `sonny303/mintedpanel`.
   - Print the exact 3 secrets to copy to GitHub.

---

## 3. Generate Encryption Keypair (`age`)

Database dumps are encrypted client-side using `age` so that plaintext database data never touches Google Cloud Storage unencrypted.

1. **Generate the keypair** (run locally or in a terminal):
   ```bash
   # On macOS: brew install age
   # On Linux: sudo apt-get install age
   age-keygen -o backup-identity.txt
   ```
2. **Inspect the output**:
   ```
   # Public key: age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p
   AGE-SECRET-KEY-1...
   ```
3. **Save keys**:
   - **Public Key** (`age1...`): Add to GitHub Secrets as `BACKUP_AGE_RECIPIENT`.
   - **Private Key file** (`backup-identity.txt`): Save in your password manager (e.g., 1Password, Bitwarden, or encrypted USB). **Do not commit this file to Git.**

---

## 4. Required GitHub Secrets

Add the repository-level values in **GitHub Repository Settings > Secrets and variables > Actions** (`https://github.com/sonny303/mintedpanel/settings/secrets/actions`). Add `SUPABASE_PRODUCTION_BACKUP_DATABASE_URL` under **Settings > Environments > Production Backup** so the scheduled job can read it only after that environment's protection rules pass:

| Secret Name                               | Source / Description                                                                                                           |
| :---------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER`          | Output by provisioning script (e.g. `projects/.../locations/global/workloadIdentityPools/.../providers/...`)                   |
| `GCP_SERVICE_ACCOUNT`                     | Output by provisioning script (`sa-github-backups@<PROJECT>.iam.gserviceaccount.com`)                                          |
| `GCS_BACKUP_BUCKET`                       | Output by provisioning script (e.g. `mintedpanel-backups-<PROJECT>`)                                                           |
| `BACKUP_AGE_RECIPIENT`                    | The public age key (`age1...`)                                                                                                 |
| `SUPABASE_PRODUCTION_BACKUP_DATABASE_URL` | The existing production PostgreSQL URL for the fixed `postgres` database, supplied only in the `Production Backup` environment |

The scheduled workflow reads only `SUPABASE_PRODUCTION_BACKUP_DATABASE_URL` from the protected `Production Backup` GitHub Environment. The workflow has no staging target and does not read a repository-level Supabase token, `SUPABASE_NIGHTLYBACKUP_ACCESS_TOKEN`, or `DATABASE_URL`. Local or staging tooling may pass an explicit database URL or management token to the coordinator function; the production environment URL is never used for staging.

### Owner-controlled activation order

Complete these steps in order:

1. Configure the `Production Backup` GitHub Environment with the `main` branch as its only selected deployment branch. Set required reviewers to none and the wait timer to zero minutes.
2. Before the owner merges this change, re-enter the existing production database URL once as the uniquely named environment secret `SUPABASE_PRODUCTION_BACKUP_DATABASE_URL`.
3. Merge the approved branch to `main`.
4. From the actual merged `main` commit, run one non-dry production backup with repository and database backup enabled.
5. Confirm the run succeeds against the production ref, uploads one encrypted database artifact to the expected GCS path, and records the target identity and ciphertext SHA-256 digest in `capture.json` and the workflow summary.
6. Only after that proof, delete the legacy repository secrets `DATABASE_URL` and `SUPABASE_NIGHTLYBACKUP_ACCESS_TOKEN`, then verify both repository secrets are absent.

---

## 5. Storage Structure in Google Cloud Storage

Every night, artifacts are archived to:

```
gs://<BUCKET_NAME>/backups/<YYYY-MM-DD>/
├── repo/
│   ├── mintedpanel-repo-production-<TIMESTAMP>-<SHA>.bundle
│   ├── mintedpanel-repo-production-<TIMESTAMP>-<SHA>.bundle.sha256
│   └── manifest.json
├── database/
│   ├── mintedpanel-db-production-<TIMESTAMP>-<REF>.dump.age
│   └── capture.json
└── summary.json
```

### Automatic Lifecycle Rules:

- **0–30 Days**: Standard Storage (immediate access).
- **30–90 Days**: Automatically transitions to **Nearline** storage (reduced cost).
- **90+ Days**: Automatically deleted to prevent unbounded storage costs.

---

## 6. Disaster Recovery Procedures

### Scenario A: Restoring the Git Repository

If GitHub is unavailable or history needs to be restored to an exact point in time:

```bash
# 1. Download bundle from GCS
gcloud storage cp gs://<GCS_BACKUP_BUCKET>/backups/2026-09-23/repo/* .

# 2. Verify SHA-256 integrity
sha256sum -c mintedpanel-repo-production-*.bundle.sha256

# 3. Clone fresh repository directly from bundle
git clone mintedpanel-repo-production-*.bundle restored-mintedpanel

# 4. Enter and inspect branches/tags
cd restored-mintedpanel
git status
git log -n 5
```

### Scenario B: Restoring the Database

To restore a database dump into a local or staging PostgreSQL instance:

```bash
# 1. Download encrypted dump from GCS
gcloud storage cp gs://<GCS_BACKUP_BUCKET>/backups/2026-09-23/database/* .

# 2. Decrypt with your private age key
age --decrypt -i backup-identity.txt \
  -o restored-database.dump \
  mintedpanel-db-production-*.dump.age

# 3. Restore to target PostgreSQL instance using pg_restore
pg_restore \
  -h localhost \
  -p 5432 \
  -U postgres \
  -d postgres \
  --clean \
  --if-exists \
  restored-database.dump

# 4. Clean up decrypted dump immediately
rm -f restored-database.dump
```

---

## 7. Verification & Dry-Run Testing

You can trigger a dry-run test at any time without uploading to Google Cloud:

1. In GitHub, go to **Actions** > **Scheduled Nightly Backup (GCS)**.
2. Click **Run workflow**.
3. Check the **Dry Run** box and click **Run workflow**.
4. The workflow will validate the runner environment, generate and verify the git bundle, verify metadata manifests, and report the execution table in the summary.
