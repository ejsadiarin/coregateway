import { apiBaseUrl } from "@/lib/api";

// BudgetSettings is corefinance's per-user settings. Rule entries (recurring
// expenses and incomes) are dated in timezone; saved is false while the user
// still has the UTC default.
export interface BudgetSettings {
  timezone: string;
  saved: boolean;
}

const settingsUrl = `${apiBaseUrl}/api/budget/settings`;

async function readSettings(res: Response, action: string): Promise<BudgetSettings> {
  if (!res.ok) throw new Error(`Error ${action}: ${res.status}`);
  return res.json();
}

export async function saveBudgetTimezone(timezone: string): Promise<BudgetSettings> {
  const res = await fetch(settingsUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ timezone }),
  });
  return readSettings(res, "saving budget settings");
}

// fetchBudgetSettings reads the user's settings, first starting a user who
// has never saved any on this device's timezone (see adoptBudgetTimezone).
export async function fetchBudgetSettings(): Promise<BudgetSettings> {
  const res = await fetch(settingsUrl, { credentials: "include" });
  const settings = await readSettings(res, "fetching budget settings");
  return adoptBudgetTimezone(settings, Intl.DateTimeFormat().resolvedOptions().timeZone, saveBudgetTimezone);
}

// adoptBudgetTimezone saves deviceZone for a user who has never saved
// settings, so a weekly-Tuesday rule creates its entry on their Tuesday
// rather than corefinance's UTC one. A saved timezone is never touched. If
// the save fails (a zone corefinance doesn't know, a read-only session), the
// default stands and the next load tries again.
export async function adoptBudgetTimezone(
  settings: BudgetSettings,
  deviceZone: string | undefined,
  save: (timezone: string) => Promise<BudgetSettings>,
): Promise<BudgetSettings> {
  if (settings.saved || !deviceZone) return settings;
  try {
    return await save(deviceZone);
  } catch {
    return settings;
  }
}
