"use client";

import * as React from "react";

export type AuthUser = {
  id?: number;
  email?: string;
  first_name?: string;
  last_name?: string;
  role?: string;
  [key: string]: unknown;
} | null;

type AuthContextValue = {
  user: AuthUser;
};

const AuthContext = React.createContext<AuthContextValue>({ user: null });

export function useAuth(): AuthContextValue {
  return React.useContext(AuthContext);
}

export function useAuthUser(): AuthUser {
  return React.useContext(AuthContext).user;
}

export const AuthProvider: React.FC<{
  user: AuthUser;
  children: React.ReactNode;
}> = ({ user, children }) => {
  const value = React.useMemo(() => ({ user }), [user]);
  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
