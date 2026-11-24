import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BellOff, BellRing } from "lucide-react";
import { fetchKanbanSettings, saveKanbanSettings, KanbanRequestError } from "@/lib/kanban";
import type { KanbanSettings } from "@/types/kanban";
import { useAuth } from "@/contexts/auth-context";
import { useUserTimezone, userTimezoneKey } from "@/hooks/use-user-timezone";
import { saveUserTimezone, type UserTimezone } from "@/lib/user-timezone";
import { zoneLabel } from "@/lib/kanban-schedule";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const settingsKey = ["kanban", "settings"];

// coreban only accepts topics under this prefix on the homelab ntfy server.
const topicPrefix = "coreban-";

const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

// Every IANA zone this browser knows, with UTC (which some leave out) first.
// Browsers without Intl.supportedValuesOf offer UTC and this device's zone.
const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
const timezones = [
  "UTC",
  ...(intl.supportedValuesOf?.("timeZone") ?? [deviceTimezone]).filter((tz) => tz !== "UTC"),
];

// bareTopicName is the typed name without the prefix, which is shown fixed
// beside the field, so pasting a whole coreban-… topic still works.
const bareTopicName = (input: string) => {
  const typed = input.trim();
  return typed.startsWith(topicPrefix) ? typed.slice(topicPrefix.length) : typed;
};

// previewTopicName is what the help text shows after the prefix: the typed
// name only once coreban would accept it (its normalizeTopic rule: letters,
// digits, - and _, at most 64 characters with the prefix), so a pasted URL
// is never echoed back as a topic to subscribe to.
const previewTopicName = (input: string) => {
  const name = bareTopicName(input);
  return /^[A-Za-z0-9_-]+$/.test(name) && topicPrefix.length + name.length <= 64 ? name : "…";
};

// ReminderSettings is the Reminders section of the Settings page: where
// reminders are pushed, and the timezone their times are read in.
export function ReminderSettings() {
  const settingsQuery = useQuery({ queryKey: settingsKey, queryFn: fetchKanbanSettings });
  const timezoneQuery = useUserTimezone();
  const loading = settingsQuery.isLoading || timezoneQuery.isLoading;
  const failed = settingsQuery.error || timezoneQuery.error;
  const retry = () => {
    if (settingsQuery.error) settingsQuery.refetch();
    if (timezoneQuery.error) timezoneQuery.refetch();
  };

  return (
    <div>
      {loading && (
        <div className="grid gap-4" aria-busy="true">
          <div className="h-11 animate-pulse rounded bg-muted" />
          <div className="h-11 animate-pulse rounded bg-muted" />
        </div>
      )}

      {failed && (
        <div>
          <p className="text-sm text-destructive">Couldn't load your settings.</p>
          <Button variant="outline" className="mt-2 min-h-11" onClick={retry}>
            Retry
          </Button>
        </div>
      )}

      {/* The form keeps its own state from the first load; saving updates
          the cached settings it reads its status line from. */}
      {settingsQuery.data && timezoneQuery.data && (
        <SettingsForm saved={settingsQuery.data} savedTimezone={timezoneQuery.data} />
      )}
    </div>
  );
}

// fieldError rewrites a field-named message (coreban's for the topic, the
// gateway's for the timezone) for the form, where the coreban- prefix is
// fixed and the field is labelled "Notification target".
function fieldError(detail: string, field: "ntfy_topic" | "timezone"): string {
  if (!detail.startsWith(field)) return "";
  return field === "ntfy_topic"
    ? detail.replace(/^ntfy_topic/, "The notification target")
    : detail.replace(/^timezone/, "The timezone");
}

// TimezoneSaveError is the gateway refusing the timezone after coreban
// saved the topic, told apart from coreban refusing the topic.
class TimezoneSaveError extends Error {}

