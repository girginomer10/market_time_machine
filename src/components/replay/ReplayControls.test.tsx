import { fireEvent, render, screen } from "@testing-library/react";
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

  it("lets Explorer users control major-event auto-pause and announces a pause", () => {
    useSessionStore.setState({
      mode: "explorer",
      status: "paused",
      pauseOnMajorEvents: true,
      majorEventPauseNotice: {
        eventId: "event-1",
        title: "Central bank emergency decision",
        publishedAt: "2020-03-15T12:00:00.000Z",
      },
    });
    render(<ReplayControls onRequestReset={vi.fn()} />);

    const preference = screen.getByRole("checkbox", {
      name: "Auto-pause on major events",
    });
    expect(preference).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Paused for major event: Central bank emergency decision",
    );

    fireEvent.click(preference);
    expect(useSessionStore.getState().pauseOnMajorEvents).toBe(false);
  });

  it("locks major-event auto-pause outside Explorer mode", () => {
    useSessionStore.setState({
      mode: "professional",
      status: "paused",
      pauseOnMajorEvents: false,
    });
    render(<ReplayControls onRequestReset={vi.fn()} />);

    expect(
      screen.getByRole("checkbox", { name: "Auto-pause on major events" }),
    ).toBeDisabled();
  });
});
