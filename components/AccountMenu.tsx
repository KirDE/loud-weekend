"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useLanguage } from "./LanguageProvider";
import { authErrorMessage } from "@/lib/auth-error-copy";

type User = { id: string; email: string };
type Mode = "login" | "register";

const googleCopy = {
  en: {
    login: "Continue with Google",
    link: "Link a Google account",
    connected: "Google authentication completed.",
    conflict:
      "This Google identity cannot be used here. " +
      "If you already have an account, sign in the usual way and link Google explicitly.",
    failed: "Google authentication did not complete.",
  },
  de: {
    login: "Mit Google fortfahren",
    link: "Google-Konto verknüpfen",
    connected: "Die Google-Authentifizierung war erfolgreich.",
    conflict:
      "Dieses Google-Konto kann hier nicht verwendet werden. " +
      "Wenn du bereits ein Konto hast, melde dich wie gewohnt an und verknüpfe es ausdrücklich.",
    failed: "Die Google-Authentifizierung wurde nicht abgeschlossen.",
  },
  ru: {
    login: "Продолжить с Google",
    link: "Привязать аккаунт Google",
    connected: "Аутентификация через Google завершена.",
    conflict:
      "Этот аккаунт Google нельзя использовать здесь. " +
      "Если у вас уже есть аккаунт, войдите обычным способом и отдельно привяжите Google.",
    failed: "Не удалось завершить аутентификацию через Google.",
  },
} as const;

const exportLabel = {
  en: "Download account data (JSON)",
  de: "Kontodaten herunterladen (JSON)",
  ru: "Скачать данные аккаунта (JSON)",
} as const;

const copy = {
  en: {
    account: "Account",
    signIn: "Sign in",
    register: "Create account",
    email: "Email",
    password: "Password",
    passkeySignIn: "Sign in with passkey",
    passkeyRegister: "Create account with passkey",
    passkeyHint: "Passkeys use your fingerprint, face, screen lock, or security key.",
    passwordDivider: "or use a password",
    emailRequired: "Enter a valid email first.",
    cancelled: "Passkey request was cancelled.",
    logout: "Sign out",
    close: "Close",
    loading: "Please wait…",
    local: "No account? Your plan stays on this device.",
    failed: "Something went wrong. Please try again.",
  },
  de: {
    account: "Konto",
    signIn: "Anmelden",
    register: "Konto erstellen",
    email: "E-Mail",
    password: "Passwort",
    passkeySignIn: "Mit Passkey anmelden",
    passkeyRegister: "Konto mit Passkey erstellen",
    passkeyHint:
      "Passkeys verwenden Fingerabdruck, Gesichtserkennung, Gerätesperre oder Sicherheitsschlüssel.",
    passwordDivider: "oder Passwort verwenden",
    emailRequired: "Bitte zuerst eine gültige E-Mail eingeben.",
    cancelled: "Passkey-Anfrage wurde abgebrochen.",
    logout: "Abmelden",
    close: "Schließen",
    loading: "Bitte warten…",
    local: "Ohne Konto bleibt dein Plan auf diesem Gerät.",
    failed: "Etwas ist schiefgegangen. Bitte erneut versuchen.",
  },
  ru: {
    account: "Аккаунт",
    signIn: "Войти",
    register: "Создать аккаунт",
    email: "Эл. почта",
    password: "Пароль",
    passkeySignIn: "Войти с паскеем",
    passkeyRegister: "Создать аккаунт с паскеем",
    passkeyHint:
      "Паскей использует отпечаток, лицо, код блокировки устройства или ключ безопасности.",
    passwordDivider: "или использовать пароль",
    emailRequired: "Сначала введите корректный адрес почты.",
    cancelled: "Запрос паскея отменён.",
    logout: "Выйти",
    close: "Закрыть",
    loading: "Подождите…",
    local: "Без аккаунта план останется на этом устройстве.",
    failed: "Что-то пошло не так. Попробуйте ещё раз.",
  },
} as const;

