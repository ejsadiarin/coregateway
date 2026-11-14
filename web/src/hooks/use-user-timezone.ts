import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import {
  adoptDeviceTimezone,
  deviceTimezone,
  fetchUserTimezone,
  saveUserTimezone,
  type UserTimezone,
} from "@/lib/user-timezone";

export const userTimezoneKey = (userId: string | undefined) => ["user", userId, "timezone"];

// useUserTimezone reads the signed-in user's timezone from the gateway. A
// user who has never saved one starts on this device's zone (once: after
// that the gateway reports it saved). The shared demo guest is left on UTC
// rather than taking whichever visitor's device came first.
export function useUserTimezone() {
  const { user, isGuest } = useAuth();
  const userId = user?.id;
  return useQuery<UserTimezone, Error>({
    queryKey: userTimezoneKey(userId),
    queryFn: async () => {
      const id = userId as string;
      const current = await fetchUserTimezone(id);
      if (isGuest) return current;
      return adoptDeviceTimezone(current, deviceTimezone(), (tz) => saveUserTimezone(id, tz));
    },
    enabled: !!userId,
    staleTime: Infinity,
    retry: false,
  });
}