function SettingsForm({ saved, savedTimezone }: { saved: KanbanSettings; savedTimezone: UserTimezone }) {
  const queryClient = useQueryClient();
  const { user, isGuest } = useAuth();
  const [topicName, setTopicName] = useState(saved.ntfy_topic?.slice(topicPrefix.length) ?? "");
  const [timezone, setTimezone] = useState(savedTimezone.timezone);
  const [savedNotice, setSavedNotice] = useState(false);

  // The topic is coreban's; the timezone is the gateway's (ADR-0005), saved
  // there after the topic, only when it changed. The shared demo guest
  // keeps UTC: the gateway refuses it a timezone.
  const saveMutation = useMutation({
    mutationFn: async (next: { ntfy_topic: string | null; timezone: string }) => {
      const settings = await saveKanbanSettings({ ntfy_topic: next.ntfy_topic });
      queryClient.setQueryData(settingsKey, settings);
      if (!isGuest && (next.timezone !== savedTimezone.timezone || !savedTimezone.saved)) {
        try {
          const tz = await saveUserTimezone(savedTimezone.user_id, next.timezone);
          queryClient.setQueryData(userTimezoneKey(user?.id), tz);
        } catch (err) {
          throw new TimezoneSaveError(err instanceof Error ? err.message : "");
        }
      }
    },
    onSuccess: () => setSavedNotice(true),
    onMutate: () => setSavedNotice(false),
  });

  const err = saveMutation.error;
  const topicError = err instanceof KanbanRequestError ? fieldError(err.detail, "ntfy_topic") : "";
  // The topic is already saved when the timezone fails, so say so.
  const timezoneError =
    err instanceof TimezoneSaveError
      ? `${fieldError(err.message, "timezone") || "Couldn't save the timezone."} Your notification target was saved.`
      : "";
  const otherError = err && !topicError && !timezoneError ? "Couldn't save your settings." : "";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (saveMutation.isPending) return;
    const name = bareTopicName(topicName);
    saveMutation.mutate({ ntfy_topic: name ? topicPrefix + name : null, timezone });
  };

  return (
    <form onSubmit={handleSubmit} className="grid gap-6">
      {saved.ntfy_topic ? (
        <p className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
          <BellRing className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Reminders go to <span className="font-mono text-foreground">{saved.ntfy_topic}</span>.
          </span>
        </p>
      ) : (
        <p className="flex items-start gap-2 rounded-xl border border-border p-4 text-sm leading-relaxed">
          <BellOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>No notification target yet, so reminders won't be sent. Set one below.</span>
        </p>
      )}

      <div className="grid gap-2">
        <Label htmlFor="kanban-topic">Notification target</Label>
        <div className="flex min-h-11 items-stretch overflow-hidden rounded-md border border-input focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
          <span className="flex items-center border-r border-input bg-muted px-3 font-mono text-sm text-muted-foreground" aria-hidden>
            {topicPrefix}
          </span>
          <Input
            id="kanban-topic"
            value={topicName}
            onChange={(e) => setTopicName(e.target.value)}
            aria-describedby="kanban-topic-help"
            aria-invalid={topicError ? true : undefined}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="min-h-11 rounded-none border-0 font-mono focus-visible:ring-0"
          />
        </div>
        <p id="kanban-topic-help" className="text-xs leading-relaxed text-muted-foreground">
          An ntfy topic name on the homelab's ntfy server, not a URL: letters, digits, - and _. Subscribe to{" "}
          <span className="font-mono">{topicPrefix}{previewTopicName(topicName)}</span> in the ntfy app. Leave empty to
          stop reminders.
        </p>
        {topicError && <p className="text-sm text-destructive">{topicError}</p>}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="kanban-timezone">Timezone</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={timezone} onValueChange={setTimezone} disabled={isGuest}>
            <SelectTrigger id="kanban-timezone" className="min-h-11 flex-1" aria-invalid={timezoneError ? true : undefined}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {!timezones.includes(timezone) && <SelectItem value={timezone}>{timezone}</SelectItem>}
              {timezones.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {zoneLabel(tz)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!isGuest && timezone !== deviceTimezone && (
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setTimezone(deviceTimezone)}>
              Use device
            </Button>
          )}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          "Daily at 07:00" means 07:00 here, and your budget dates its entries in it too. This device is on{" "}
          {zoneLabel(deviceTimezone)}.{isGuest && " The shared demo account stays on UTC."}
        </p>
        {timezoneError && <p className="text-sm text-destructive">{timezoneError}</p>}
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" className="min-h-11" disabled={saveMutation.isPending}>
          Save
        </Button>
        {savedNotice && <p className="text-sm text-muted-foreground" role="status">Saved.</p>}
        {otherError && <p className="text-sm text-destructive">{otherError}</p>}
      </div>
    </form>
  );
}