export function AccountMenu() {
  const { language } = useLanguage();
  const t = copy[language];
  const google = googleCopy[language];
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [googleAvailable, setGoogleAvailable] = useState(false);
  const [googleResult, setGoogleResult] = useState<"connected" | "conflict" | "failed" | null>(
    null,
  );

  useEffect(() => {
    setPasskeySupported(Boolean(window.PublicKeyCredential && navigator.credentials));
    const url = new URL(window.location.href);
    const result = url.searchParams.get("google");
    if (result === "connected" || result === "conflict" || result === "failed") {
      setGoogleResult(result);
      setOpen(true);
      url.searchParams.delete("google");
      window.history.replaceState(window.history.state, "", url);
    }
    fetch("/api/auth/google/status/", { cache: "no-store" })
      .then(
        async (response) =>
          response.ok && setGoogleAvailable((await response.json()).available === true),
      )
      .catch(() => undefined);
    const sessionCheck = new AbortController();
    const { signal } = sessionCheck;
    const timeout = window.setTimeout(() => {
      sessionCheck.abort();
      setReady(true);
    }, 5_000);
    fetch("/api/auth/me", { cache: "no-store", signal })
      .then(async (response) => {
        if (!response.ok) return;
        const { user } = await response.json();
        if (!signal.aborted) setUser(user);
      })
      .catch(() => undefined)
      .finally(() => {
        window.clearTimeout(timeout);
        if (!signal.aborted) setReady(true);
      });
    return () => {
      window.clearTimeout(timeout);
      sessionCheck.abort();
    };
  }, []);

  function dismiss() {
    setOpen(false);
    trigger.current?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: data.get("email"), password: data.get("password") }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(authErrorMessage(language, result.error, t.failed));
        return;
      }
      setUser(result.user);
      setOpen(false);
      window.dispatchEvent(new CustomEvent("loud-weekend-authenticated"));
    } catch {
      setError(t.failed);
    } finally {
      setBusy(false);
    }
  }

  async function usePasskey() {
    setBusy(true);
    setError("");
    try {
      if (mode === "register" && !email.trim()) {
        setError(t.emailRequired);
        return;
      }
      const optionsResponse = await fetch(`/api/auth/passkey/${mode}/options`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "register" ? { email } : {}),
      });
      const optionsResult = await optionsResponse.json();
      if (!optionsResponse.ok) {
        setError(authErrorMessage(language, optionsResult.error, t.failed));
        return;
      }
      const credential =
        mode === "register"
          ? await startRegistration({ optionsJSON: optionsResult.options })
          : await startAuthentication({ optionsJSON: optionsResult.options });
      const verificationResponse = await fetch(`/api/auth/passkey/${mode}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(credential),
      });
      const verificationResult = await verificationResponse.json();
      if (!verificationResponse.ok) {
        setError(authErrorMessage(language, verificationResult.error, t.failed));
        return;
      }
      setUser(verificationResult.user);
      setOpen(false);
      window.dispatchEvent(new CustomEvent("loud-weekend-authenticated"));
    } catch (reason) {
      setError(
        reason instanceof DOMException && reason.name === "NotAllowedError"
          ? t.cancelled
          : t.failed,
      );
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error(t.failed);
      setUser(null);
      setMode("login");
      setOpen(false);
      window.dispatchEvent(new CustomEvent("loud-weekend-signed-out"));
      // Reload other account surfaces; device choices remain in local storage.
      window.location.reload();
    } catch {
      setError(t.failed);
      setBusy(false);
    }
  }

  const googleForm = (mode: "link" | "login") =>
    googleAvailable && (
      <form method="post" action={`/api/auth/google/start/?mode=${mode}`}>
        <button type="submit" disabled={busy}>
          {google[mode]}
        </button>
      </form>
    );

  return (
    <div
      className="accountMenu"
      onKeyDown={(event) => {
        if (!open || event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        dismiss();
      }}
    >
      <button
        type="button"
        ref={trigger}
        className="accountButton"
        disabled={!ready}
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {user?.email ?? t.account}
      </button>
      {open && (
        <section id={panelId} className="accountPopover" aria-label={t.account}>
          {googleResult && (
            <p role={googleResult === "connected" ? "status" : "alert"}>{google[googleResult]}</p>
          )}
          {user ? (
            <>
              <strong>{user.email}</strong>
              {googleForm("link")}
              {error && <p role="alert">{error}</p>}
              <button type="button" disabled={busy} onClick={logout}>
                {busy ? t.loading : t.logout}
              </button>
              <form action="/api/auth/export" method="post">
                <button type="submit" disabled={busy}>
                  {exportLabel[language]}
                </button>
              </form>
            </>
          ) : (
            <>
              <div className="accountTabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "login"}
                  onClick={() => {
                    setMode("login");
                    setError("");
                  }}
                >
                  {t.signIn}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "register"}
                  onClick={() => {
                    setMode("register");
                    setError("");
                  }}
                >
                  {t.register}
                </button>
              </div>
              <form onSubmit={submit} aria-busy={busy}>
                {passkeySupported && mode === "login" && (
                  <>
                    <button
                      className="passkeyButton"
                      type="button"
                      disabled={busy}
                      onClick={usePasskey}
                    >
                      {busy ? t.loading : t.passkeySignIn}
                    </button>
                    <small className="accountHint">{t.passkeyHint}</small>
                    <span className="accountDivider">{t.passwordDivider}</span>
                  </>
                )}
                <label>
                  {t.email}
                  <input
                    required
                    name="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.currentTarget.value)}
                  />
                </label>
                {passkeySupported && mode === "register" && (
                  <>
                    <button
                      className="passkeyButton"
                      type="button"
                      disabled={busy}
                      onClick={usePasskey}
                    >
                      {busy ? t.loading : t.passkeyRegister}
                    </button>
                    <small className="accountHint">{t.passkeyHint}</small>
                    <span className="accountDivider">{t.passwordDivider}</span>
                  </>
                )}
                <label>
                  {t.password}
                  <input
                    required
                    minLength={mode === "register" ? 12 : 1}
                    name="password"
                    type="password"
                    autoComplete={mode === "register" ? "new-password" : "current-password"}
                  />
                </label>
                {error && <p role="alert">{error}</p>}
                <button type="submit" disabled={busy}>
                  {busy ? t.loading : mode === "login" ? t.signIn : t.register}
                </button>
              </form>
              {googleForm("login")}
              <p className="accountHint">{t.local}</p>
            </>
          )}
          <button type="button" className="accountClose" onClick={dismiss} aria-label={t.close}>
            ×
          </button>
        </section>
      )}
    </div>
  );
}
