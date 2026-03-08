import { useEffect, useState } from "react";

export type SessionUser = {
  username: string;
  name?: string;
};

function readSessionUser(): SessionUser | null {
  if (typeof window === "undefined") return null;

  const raw = localStorage.getItem("flora_user");
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as SessionUser;
    if (!parsed || typeof parsed.username !== "string" || !parsed.username.trim()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function useSessionUser() {
  const [user, setUser] = useState<SessionUser | null>(() => readSessionUser());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "flora_user") {
        setUser(readSessionUser());
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return user;
}

