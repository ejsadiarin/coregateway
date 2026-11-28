
import { createContext, useContext, useState, ReactNode, useEffect, useCallback, useRef } from "react";
import type { User, UserRole } from "@/types/api";
import * as api from "@/lib/api";
import { forgetSignedIn, rememberSignedIn, signedInOnDevice } from "@/lib/last-seen";
import { forgetLastSeen, queryClient } from "@/contexts/query-context";

interface AuthContextType {
    user: User | null;
    login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
    register: (email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
    demoLogin: () => Promise<void>;
    isAuthenticated: boolean;
    isGuest: boolean;
    isAdmin: boolean;
    hasPermission: (requiredRole: UserRole) => boolean;
    isLoading: boolean;
    refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ROLE_HIERARCHY: Record<UserRole, number> = {
    guest: 1,
    user: 2,
    admin: 3,
};

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const retry = useRef<{ timer?: ReturnType<typeof setTimeout>; attempt: number }>({ attempt: 0 });
    // Whose reads the in-memory cache holds, so a different account signing
    // in never sees them.
    const owner = useRef<string | undefined>(signedInOnDevice()?.id);

    // signedIn records who the gateway says is signed in, and remembers them
    // on this device for opening offline. A session that ended (401), or
    // another account in its place, is that account signed out: its
    // last-seen data goes too.
    const signedIn = useCallback((u: User | null) => {
        const gone = owner.current;
        if (gone && gone !== u?.id) {
            owner.current = undefined;
            void forgetLastSeen(gone);
        }
        if (u) {
            owner.current = u.id;
            rememberSignedIn(u);
        } else {
            forgetSignedIn();
        }
        setUser(u);
        // A check that a later one replaced (back online) never returns, so
        // whichever answers first ends the loading.
        setIsLoading(false);
    }, []);

    // check resolves once the session is known. Only the gateway saying 401
    // signs the owner out; a failed check (offline, gateway or database
    // waking up) keeps whoever was signed in and tries again with backoff.
    // onFailure runs after each failed try.
    const check = useCallback(async (onFailure?: () => void) => {
        clearTimeout(retry.current.timer);
        for (;;) {
            try {
                signedIn(await api.fetchCurrentUser());
                retry.current.attempt = 0;
                return;
            } catch {
                onFailure?.();
                const wait = api.sessionRetryDelay(retry.current.attempt++);
                await new Promise<void>((resolve) => {
                    retry.current.timer = setTimeout(resolve, wait);
                });
            }
        }
    }, [signedIn]);
    const refreshUser = useCallback(() => check(), [check]);

    const login = async (email: string, password: string, rememberMe = false): Promise<void> => {
        signedIn(await api.login({ email, password, remember_me: rememberMe }));
    };

    const register = async (email: string, password: string): Promise<void> => {
        signedIn(await api.register({ email, password }));
    };

    // logout ends the session, then clears this account's last-seen data
    // from the device and from memory.
    const logout = async (): Promise<void> => {
        await api.logout();
        const id = user?.id ?? owner.current;
        forgetSignedIn();
        owner.current = undefined;
        if (id) await forgetLastSeen(id);
        else queryClient.clear();
        setUser(null);
    };

    const demoLogin = async (): Promise<void> => {
        signedIn(await api.demoLogin());
    };

    const hasPermission = (requiredRole: UserRole): boolean => {
        if (!user) return false;
        return ROLE_HIERARCHY[user.role] >= ROLE_HIERARCHY[requiredRole];
    };

    useEffect(() => {
        // Offline, the check can't finish: the account last signed in here
        // opens on its last-seen data meanwhile, and the check carries on.
        const offline = signedInOnDevice();
        const initAuth = async () => {
            setIsLoading(true);
            await check(() => {
                if (!offline) return;
                setUser((u) => u ?? offline);
                setIsLoading(false);
            });
            setIsLoading(false);
        };
        initAuth();
        // Back online: check now rather than waiting out the backoff.
        const recheck = () => {
            retry.current.attempt = 0;
            void check();
        };
        window.addEventListener("online", recheck);
        return () => {
            window.removeEventListener("online", recheck);
            clearTimeout(retry.current.timer);
        };
    }, [check]);

    return (
        <AuthContext.Provider
            value={{
                user,
                login,
                register,
                logout,
                demoLogin,
                isAuthenticated: !!user,
                isGuest: user?.role === "guest",
                isAdmin: user?.role === "admin",
                hasPermission,
                isLoading,
                refreshUser,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
