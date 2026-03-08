import { useEffect, useState } from "react";

export type AuthUser = {
  username: string;
  name: string;
  role?: string;
};

type DemoUser = AuthUser & {
  password: string;
};

const DEMO_USERS: DemoUser[] = [
  {
    username: "doctor",
    password: "doctor",
    name: "Anesthetist",
    role: "anesthetist",
  },
  {
    username: "nurse",
    password: "nurse",
    name: "Nurse",
    role: "nurse",
  },
];

function readStoredUser(): AuthUser | null {
  if (typeof window === "undefined") return null;

  const raw = localStorage.getItem("flora_user");
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as AuthUser;
    if (!parsed || typeof parsed.username !== "string" || !parsed.username.trim()) {
      return null;
    }
    if (!parsed.name || typeof parsed.name !== "string") {
      return {
        username: parsed.username,
        name: parsed.username,
      };
    }
    return parsed;
  } catch {
    return null;
  }
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setUser(readStoredUser());
    setReady(true);
  }, []);

  const login = (username: string, password: string) => {
    const candidate = DEMO_USERS.find(
      u => u.username === username.trim() && u.password === password,
    );

    if (!candidate) return false;

    const session: AuthUser = {
      username: candidate.username,
      name: candidate.name,
      role: candidate.role,
    };

    localStorage.setItem("flora_user", JSON.stringify(session));
    setUser(session);
    return true;
  };

  const logout = () => {
    localStorage.removeItem("flora_user");
    setUser(null);
  };

  return {
    user,
    ready,
    isAuthenticated: !!user,
    login,
    logout,
  };
}

