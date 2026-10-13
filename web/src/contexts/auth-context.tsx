
import { createContext, useContext, useState, ReactNode, useEffect, useCallback } from "react";
import type { User, UserRole } from "@/types/api";
import * as api from "@/lib/api";

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

    const refreshUser = useCallback(async () => {
        try {
            const currentUser = await api.fetchCurrentUser();
            setUser(currentUser);
        } catch {
            setUser(null);
        }
    }, []);

    const login = async (email: string, password: string, rememberMe = false): Promise<void> => {
        const loggedInUser = await api.login({ email, password, remember_me: rememberMe });
        setUser(loggedInUser);
    };

    const register = async (email: string, password: string): Promise<void> => {
        const newUser = await api.register({ email, password });
        setUser(newUser);
    };

    const logout = async (): Promise<void> => {
        await api.logout();
        setUser(null);
        // Note: React Query cache should be cleared by the component calling logout
        // using queryClient.clear() after successful logout
    };

    const demoLogin = async (): Promise<void> => {
        const demoUser = await api.demoLogin();
        setUser(demoUser);
    };

    const hasPermission = (requiredRole: UserRole): boolean => {
        if (!user) return false;
        return ROLE_HIERARCHY[user.role] >= ROLE_HIERARCHY[requiredRole];
    };

    useEffect(() => {
        const initAuth = async () => {
            setIsLoading(true);
            await refreshUser();
            setIsLoading(false);
        };
        initAuth();
    }, [refreshUser]);

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
