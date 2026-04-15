"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
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
  const [scriptReady, setScriptReady] = useState(() => typeof window !== "undefined" && Boolean(window.turnstile));

  useEffect(() => {
    if (typeof window === "undefined" || scriptReady || window.turnstile) {
      return;
    }

    const interval = window.setInterval(() => {
      if (window.turnstile) {
        setScriptReady(true);
        window.clearInterval(interval);
      }
    }, 250);

    return () => {
      window.clearInterval(interval);
    };
  }, [scriptReady]);

  useEffect(() => {
    if (!scriptReady || !containerRef.current || !window.turnstile || widgetIdRef.current) {
      return;
    }

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      callback: (token: string) => onTokenChange(token),
      "expired-callback": () => onTokenChange(null),
      "error-callback": () => onTokenChange(null),
      theme: "auto",
    });

    return () => {
      if (widgetIdRef.current && window.turnstile?.remove) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [onTokenChange, scriptReady, siteKey]);

  return (
    <div className="space-y-2">
      <div ref={containerRef} />
      <p className="text-xs text-slate-500" role="status">
        {scriptReady ? "Complete the verification challenge to enable analysis." : "Loading verification challenge..."}
      </p>
    </div>
  );
}
