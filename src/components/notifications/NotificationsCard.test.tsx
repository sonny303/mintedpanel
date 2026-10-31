// MINT-107 component tests. The repo has no DOM test environment (no jsdom or
// testing-library), so like every other component test here these render to
// static markup with mocked hooks. The editor and the cc list hold no state
// of their own, so "edit and save" is driven by calling their real handlers
// from the rendered element tree; the full click-through runs in
// e2e/notification-sequences.spec.ts.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  starterDraft,
  validateDraft,
  type CcMemberOption,
  type NotificationSequenceConfig,
  type SequenceDraft,
  type StepDraft,
} from "@/lib/notificationSequences";

const state = vi.hoisted(() => ({
  isAdmin: true,
  sequences: {} as Record<string, unknown>,
  isLoading: false,
  isError: false,
  members: [] as unknown[],
  mutate: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({ useIsAdmin: () => state.isAdmin }));
vi.mock("@/hooks/useNotificationSequences", () => ({
  useNotificationSequences: () => ({
    data: state.sequences,
    isLoading: state.isLoading,
    isError: state.isError,
  }),
  useSaveNotificationSequence: () => ({ mutate: state.mutate, isPending: false }),
}));
vi.mock("@/hooks/useOrgSettings", () => ({
  useMemberships: () => ({ data: state.members }),
}));

import { NotificationCcRecipients } from "./NotificationCcRecipients";
import {
  NotificationSequenceEditor,
  type NotificationSequenceEditorProps,
} from "./NotificationSequenceEditor";
import { NotificationsCard } from "./NotificationsCard";

const ORG = "66666666-6666-4666-8666-666666666666";
const JANE = "11111111-1111-4111-8111-111111111111";

function intakeConfig(over: Partial<NotificationSequenceConfig> = {}): NotificationSequenceConfig {
  return {
    id: "seq-intake",
    orgId: ORG,
    purpose: "intake_reminder",
    enabled: true,
    stopConditions: ["submitted", "withdrawn"],
    targetDaysToReady: 14,
    compressTowardStartDate: true,
    revision: 2,
    createdAt: "2026-10-30T00:00:00Z",
    updatedAt: "2026-10-30T00:00:00Z",
    updatedBy: JANE,
    steps: [2, 4, 7].map((offsetDays, i) => ({
      id: `step-${i + 1}`,
      sequenceId: "seq-intake",
      orgId: ORG,
      position: i + 1,
      offsetDays,
      channel: "email" as const,
      templateKey: ["intake_reminder_first", "intake_reminder_second", "intake_reminder_final"][i],
      ccRecipients: [],
      createdAt: "",
      updatedAt: "",
    })),
    ...over,
  };
}

type AnyElement = ReactElement<Record<string, unknown>>;

function findAll(node: ReactNode, match: (el: AnyElement) => boolean): AnyElement[] {
  const found: AnyElement[] = [];
  const visit = (n: ReactNode) => {
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (!isValidElement(n)) return;
    const el = n as AnyElement;
    if (match(el)) found.push(el);
    visit(el.props.children as ReactNode);
  };
  visit(node);
  return found;
}

function byLabel(node: ReactNode, label: string): AnyElement {
  const [el] = findAll(node, (e) => e.props["aria-label"] === label);
  if (!el) throw new Error(`No element labelled "${label}"`);
  return el;
}

function byText(node: ReactNode, text: string): AnyElement {
  const [el] = findAll(node, (e) => e.props.children === text);
  if (!el) throw new Error(`No element with text "${text}"`);
  return el;
}

const MEMBERS: ReadonlyMap<string, CcMemberOption> = new Map([
  [JANE, { userId: JANE, name: "Jane Doe" }],
]);

type EditorOverrides = Partial<
  Omit<NotificationSequenceEditorProps, "onChange" | "onSave" | "onCancel">
>;

function editorProps(over: EditorOverrides = {}) {
  const draft = over.draft ?? starterDraft("intake_reminder");
  return {
    purpose: "intake_reminder" as const,
    draft,
    issues: validateDraft("intake_reminder", draft),
    members: MEMBERS,
    isNew: false,
    dirty: false,
    saving: false,
    ...over,
    onChange: vi.fn<(draft: SequenceDraft) => void>(),
    onSave: vi.fn<() => void>(),
    onCancel: vi.fn<() => void>(),
  };
}

beforeEach(() => {
  state.isAdmin = true;
  state.sequences = {};
  state.isLoading = false;
  state.isError = false;
  state.members = [
    {
      id: "m-1",
      orgId: ORG,
      userId: JANE,
      role: "specialist",
      createdAt: "",
      fullName: "Jane Doe",
      email: "jane@example.test",
    },
  ];
  state.mutate = vi.fn();
});

describe("NotificationsCard: admin", () => {
  it("offers Set up with an editable starter when a purpose has no row, and writes nothing", () => {
    const html = renderToStaticMarkup(<NotificationsCard />);
    expect(html).toContain("Notifications");
    expect(html).toContain("Provider intake reminders");
    expect(html).toContain("Daily follow-up digest");
    expect(html.match(/>Set up</g)).toHaveLength(2);
    expect(html).toContain(
      "3 emails, on day 2, day 4 and day 7 after the invite, cc&#x27;ing no one, switched off until you turn it on. You can change any of it before you save.",
    );
    expect(html.match(/Not set up/g)).toHaveLength(2);
    expect(html).not.toContain("<input");
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("opens a saved sequence straight into the editor, with Save waiting for a change", () => {
    state.sequences = { intake_reminder: intakeConfig() };
    const html = renderToStaticMarkup(<NotificationsCard />);
    expect(html).toContain('aria-label="Step 1 days after invite"');
    expect(html).toContain('value="2"');
    expect(html).toContain('value="7"');
    expect(html).toContain("Send intake reminders");
    expect(html).toContain("Target days from invite to ready");
    expect(html).toContain("Stop reminders when");
    expect(html).toContain("Move reminders closer together when a start date is near");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save<\/button>/);
    expect(html).toContain("Discard changes");
    expect(html).toContain(">On<");
    // The digest has no row yet: still Set up.
    expect(html.match(/>Set up</g)).toHaveLength(1);
  });

  it("shows a clear empty cc state, with the bounce warning on intake step 1 only", () => {
    state.sequences = { intake_reminder: intakeConfig() };
    const html = renderToStaticMarkup(<NotificationsCard />);
    expect(html.match(/No one is cc&#x27;d on this step\./g)).toHaveLength(3);
    expect(html.match(/If step 1 bounces, the people cc&#x27;d here are told\./g)).toHaveLength(1);
    expect(html.match(/Add a member or a role to copy them on this step\./g)).toHaveLength(2);
    expect(html).toContain('aria-label="Add someone to cc on step 1"');
  });

  it("lists cc'd members and roles in order with keyboard move and remove buttons", () => {
    const config = intakeConfig();
    config.steps[0].ccRecipients = [
      { kind: "user", userId: JANE },
      { kind: "role", role: "admin" },
    ];
    state.sequences = { intake_reminder: config };
    const html = renderToStaticMarkup(<NotificationsCard />);
    expect(html.indexOf("Jane Doe")).toBeLessThan(html.indexOf("All admins"));
    expect(html).toContain('aria-label="Move Jane Doe down on step 1"');
    expect(html).toContain('aria-label="Remove All admins from step 1"');
    expect(html).toMatch(/<button[^>]*aria-label="Move Jane Doe up on step 1"[^>]*disabled=""/);
  });

  it("names the SMS limits when a step is a text", () => {
    const config = intakeConfig();
    config.steps[1].channel = "sms";
    state.sequences = { intake_reminder: config };
    const html = renderToStaticMarkup(<NotificationsCard />);
    expect(html).toContain("Text messages aren&#x27;t switched on yet, so SMS steps are skipped");
  });

  it("says when the settings could not load", () => {
    state.isError = true;
    expect(renderToStaticMarkup(<NotificationsCard />)).toContain(
      "We couldn&#x27;t load this organization&#x27;s notification settings.",
    );
  });
});

describe("NotificationsCard: other members", () => {
  beforeEach(() => {
    state.isAdmin = false;
  });

  it("shows a read-only summary with no inputs, buttons or Set up", () => {
    const config = intakeConfig();
    config.steps[2].ccRecipients = [
      { kind: "user", userId: JANE },
      { kind: "role", role: "admin" },
    ];
    state.sequences = { intake_reminder: config };
    const html = renderToStaticMarkup(<NotificationsCard />);
    expect(html).toContain("Step 1 · day 2 after the invite · Email · First reminder");
    expect(html).toContain("Cc: no one");
    expect(html).toContain("Cc: Jane Doe, then All admins");
    expect(html).toContain("14 days from invite to ready");
    expect(html).toContain("the provider submits the intake form; the provider withdraws");
    expect(html).toContain("reminders move closer together");
    expect(html).toContain("Only admins can change notifications.");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Set up");
  });

  it("says a purpose is not set up rather than offering to set it up", () => {
    const html = renderToStaticMarkup(<NotificationsCard />);
    expect(html.match(/Not set up\. An admin can set this up\./g)).toHaveLength(2);
    expect(html).not.toContain("<button");
  });
});

describe("NotificationSequenceEditor: an admin edits and saves", () => {
  it("routes an offset edit through onChange, then saves the edited draft", () => {
    const props = editorProps();
    const tree = NotificationSequenceEditor(props);
    const offset = byLabel(tree, "Step 2 days after invite");
    (offset.props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: "5" },
    });
    const edited = props.onChange.mock.calls[0][0] as SequenceDraft;
    expect(edited.steps.map((s) => s.offsetDays)).toEqual([2, 5, 7]);

    // Re-render with the edit, as the section does: Save is now enabled.
    const saveProps = editorProps({ draft: edited, dirty: true });
    const saveTree = NotificationSequenceEditor(saveProps);
    const save = byText(saveTree, "Save");
    expect(save.props.disabled).toBe(false);
    (save.props.onClick as () => void)();
    expect(saveProps.onSave).toHaveBeenCalledTimes(1);
  });

  it("blocks Save while the draft is invalid and says why", () => {
    const draft = { ...starterDraft("intake_reminder") };
    draft.steps = draft.steps.map((s, i) => (i === 1 ? { ...s, offsetDays: 1 } : s));
    const props = editorProps({ draft, dirty: true });
    const html = renderToStaticMarkup(<NotificationSequenceEditor {...props} />);
    expect(html).toContain("Step 2 must go out after step 1 (later than day 2).");
    expect(html).toContain("Fix the messages above to save.");
    expect(byText(NotificationSequenceEditor(props), "Save").props.disabled).toBe(true);
  });

  it("reorders steps from the keyboard buttons, keeping the schedule", () => {
    const props = editorProps();
    const tree = NotificationSequenceEditor(props);
    expect(byLabel(tree, "Move step 1 up").props.disabled).toBe(true);
    (byLabel(tree, "Move step 3 up").props.onClick as () => void)();
    const moved = props.onChange.mock.calls[0][0] as SequenceDraft;
    expect(moved.steps.map((s) => s.offsetDays)).toEqual([2, 4, 7]);
    expect(moved.steps[1].templateKey).toBe("intake_reminder_final");
  });

  it("shows the digest as one daily step with no offset input and no intake settings", () => {
    const draft = starterDraft("followup_digest");
    const html = renderToStaticMarkup(
      <NotificationSequenceEditor
        {...editorProps({
          purpose: "followup_digest",
          draft,
          issues: validateDraft("followup_digest", draft),
        })}
      />,
    );
    expect(html).toContain("Once a day");
    expect(html).not.toContain("days after invite");
    expect(html).not.toContain("Target days from invite to ready");
    expect(html).not.toContain("+ Add step");
    expect(html).not.toContain('aria-label="Move step 1 up"');
  });
});

describe("NotificationCcRecipients: filling an empty cc list", () => {
  it("adds a role, then a member, in the order picked", () => {
    const onChange = vi.fn();
    const step: StepDraft = starterDraft("intake_reminder").steps[0];
    const pick = (current: StepDraft, value: string) => {
      const tree = NotificationCcRecipients({
        step: current,
        stepNumber: 1,
        members: MEMBERS,
        bounceNote: true,
        onChange,
      });
      const [select] = findAll(tree, (e) => typeof e.props.onValueChange === "function");
      (select.props.onValueChange as (v: string) => void)(value);
      return onChange.mock.calls.at(-1)?.[0] as StepDraft;
    };
    const withRole = pick(step, "role:admin");
    const withBoth = pick(withRole, `user:${JANE}`);
    expect(withBoth.ccRecipients).toEqual([
      { kind: "role", role: "admin" },
      { kind: "user", userId: JANE },
    ]);
    const html = renderToStaticMarkup(
      <NotificationCcRecipients
        step={withBoth}
        stepNumber={1}
        members={MEMBERS}
        bounceNote
        onChange={onChange}
      />,
    );
    expect(html).not.toContain("No one is cc&#x27;d");
    expect(html).toContain("1.</span>");
  });
});
