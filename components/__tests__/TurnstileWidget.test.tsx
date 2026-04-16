import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TurnstileWidget from "../TurnstileWidget";

describe("TurnstileWidget", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete window.turnstile;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete window.turnstile;
  });

  it("surfaces a load failure with a retry action", () => {
    render(<TurnstileWidget siteKey="site-key" onTokenChange={vi.fn()} />);

    act(() => {
      vi.advanceTimersByTime(8_500);
    });

    expect(
      screen.getByText(/verification challenge failed to load/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry verification/i })).toBeInTheDocument();
  });

  it("returns to the loading state when retry is clicked", () => {
    render(<TurnstileWidget siteKey="site-key" onTokenChange={vi.fn()} />);

    act(() => {
      vi.advanceTimersByTime(8_500);
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /retry verification/i }));
    });

    expect(screen.getByText(/loading verification challenge/i)).toBeInTheDocument();
  });
});
