import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "../../store/sessionStore";
import ReplayControls from "./ReplayControls";

describe("ReplayControls", () => {
  beforeEach(() => {
    useSessionStore.getState().resetScenario();
  });

  it("hides total progress and skip-to-end during a local challenge", () => {
    useSessionStore.setState({ mode: "challenge", status: "paused" });
    render(<ReplayControls onRequestReset={vi.fn()} />);

    expect(screen.getByText("Firewall active")).toBeInTheDocument();
    expect(screen.queryByText(/Firewall \d+%/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip to end" })).toBeDisabled();
  });
});
