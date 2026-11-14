import { apiBaseUrl } from "@/lib/api";

// UserTimezone is the user's timezone as the gateway keeps it (ADR-0005):
// an IANA zone that every service dates "today" and reads schedules in.
// saved is false while the user has none, which reads as UTC.
export interface UserTimezone {
  user_id: string;
  timezone: string;
  saved: boolean;
}

const timezoneUrl = (userId: string) => `${apiBaseUrl}/api/users/${userId}/timezone`;

async function readTimezone(res: Response, action: string): Promise<UserTimezone> {
  if (!res.ok) {
    const body: { error?: string } = await res.json().catch(() => ({}));
    throw new Error(body.error || `Error ${action}: ${res.status}`);
  }
  return res.json();
}

export async function fetchUserTimezone(userId: string): Promise<UserTimezone> {
  const res = await fetch(timezoneUrl(userId), { credentials: "include" });
  return readTimezone(res, "fetching your timezone");
}

export async function saveUserTimezone(userId: string, timezone: string): Promise<UserTimezone> {
  const res = await fetch(timezoneUrl(userId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ timezone }),
  });
  return readTimezone(res, "saving your timezone");
}

// deviceTimezone is the zone this browser runs in, when it names one.
export const deviceTimezone = (): string | undefined => Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;

// adoptDeviceTimezone saves deviceZone for a user who has never saved a
// timezone, so a weekly-Tuesday rule lands on their Tuesday and "Daily at
// 07:00" means 07:00 where they are, rather than UTC. A saved timezone is
// never touched: after this, changing zones is the user's choice. If the
// save fails (a zone the gateway doesn't know), UTC stands and the next
// load tries again.
export async function adoptDeviceTimezone(
  current: UserTimezone,
  deviceZone: string | undefined,
  save: (timezone: string) => Promise<UserTimezone>,
): Promise<UserTimezone> {
  if (current.saved || !deviceZone) return current;
  try {
    return await save(deviceZone);
  } catch {
    return current;
  }
}
