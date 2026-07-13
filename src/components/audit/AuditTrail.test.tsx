import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AuditTrail from "./AuditTrail";
import type { AuditEvent } from "../../types";

const events: AuditEvent[] = [
  {
    id: "aud_1",
    time: "2020-01-02T00:00:00.000Z",
    type: "order_placed",
    message: "Market buy order placed.",
    orderId: "ord_1",
    symbol: "BTCUSD",
  },
  {
    id: "aud_2",
    time: "2020-01-03T00:00:00.000Z",
    type: "fill",
    message: "buy 0.05 BTCUSD filled at 7200.",
    orderId: "ord_1",
    fillId: "fil_1",
    symbol: "BTCUSD",
  },
  {
    id: "aud_3",
    time: "2020-01-04T00:00:00.000Z",
    type: "forced_liquidation",
    message: "Liquidation threshold breached; positions were closed.",
  },
];

describe("AuditTrail", () => {
  it("renders newest audit events first with typed labels", () => {
    render(<AuditTrail events={events} />);

    const trail = within(screen.getByLabelText("Replay audit trail"));
    const items = trail.getAllByRole("article");
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText("Liquidation")).toBeInTheDocument();
    expect(within(items[1]).getByText("Fill")).toBeInTheDocument();
    expect(within(items[1]).getByText("fil_1")).toBeInTheDocument();
  });

  it("shows an empty state before auditable actions happen", () => {
    render(<AuditTrail events={[]} />);

    expect(screen.getByText(/Replay audit events will appear/i)).toBeInTheDocument();
  });

  it("filters, searches, and progressively reveals the complete audit history", () => {
    render(<AuditTrail events={events} limit={1} />);

    expect(screen.getByText(/Showing 1 of 3 matching events/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Show 1 more/i }));
    expect(screen.getByText(/Showing 2 of 3 matching events/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Event type"), {
      target: { value: "risk" },
    });
    expect(screen.getByText(/Showing 1 of 1 matching events/i)).toBeInTheDocument();
    expect(screen.getByText("Liquidation")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search audit"), {
      target: { value: "does-not-exist" },
    });
    expect(screen.getByText(/No audit events match/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Search audit")).toBeInTheDocument();
  });
});
