// Per-day hours editor (E1.2 F1.2.2). Renders one row per day (Open/Closed
// switch + native time inputs — value is 24h "HH:MM" per the locked storage
// contract while the browser displays locale 12h) plus the "Apply weekday
// default" quick-fill (one range → Mon–Fri open, Sat/Sun closed). ALL hours
// logic lives in src/lib/facilityHours — this component only renders the
// draft model and calls the pure helpers.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DAY_KEYS,
  DAY_LABELS,
  applyWeekdayDefault,
  type DayKey,
  type HoursDraft,
} from "@/lib/facilityHours";

interface HoursEditorProps {
  value: HoursDraft;
  onChange: (next: HoursDraft) => void;
  errors: Partial<Record<DayKey, string>>;
}

export function HoursEditor({ value, onChange, errors }: HoursEditorProps) {
  const [defaultOpen, setDefaultOpen] = useState("07:00");
  const [defaultClose, setDefaultClose] = useState("19:00");

  const setDay = (day: DayKey, patch: Partial<HoursDraft[DayKey]>) =>
    onChange({ ...value, [day]: { ...value[day], ...patch } });

  return (
    <div className="space-y-3">
      {/* Weekday quick-fill: the common case is one entry, not seven. */}
      <div className="flex flex-wrap items-end gap-2 rounded-md bg-muted p-3">
        <div>
          <Label htmlFor="hours-default-open" className="text-[12px]">
            Opens
          </Label>
          <Input
            id="hours-default-open"
            type="time"
            value={defaultOpen}
            onChange={(e) => setDefaultOpen(e.target.value)}
            className="h-9 w-[130px]"
          />
        </div>
        <div>
          <Label htmlFor="hours-default-close" className="text-[12px]">
            Closes
          </Label>
          <Input
            id="hours-default-close"
            type="time"
            value={defaultClose}
            onChange={(e) => setDefaultClose(e.target.value)}
            className="h-9 w-[130px]"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-9"
          onClick={() => onChange(applyWeekdayDefault(defaultOpen, defaultClose))}
        >
          Apply weekday default
        </Button>
        <p className="w-full text-[12px] text-muted-foreground">
          Sets Monday–Friday to this range and marks Saturday–Sunday closed. Days stay editable
          below.
        </p>
      </div>

      <ul className="space-y-1.5">
        {DAY_KEYS.map((day) => {
          const d = value[day];
          return (
            <li key={day} className="rounded-md border border-[#E8E5E0] px-3 py-2">
              <div className="flex items-center gap-3">
                <span className="w-24 text-[13px] text-foreground">{DAY_LABELS[day]}</span>
                <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                  <Switch
                    checked={d.open}
                    onCheckedChange={(open) => setDay(day, { open })}
                    aria-label={`${DAY_LABELS[day]} open`}
                  />
                  {d.open ? "Open" : "Closed"}
                </label>
                {d.open ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="time"
                      value={d.openTime}
                      onChange={(e) => setDay(day, { openTime: e.target.value })}
                      aria-label={`${DAY_LABELS[day]} opening time`}
                      className="h-8 w-[120px]"
                    />
                    <span className="text-[12px] text-muted-foreground">to</span>
                    <Input
                      type="time"
                      value={d.closeTime}
                      onChange={(e) => setDay(day, { closeTime: e.target.value })}
                      aria-label={`${DAY_LABELS[day]} closing time`}
                      className="h-8 w-[120px]"
                    />
                  </div>
                ) : null}
              </div>
              {errors[day] ? (
                <p className="mt-1 text-[12px] text-[#B91C1C]">{errors[day]}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
