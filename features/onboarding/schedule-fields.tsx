"use client";

import { PAY_FREQUENCY_LABELS, type PayFrequency } from "@/lib/pay-schedule";

export interface SchedulePreferences {
  payFrequency: PayFrequency;
  semimonthlyDays: [number, number];
  timezone: string;
}

const input = "mt-1 min-h-12 w-full rounded-button bg-secondary-system-bg px-4 text-[17px] text-label";
const timezones = ["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Anchorage", "Pacific/Honolulu"];

export function ScheduleFields({ value, onChange }: {
  value: SchedulePreferences;
  onChange: (patch: Partial<SchedulePreferences>) => void;
}) {
  return <div className="space-y-4">
    <label className="block text-[13px] font-medium text-secondary-label">
      Pay frequency
      <select aria-label="Pay frequency" className={input} value={value.payFrequency}
        onChange={event => onChange({ payFrequency: event.target.value as PayFrequency })}>
        {Object.entries(PAY_FREQUENCY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </label>
    {value.payFrequency === "semimonthly" && <div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-[13px] text-secondary-label">First payday
          <input aria-label="First payday of month" className={input} type="number" min={1} max={27} required value={value.semimonthlyDays[0]}
            onChange={event => onChange({ semimonthlyDays: [Number(event.target.value), value.semimonthlyDays[1]] })}/>
        </label>
        <label className="block text-[13px] text-secondary-label">Second payday
          <input aria-label="Second payday of month" className={input} type="number" min={2} max={31} required value={value.semimonthlyDays[1]}
            onChange={event => onChange({ semimonthlyDays: [value.semimonthlyDays[0], Number(event.target.value)] })}/>
        </label>
      </div>
      <p className="mt-2 text-[13px] text-secondary-label">For example, 1 and 15, or 15 and 31. A date after month-end uses the last day. The first day must be before the 28th so both paydays remain distinct in February.</p>
    </div>}
    <label className="block text-[13px] font-medium text-secondary-label">Timezone
      <input aria-label="Timezone" className={input} list="user-timezones" required value={value.timezone}
        onChange={event => onChange({ timezone: event.target.value })} placeholder="America/Chicago"/>
      <datalist id="user-timezones">{timezones.map(zone => <option key={zone} value={zone}/>)}</datalist>
    </label>
    <p className="text-[13px] text-secondary-label">Use an IANA timezone name. Calendar dates follow this timezone. Paydays use the dates you enter; weekends and holidays are not shifted.</p>
  </div>;
}
