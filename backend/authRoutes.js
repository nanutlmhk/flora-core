const express = require("express");
const {
  changeAuthUserPasswordWithCurrentPassword,
  createAuthSessionForUser,
  getAuthSessionByToken,
  listAuthUsers,
  recordAuthAudit,
  resetAuthUserPassword,
  revokeAuthSession,
  setAuthUserActive,
  setAuthUserThemePreferences,
  verifyAuthUserPassword,
} = require("./floradb");

const router = express.Router();

function getSessionToken(req) {
  const explicit = String(req.get("x-flora-session") || "").trim();
  if (explicit) return explicit;
  const auth = String(req.get("authorization") || "").trim();
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match ? match[1].trim() : "";
}

function getClientLabel(req) {
  return String(req.get("x-flora-client") || req.get("user-agent") || "").trim();
}

function requireAuth(req, res, next) {
  const session = getAuthSessionByToken(getSessionToken(req));
  if (!session) {
    return res.status(401).json({ error: "sign in required" });
  }
  req.authSession = session;
  req.authUser = session.user;
  return next();
}

function requireAdmin(req, res, next) {
  if (String(req.authUser?.role || "").trim().toLowerCase() !== "admin") {
    return res.status(403).json({ error: "admin access required" });
  }
  return next();
}

router.post("/login", (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");

  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }

  try {
    const user = verifyAuthUserPassword(username, password);
    if (!user) {
      recordAuthAudit({
        action: "auth.login",
        actorUsername: username,
        targetUsername: username,
        status: "denied",
        detail: { reason: "invalid_credentials" },
      });
      return res.status(401).json({ error: "invalid username or password" });
    }

    const session = createAuthSessionForUser(user, getClientLabel(req));
    recordAuthAudit({
      action: "auth.login",
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      targetUserId: user.id,
      targetUsername: user.username,
      status: "ok",
      detail: { clientLabel: getClientLabel(req) || undefined },
    });

    return res.json({
      user: {
        username: user.username,
        name: user.name,
        role: user.role || undefined,
        themeMode: user.themeMode || undefined,
        themeColor: user.themeColor || undefined,
      },
      session_token: session.token,
      expires_at: session.expiresAt,
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "login failed",
    });
  }
});

router.post("/logout", requireAuth, (req, res) => {
  revokeAuthSession(getSessionToken(req));
  recordAuthAudit({
    action: "auth.logout",
    actorUserId: req.authUser.id,
    actorUsername: req.authUser.username,
    actorRole: req.authUser.role,
    targetUserId: req.authUser.id,
    targetUsername: req.authUser.username,
    status: "ok",
  });
  return res.json({ ok: true });
});

router.get("/whoami", requireAuth, (req, res) => {
  return res.json({
    user: {
      username: req.authUser.username,
      name: req.authUser.name,
      role: req.authUser.role || undefined,
      themeMode: req.authUser.themeMode || undefined,
      themeColor: req.authUser.themeColor || undefined,
    },
  });
});

router.get("/users", requireAuth, requireAdmin, (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const includeInactive = String(req.query.include_inactive || "true").trim().toLowerCase() !== "false";
    return res.json({
      rows: listAuthUsers({ q, includeInactive }),
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "load users failed",
    });
  }
});

router.get("/self", requireAuth, (req, res) => {
  return res.json({ row: req.authUser });
});

router.put("/self/preferences", requireAuth, (req, res) => {
  try {
    const row = setAuthUserThemePreferences(req.authUser.id, {
      themeMode: req.body?.theme_mode,
      themeColor: req.body?.theme_color,
    });
    recordAuthAudit({
      action: "auth.self.set-preferences",
      actorUserId: req.authUser.id,
      actorUsername: req.authUser.username,
      actorRole: req.authUser.role,
      targetUserId: row.id,
      targetUsername: row.username,
      status: "ok",
      detail: {
        themeMode: row.themeMode || undefined,
        themeColor: row.themeColor || undefined,
      },
    });
    return res.json({
      user: {
        username: row.username,
        name: row.name,
        role: row.role || undefined,
        themeMode: row.themeMode || undefined,
        themeColor: row.themeColor || undefined,
      },
      row,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "update preferences failed";
    return res.status(message === "user not found" ? 404 : 400).json({ error: message });
  }
});

router.put("/users/:userId/active", requireAuth, requireAdmin, (req, res) => {
  try {
    const userId = Number(req.params.userId);
    const isActive = Boolean(req.body?.is_active);
    const row = setAuthUserActive(userId, isActive);
    recordAuthAudit({
      action: "auth.user.set-active",
      actorUserId: req.authUser.id,
      actorUsername: req.authUser.username,
      actorRole: req.authUser.role,
      targetUserId: row.id,
      targetUsername: row.username,
      status: "ok",
      detail: { isActive: row.isActive },
    });
    return res.json({ row });
  } catch (err) {
    const message = err instanceof Error ? err.message : "update user failed";
    return res.status(message === "user not found" ? 404 : 400).json({ error: message });
  }
});

router.post("/users/:userId/reset-password", requireAuth, requireAdmin, (req, res) => {
  try {
    const userId = Number(req.params.userId);
    const password = String(req.body?.password || "").trim();
    const result = resetAuthUserPassword(userId, password);
    recordAuthAudit({
      action: "auth.user.reset-password",
      actorUserId: req.authUser.id,
      actorUsername: req.authUser.username,
      actorRole: req.authUser.role,
      targetUserId: result.user.id,
      targetUsername: result.user.username,
      status: "ok",
      detail: { mode: password ? "custom" : "default" },
    });
    return res.json({
      row: result.user,
      applied_password: result.appliedPassword,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "reset password failed";
    return res.status(message === "user not found" ? 404 : 400).json({ error: message });
  }
});

router.post("/self/change-password", requireAuth, (req, res) => {
  try {
    const currentPassword = String(req.body?.current_password || "");
    const newPassword = String(req.body?.new_password || "");
    const row = changeAuthUserPasswordWithCurrentPassword(
      req.authUser.username,
      currentPassword,
      newPassword,
    );
    recordAuthAudit({
      action: "auth.self.change-password",
      actorUserId: req.authUser.id,
      actorUsername: req.authUser.username,
      actorRole: req.authUser.role,
      targetUserId: row.id,
      targetUsername: row.username,
      status: "ok",
    });
    return res.json({ row });
  } catch (err) {
    const message = err instanceof Error ? err.message : "change password failed";
    return res.status(message === "user not found" ? 404 : 400).json({ error: message });
  }
});

module.exports = router;
