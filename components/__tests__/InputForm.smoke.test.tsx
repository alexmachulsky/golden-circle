import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import InputForm from "../InputForm";

// Keep the test self-contained — the real EXAMPLES array isn't relevant here
vi.mock("@/lib/prompt", () => ({
  EXAMPLES: [],
}));

describe("InputForm", () => {
  it("renders the text area", () => {
    render(<InputForm onSubmit={vi.fn()} loading={false} error={null} />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("disables the Analyze button when input is below the minimum length", () => {
    render(<InputForm onSubmit={vi.fn()} loading={false} error={null} />);
    expect(screen.getByRole("button", { name: /analyze/i })).toBeDisabled();
  });

  it("renders an error message when the error prop is set", () => {
    render(
      <InputForm onSubmit={vi.fn()} loading={false} error="Something went wrong" />
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });
});
