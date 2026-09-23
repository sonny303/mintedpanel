#!/usr/bin/env bash
# ==============================================================================
# Google Cloud Storage & Workload Identity Federation Provisioning Script
# Project: Minted Panel Automated Nightly Backups
#
# Usage:
#   1. Open Google Cloud Shell: https://console.cloud.google.com/?cloudshell=true
#   2. Paste and run this script, or run:
#      bash scripts/backup/provision-gcs-backup.sh
# ==============================================================================

set -euo pipefail

# Metrics attribution for Google Cloud Storage skill guidelines
export CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }gcs-skills gcs-skills/1.0 (skill:google-cloud-storage-bucket-architect)"

echo "=== Minted Panel GCS Backup Provisioning ==="

# 1. Resolve Project ID
CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null || true)
if [[ -z "${CURRENT_PROJECT}" || "${CURRENT_PROJECT}" == "(unset)" ]]; then
  read -r -p "Enter your Google Cloud Project ID: " GCP_PROJECT_ID
  gcloud config set project "${GCP_PROJECT_ID}"
else
  GCP_PROJECT_ID="${CURRENT_PROJECT}"
  echo "Using active GCP project: ${GCP_PROJECT_ID}"
fi

PROJECT_NUMBER=$(gcloud projects describe "${GCP_PROJECT_ID}" --format="value(projectNumber)")
echo "GCP Project Number: ${PROJECT_NUMBER}"

# 2. Configuration Variables
GCS_REGION="${GCS_REGION:-us-central1}"
BUCKET_NAME="${BUCKET_NAME:-mintedpanel-backups-${GCP_PROJECT_ID}}"
POOL_NAME="github-actions-pool"
PROVIDER_NAME="github-actions-provider"
SERVICE_ACCOUNT="sa-github-backups"
SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
GITHUB_REPO="sonny303/mintedpanel"

echo "Configuration:"
echo "  - Region:                ${GCS_REGION}"
echo "  - Bucket:                gs://${BUCKET_NAME}"
echo "  - Workload Identity Pool: ${POOL_NAME}"
echo "  - Service Account:       ${SERVICE_ACCOUNT_EMAIL}"
echo "  - GitHub Repository:     ${GITHUB_REPO}"
echo ""

# 3. Enable Required APIs
echo "--> Enabling required GCP APIs..."
gcloud services enable \
  storage.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  --project="${GCP_PROJECT_ID}"

# 4. Create GCS Bucket with Security Hardening
echo "--> Creating hardened Google Cloud Storage bucket..."
if gcloud storage buckets describe "gs://${BUCKET_NAME}" &>/dev/null; then
  echo "Bucket gs://${BUCKET_NAME} already exists."
else
  gcloud storage buckets create "gs://${BUCKET_NAME}" \
    --project="${GCP_PROJECT_ID}" \
    --location="${GCS_REGION}" \
    --default-storage-class=STANDARD \
    --uniform-bucket-level-access \
    --public-access-prevention
fi

# Enable soft-delete retention (7 days default)
gcloud storage buckets update "gs://${BUCKET_NAME}" \
  --soft-delete-duration=7d 2>/dev/null || true

# 5. Apply Object Lifecycle Management (Auto-pruning and storage tiering)
echo "--> Configuring Object Lifecycle Management..."
LIFECYCLE_CONFIG=$(mktemp)
cat <<EOF > "${LIFECYCLE_CONFIG}"
{
  "rule": [
    {
      "action": {"type": "SetStorageClass", "storageClass": "NEARLINE"},
      "condition": {"age": 30, "matchesPrefix": ["backups/"]}
    },
    {
      "action": {"type": "Delete"},
      "condition": {"age": 90, "matchesPrefix": ["backups/"]}
    },
    {
      "action": {"type": "Delete"},
      "condition": {"daysSinceNoncurrentTime": 14}
    }
  ]
}
EOF

gcloud storage buckets update "gs://${BUCKET_NAME}" \
  --lifecycle-file="${LIFECYCLE_CONFIG}"
rm -f "${LIFECYCLE_CONFIG}"

# 6. Create Service Account for GitHub Actions
echo "--> Configuring Service Account..."
if ! gcloud iam service-accounts describe "${SERVICE_ACCOUNT_EMAIL}" --project="${GCP_PROJECT_ID}" &>/dev/null; then
  gcloud iam service-accounts create "${SERVICE_ACCOUNT}" \
    --display-name="GitHub Actions Automated Backup Worker" \
    --description="Service account for automated nightly repository and database backup uploads" \
    --project="${GCP_PROJECT_ID}"
else
  echo "Service account ${SERVICE_ACCOUNT_EMAIL} already exists."
fi

# Grant bucket-scoped permissions (Least Privilege Object User: create, view, overwrite within bucket)
echo "--> Granting bucket permissions to Service Account..."
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET_NAME}" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/storage.objectUser" > /dev/null

# 7. Setup Workload Identity Federation (WIF)
echo "--> Configuring Workload Identity Federation (Keyless OIDC)..."

# Create Pool
if ! gcloud iam workload-identity-pools describe "${POOL_NAME}" --location="global" --project="${GCP_PROJECT_ID}" &>/dev/null; then
  gcloud iam workload-identity-pools create "${POOL_NAME}" \
    --location="global" \
    --display-name="GitHub Actions Pool" \
    --description="Workload Identity Pool for GitHub Actions workflows" \
    --project="${GCP_PROJECT_ID}"
fi

# Create OIDC Provider
if ! gcloud iam workload-identity-pools providers describe "${PROVIDER_NAME}" --workload-identity-pool="${POOL_NAME}" --location="global" --project="${GCP_PROJECT_ID}" &>/dev/null; then
  gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_NAME}" \
    --workload-identity-pool="${POOL_NAME}" \
    --location="global" \
    --display-name="GitHub Actions Provider" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
    --attribute-condition="assertion.repository == '${GITHUB_REPO}'" \
    --project="${GCP_PROJECT_ID}"
fi

# Bind GitHub Repository to Service Account
WIF_PRINCIPAL="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_NAME}/attribute.repository/${GITHUB_REPO}"
echo "--> Binding Workload Identity to Service Account..."
gcloud iam service-accounts add-iam-policy-binding "${SERVICE_ACCOUNT_EMAIL}" \
  --project="${GCP_PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="${WIF_PRINCIPAL}" > /dev/null

WIF_PROVIDER_RESOURCE="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_NAME}/providers/${PROVIDER_NAME}"

# 8. Output GitHub Secrets
echo ""
echo "=============================================================================="
echo "                   SUCCESS! GCP PROVISIONING COMPLETE"
echo "=============================================================================="
echo "Add the following secrets to your GitHub repository:"
echo "GitHub Repo: https://github.com/${GITHUB_REPO}/settings/secrets/actions"
echo ""
echo "1. GCP_WORKLOAD_IDENTITY_PROVIDER"
echo "   ${WIF_PROVIDER_RESOURCE}"
echo ""
echo "2. GCP_SERVICE_ACCOUNT"
echo "   ${SERVICE_ACCOUNT_EMAIL}"
echo ""
echo "3. GCS_BACKUP_BUCKET"
echo "   ${BUCKET_NAME}"
echo "=============================================================================="
