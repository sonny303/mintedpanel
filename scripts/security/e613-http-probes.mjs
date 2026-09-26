// E6.13 public-HTTP proof roundtrip, composed into the disposable E6.12 stack.
// All actors, document bytes, and enrollment identifiers are synthetic.
import { createHash } from "node:crypto";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function runE613HttpProbes({
  id,
  tokens,
  request,
  headers,
  assert,
  app,
  rest,
  anonKey,
  documentId,
  licensePdf,
  globalPayerId,
}) {
  const getContextRevision = async (token, audience, label = audience) => {
    const result = await request(app, "/api/me/access-context", { headers: headers(token) });
    assert(
      `e613.${label}_context_snapshot`,
      result.response.status === 200 &&
        typeof result.response.headers.get("x-minted-context-revision") === "string",
      `status_${result.response.status}`,
    );
    const contextRevision = result.response.headers.get("x-minted-context-revision");
    const selected = await request(app, "/api/me/access-context/select", {
      method: "POST",
      headers: headers(token, { "content-type": "application/json" }),
      body: JSON.stringify({ audience, orgId: id.orgA, contextRevision }),
    });
    assert(
      `e613.${label}_context_selected`,
      selected.response.status === 200 &&
        selected.body?.data?.selectedOrgId === id.orgA &&
        selected.body?.data?.audience === audience &&
        typeof selected.response.headers.get("x-minted-context-revision") === "string",
      `status_${selected.response.status}`,
    );
    return selected.response.headers.get("x-minted-context-revision");
  };
  const selectedHeaders = (token, audience, revision, extra = {}) =>
    headers(token, {
      "x-org-id": id.orgA,
      "x-enrollment-audience": audience,
      "x-minted-context-revision": revision,
      ...extra,
    });
  const jsonRequest = (token, audience, revision, body) => ({
    method: "POST",
    headers: selectedHeaders(token, audience, revision, { "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
  const staffRevision = await getContextRevision(tokens.admin, "staff");
  const clientRevision = await getContextRevision(tokens.clientActive, "client");
  const noGrantRevision = await getContextRevision(
    tokens.clientNoGrant,
    "client",
    "client_no_grant",
  );

  const product = await request(
    app,
    "/api/enrollment-explorer/products",
    jsonRequest(tokens.admin, "staff", staffRevision, {
      payerId: globalPayerId,
      productKey: "e613-http-state-license",
      displayName: "E613 HTTP State License Fixture",
      isActive: true,
    }),
  );
  assert(
    "e613.product_create",
    product.response.status === 201 && typeof product.body?.data?.productId === "string",
    `status_${product.response.status}`,
  );
  const productId = product.body.data.productId;

  const target = await request(
    app,
    "/api/enrollment-explorer/targets",
    jsonRequest(tokens.admin, "staff", staffRevision, {
      groupId: id.groupA1,
      payerProductId: productId,
      state: "KS",
      isActive: true,
    }),
  );
  assert(
    "e613.group_product_target_create",
    target.response.status === 201 && typeof target.body?.data?.targetId === "string",
    `status_${target.response.status}`,
  );

  const saved = await request(
    app,
    "/api/enrollment-explorer/scopes",
    jsonRequest(tokens.admin, "staff", staffRevision, {
      providerId: id.provider,
      groupId: id.groupA1,
      payerProductId: productId,
      facilityId: id.facilityA,
      state: "KS",
      revision: {
        status: "submitted",
        owner: "Payer",
        retroStatus: "unknown",
        submittedDate: "2026-09-25",
        payerReference: "E613-HTTP-1",
        observedAt: new Date().toISOString(),
      },
      sources: [],
    }),
  );
  assert(
    "e613.scope_revision_save",
    saved.response.status === 201 &&
      typeof saved.body?.data?.scopeId === "string" &&
      typeof saved.body?.data?.revisionId === "string",
    `status_${saved.response.status}`,
  );
  const { scopeId, revisionId } = saved.body.data;

  const summary = await request(
    app,
    `/api/enrollment-explorer/scopes/${scopeId}/summary`,
    jsonRequest(tokens.admin, "staff", staffRevision, { revisionId }),
  );
  assert(
    "e613.summary_publish",
    summary.response.status === 201 && typeof summary.body?.data?.publicationId === "string",
    `status_${summary.response.status}`,
  );

  const proofDigest = digest(licensePdf);
  const proof = await request(
    app,
    "/api/enrollment-explorer/proofs",
    jsonRequest(tokens.admin, "staff", staffRevision, {
      scopeId,
      revisionId,
      documentVersionId: documentId,
      evidenceKind: "license_psv",
      supportedFields: ["license_current"],
      reason: "Validated synthetic state license fixture",
    }),
  );
  assert(
    "e613.proof_publish_actual_bytes_sha256",
    proof.response.status === 201 &&
      proof.body?.data?.sha256 === proofDigest &&
      typeof proof.body?.data?.publicationId === "string",
    `status_${proof.response.status}`,
  );
  const publicationId = proof.body.data.publicationId;

  const clientHeaders = selectedHeaders(tokens.clientActive, "client", clientRevision);
  const detail = await request(app, `/api/enrollment-explorer/scopes/${scopeId}`, {
    headers: clientHeaders,
  });
  const detailJson = JSON.stringify(detail.body?.data ?? null);
  assert(
    "e613.client_safe_published_detail",
    detail.response.status === 200 &&
      detail.body?.data?.status === "submitted" &&
      detail.body?.data?.payerReference === "E613-HTTP-1" &&
      detail.body?.data?.proofs?.some((item) => item.publicationId === publicationId) &&
      !detailJson.includes(documentId) &&
      !detailJson.includes(proofDigest) &&
      !detailJson.includes("storagePath"),
    `status_${detail.response.status}`,
  );

  const downloadPath = `/api/enrollment-explorer/proofs/${publicationId}/download`;
  const clientDownload = await request(app, downloadPath, { headers: clientHeaders });
  assert(
    "e613.client_download_proof_bytes_and_no_store",
    clientDownload.response.status === 200 &&
      clientDownload.text === licensePdf &&
      digest(clientDownload.text) === proofDigest &&
      clientDownload.response.headers.get("cache-control")?.includes("no-store") === true &&
      clientDownload.response.headers.get("content-type") === "application/octet-stream",
    `status_${clientDownload.response.status}`,
  );

  const noGrantHeaders = selectedHeaders(tokens.clientNoGrant, "client", noGrantRevision);
  const wrongGroupDetail = await request(app, `/api/enrollment-explorer/scopes/${scopeId}`, {
    headers: noGrantHeaders,
  });
  assert(
    "e613.no_grant_detail_denied",
    [403, 404].includes(wrongGroupDetail.response.status) && wrongGroupDetail.body?.data === null,
    `status_${wrongGroupDetail.response.status}`,
  );
  const wrongGroupDownload = await request(app, downloadPath, { headers: noGrantHeaders });
  assert(
    "e613.no_grant_download_returns_no_proof_bytes",
    [403, 404].includes(wrongGroupDownload.response.status) &&
      wrongGroupDownload.body?.data === null &&
      !wrongGroupDownload.text.includes(licensePdf) &&
      wrongGroupDownload.response.headers.get("content-type") !== "application/octet-stream",
    `status_${wrongGroupDownload.response.status}`,
  );

  const directRpc = await request(rest, "/rpc/authorize_enrollment_proof_download", {
    method: "POST",
    headers: headers(tokens.clientActive, { "content-type": "application/json" }),
    body: JSON.stringify({
      p_actor_user_id: id.clientActive,
      p_org_id: id.orgA,
      p_audience: "client",
      p_publication_id: publicationId,
    }),
  });
  const directRpcCode = directRpc.body?.code;
  const directRpcDenied =
    (directRpcCode === "42501" && [401, 403].includes(directRpc.response.status)) ||
    (directRpcCode === "PGRST202" && directRpc.response.status === 404);
  assert(
    "e613.direct_rpc_denied_without_proof_material",
    directRpcDenied &&
      !directRpc.text.includes(documentId) &&
      !directRpc.text.includes(proofDigest) &&
      !directRpc.text.includes("storagePath"),
    `status_${directRpc.response.status}`,
  );

  const revoked = await request(
    app,
    `/api/enrollment-explorer/publications/${publicationId}/revoke`,
    jsonRequest(tokens.admin, "staff", staffRevision, {
      reason: "E613 HTTP probe completed",
    }),
  );
  assert(
    "e613.proof_revoke",
    revoked.response.ok &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        revoked.body?.data?.eventId ?? "",
      ),
    `status_${revoked.response.status}`,
  );
  const revokedDownload = await request(app, downloadPath, { headers: clientHeaders });
  assert(
    "e613.revoked_download_returns_no_proof_bytes",
    [403, 404].includes(revokedDownload.response.status) &&
      revokedDownload.body?.data === null &&
      !revokedDownload.text.includes(licensePdf) &&
      !revokedDownload.text.includes(proofDigest) &&
      revokedDownload.response.headers.get("content-type") !== "application/octet-stream",
    `status_${revokedDownload.response.status}`,
  );

  process.stdout.write("E613|HTTP|PASS\n");
}
