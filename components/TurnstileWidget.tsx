"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TURNSTILE_ACTION } from "@/lib/turnstile-action";

const LOAD_TIMEOUT_MS = 8_000;

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          action?: string;
          callback: (token: string) => void;
          "expired-callback": () => void;
          "error-callback": () => void;
          theme?: "auto" | "light" | "dark";
        },
      ) => string;
      remove?: (widgetId: string) => void;
    };
  }
}

interface TurnstileWidgetProps {
  siteKey: string;
  onTokenChange: (token: string | null) => void;
}

export default function TurnstileWidget({ siteKey, onTokenChange }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(
    () => typeof window !== "undefined" && Boolean(window.turnstile),
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const resetWidget = useCallback(() => {
    onTokenChange(null);
    if (widgetIdRef.current && window.turnstile?.remove) {
      window.turnstile.remove(widgetIdRef.current);
    }
    widgetIdRef.current = null;
  }, [onTokenChange]);

  useEffect(() => {
    if (typeof window === "undefined" || scriptReady) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setLoadFailed(true);
    }, LOAD_TIMEOUT_MS);

    const interval = window.setInterval(() => {
      if (window.turnstile) {
        setScriptReady(true);
        setLoadFailed(false);
        window.clearTimeout(timeout);
        window.clearInterval(interval);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [retryKey, scriptReady]);

  useEffect(() => {
    if (!scriptReady || loadFailed || !containerRef.current || !window.turnstile || widgetIdRef.current) {
      return;
    }

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      action: TURNSTILE_ACTION,
      callback: (token: string) => {
        setLoadFailed(false);
        onTokenChange(token);
      },
      "expired-callback": () => onTokenChange(null),
      "error-callback": () => {
        resetWidget();
        setLoadFailed(true);
      },
      theme: "auto",
    });

    return () => {
      if (widgetIdRef.current && window.turnstile?.remove) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [loadFailed, onTokenChange, resetWidget, scriptReady, siteKey]);

  return (
    <div className="space-y-2">
      <div ref={containerRef} />
      <p className="text-xs text-slate-500" role="status">
        {loadFailed
          ? "Verification challenge failed to load. Disable blockers and retry."
          : scriptReady
            ? "Complete the verification challenge to enable analysis."
            : "Loading verification challenge..."}
      </p>
      {loadFailed && (
        <button
          type="button"
          onClick={() => {
            resetWidget();
            setLoadFailed(false);
            setScriptReady(Boolean(window.turnstile));
            setRetryKey((value) => value + 1);
          }}
          className="text-xs font-medium text-gold-400 underline underline-offset-4 hover:text-gold-300"
        >
          Retry verification
        </button>
      )}
    </div>
  );
}
