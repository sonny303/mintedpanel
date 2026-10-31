import { describe, expect, it } from "vitest";
import {
  auditActionLabel,
  auditEntityLabel,
  auditFieldLabel,
  humanizeAuditKey,
} from "./auditLabels";

describe("auditActionLabel", () => {
  it("labels every action the ledger writes", () => {
    expect(auditActionLabel("CREATE")).toBe("Created");
    expect(auditActionLabel("UPDATE")).toBe("Updated");
    expect(auditActionLabel("DELETE")).toBe("Deleted");
    expect(auditActionLabel("STATUS_CHANGE")).toBe("Status changed");
    expect(auditActionLabel("TOUCH_LOGGED")).toBe("Touch logged");
    expect(auditActionLabel("TERMINATION")).toBe("Terminated");
    expect(auditActionLabel("READ")).toBe("Viewed");
  });

  it("humanizes an action it has no label for", () => {
    expect(auditActionLabel("BULK_EXPORT")).toBe("Bulk export");
  });
});

describe("auditEntityLabel", () => {
  it("keeps the two case entity types tellable apart", () => {
    expect(auditEntityLabel("case")).toBe("Case");
    expect(auditEntityLabel("credential_case")).toBe("Credentialing case");
  });

  it("humanizes snake_case entity types, acronyms included", () => {
    expect(auditEntityLabel("task")).toBe("Task");
    expect(auditEntityLabel("sop_template_draft")).toBe("SOP template draft");
    expect(auditEntityLabel("provider_ssn_vault")).toBe("Provider SSN vault");
  });
});

describe("auditFieldLabel", () => {
  it("humanizes camelCase keys from app services", () => {
    expect(auditFieldLabel("caseId")).toBe("Case ID");
    expect(auditFieldLabel("taskIds")).toBe("Task IDs");
    expect(auditFieldLabel("dueDate")).toBe("Due date");
    expect(auditFieldLabel("sopTemplateId")).toBe("SOP template ID");
  });

  it("humanizes RPC row snapshot keys once camelized", () => {
    expect(auditFieldLabel("caseStatus")).toBe("Case status");
    expect(auditFieldLabel("credentialingStatusId")).toBe("Credentialing status ID");
    expect(auditFieldLabel("npi")).toBe("NPI");
  });

  it("prefers the label map over the humanized form", () => {
    expect(auditFieldLabel("orgId")).toBe("Organization ID");
    expect(auditFieldLabel("ssnLast4")).toBe("SSN (last 4)");
    expect(auditFieldLabel("removedReason")).toBe("Removal reason");
  });
});

describe("humanizeAuditKey", () => {
  it("returns a blank or underscore-only key unchanged", () => {
    expect(humanizeAuditKey("")).toBe("");
    expect(humanizeAuditKey("__")).toBe("__");
  });
});
