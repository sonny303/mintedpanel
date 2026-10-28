// The practice consent text the provider signs before the form (canvas board
// 5). Per-practice text and its storage are open (r1-ui-spec Q1); until then
// every practice shows this version with its name merged in.
// Version 1. {practiceName} is the merge field.
export const CONSENT = {
  version: 1,
  paragraphs: [
    "We at {practiceName} recognize the challenges of maintaining your NPI, PECOS File, and CAQH File. As a benefit to our new employees and existing staff, we would like to extend our services to you to maintain your NPI and your PECOS and CAQH file. This includes the 120 day re-attestation by CAQH. We request that you provide us with your NPI and CAQH and PECOS login. Upon receipt of your User Name & Password we will only make necessary changes to reflect your current employment status.",
    "By signing below, you will be giving your consent for us to provide any information needed to complete all insurance credentialing. Without this, we cannot enroll/update you in the necessary programs; thus denying us the ability to receive reimbursement for services you rendered to Medicare and Commercial patients. Your cooperation in providing this information is vital to all parties involved and is most appreciated.",
  ],
};

export function consentParagraphs(practiceName: string): string[] {
  return CONSENT.paragraphs.map((p) => p.replaceAll("{practiceName}", practiceName));
}
