// Touch log card on case detail: shows chronological touches and an inline
// add-touch form. The mutation hook stays with the parent route (onSave).
import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmptyState } from '@/components/EmptyState';
import { fmtDate } from '@/lib/format';
import {
  Calendar,
  Globe,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  Printer,
  User,
} from 'lucide-react';
import type { Profile } from '@/types';
import type { Touch, TouchOutcome, TouchType } from '@/types';

const TOUCH_TYPE_ICON: Record<TouchType, typeof Phone> = {
  call: Phone, email: Mail, portal: Globe, fax: Printer,
};
const TOUCH_TYPE_LABEL: Record<TouchType, string> = {
  call: 'Call', email: 'Email', portal: 'Portal', fax: 'Fax',
};
const OUTCOME_OPTIONS: { value: TouchOutcome; label: string }[] = [
  { value: 'reached', label: 'Reached' },
  { value: 'left_voicemail', label: 'Left Message' },
  { value: 'no_answer', label: 'No Answer' },
  { value: 'response_received', label: 'Response Received' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'no_response', label: 'No Response' },
];
const OUTCOME_LABEL: Record<string, string> = Object.fromEntries(
  OUTCOME_OPTIONS.map((o) => [o.value, o.label]),
);

export interface TouchInput {
  touchDate: string;
  touchType: TouchType;
  outcome: TouchOutcome;
  notes: string | null;
  nextFollowUpDate: string | null;
}

export function CaseTouchesPanel({
  touches,
  coordinators,
  canEdit,
  saving,
  onSaveTouch,
}: {
  touches: Touch[];
  coordinators: Profile[];
  canEdit: boolean;
  saving: boolean;
  onSaveTouch: (input: TouchInput) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="shadow-none border-border">
      <CardHeader className="p-4 pb-2 border-b border-border flex flex-row items-center justify-between">
        <CardTitle className="text-[14px] font-semibold">Touch Log</CardTitle>
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setOpen((v) => !v)}
          >
            <Plus className="w-4 h-4 mr-1" /> Add touch
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {open && canEdit ? (
          <AddTouchForm
            onCancel={() => setOpen(false)}
            onSave={async (input) => {
              await onSaveTouch(input);
              setOpen(false);
            }}
            saving={saving}
          />
        ) : null}
        {touches.length === 0 ? (
          <EmptyState
            icon={
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-muted-foreground" />
              </div>
            }
            message="No touches logged yet"
            description="Record calls, emails, and portal updates here"
          />
        ) : (
          <div className="p-4 space-y-6">
            {touches.map((t, idx) => {
              const Icon = TOUCH_TYPE_ICON[t.touchType] ?? Phone;
              const isLatest = idx === 0;
              const coord = coordinators.find((x) => x.id === t.coordinatorId);
              const coordName = coord?.fullName ?? coord?.email ?? '—';
              return (
                <div key={t.id} className="relative pl-6 border-l-2 border-muted pb-2">
                  <div
                    className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-background border-2 ${
                      isLatest ? 'border-primary' : 'border-muted'
                    } flex items-center justify-center`}
                  >
                    {isLatest ? <div className="w-1.5 h-1.5 rounded-full bg-primary" /> : null}
                  </div>
                  <div className="flex items-start justify-between mb-1 gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold text-foreground tabular-nums">
                        {fmtDate(t.touchDate)}
                      </span>
                      <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-medium bg-background gap-1 text-muted-foreground">
                        <Icon className="w-3 h-3" /> {TOUCH_TYPE_LABEL[t.touchType]}
                      </Badge>
                      {t.source === 'email_webhook' && (
                        <Badge variant="secondary" className="text-[10px] h-5 px-1.5 font-medium border border-border bg-muted/30">
                          via email
                        </Badge>
                      )}
                      <span className="text-[13px] text-foreground font-medium">
                        · {OUTCOME_LABEL[t.outcome] ?? t.outcome}
                      </span>
                    </div>
                    <span className="text-[12px] text-muted-foreground flex items-center gap-1 shrink-0">
                      <User className="w-3 h-3" /> {coordName}
                    </span>
                  </div>
                  {t.notes ? (
                    <p className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed whitespace-pre-wrap">
                      {t.notes}
                    </p>
                  ) : null}
                  {t.nextFollowUpDate ? (
                    <div className="mt-2 text-[12px] text-[#D97706] inline-flex items-center gap-1 font-medium bg-[#FEF3C7] px-2 py-0.5 rounded">
                      <Calendar className="w-3 h-3" /> Next follow-up: {fmtDate(t.nextFollowUpDate)}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddTouchForm({
  onCancel,
  onSave,
  saving,
}: {
  onCancel: () => void;
  onSave: (input: TouchInput) => void;
  saving: boolean;
}) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [touchDate, setTouchDate] = useState(today);
  const [touchType, setTouchType] = useState<TouchType>('call');
  const [outcome, setOutcome] = useState<TouchOutcome>('reached');
  const [notes, setNotes] = useState('');
  const [nextFollowUpDate, setNextFollowUpDate] = useState('');

  return (
    <div className="p-4 bg-muted/30 border-b border-border space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Date</Label>
          <Input type="date" value={touchDate} onChange={(e) => setTouchDate(e.target.value)} className="h-8 text-[13px] bg-background" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Type</Label>
          <Select value={touchType} onValueChange={(v) => setTouchType(v as TouchType)}>
            <SelectTrigger className="h-8 text-[13px] bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="call">Call</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="portal">Portal</SelectItem>
              <SelectItem value="fax">Fax</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Outcome</Label>
        <Select value={outcome} onValueChange={(v) => setOutcome(v as TouchOutcome)}>
          <SelectTrigger className="h-8 text-[13px] bg-background"><SelectValue /></SelectTrigger>
          <SelectContent>
            {OUTCOME_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Notes</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Enter details about this touch..."
          className="min-h-[80px] text-[13px] bg-background resize-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Next follow-up</Label>
          <Input type="date" value={nextFollowUpDate} onChange={(e) => setNextFollowUpDate(e.target.value)} className="h-8 text-[13px] bg-background" />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button
          size="sm"
          disabled={saving}
          onClick={() => onSave({
            touchDate,
            touchType,
            outcome,
            notes: notes.trim() ? notes.trim() : null,
            nextFollowUpDate: nextFollowUpDate || null,
          })}
        >
          {saving ? 'Saving…' : 'Save touch'}
        </Button>
      </div>
    </div>
  );
}
