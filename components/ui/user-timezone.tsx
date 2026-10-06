"use client";
import { createContext, useContext } from "react";

const UserTimezone = createContext("UTC");
export function UserTimezoneProvider({ timezone, children }: { timezone: string; children: React.ReactNode }) {
  return <UserTimezone.Provider value={timezone}>{children}</UserTimezone.Provider>;
}
export function useUserTimezone() { return useContext(UserTimezone); }
