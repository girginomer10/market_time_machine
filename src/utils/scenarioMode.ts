import type { ScenarioMode } from "../types";

export function scenarioModeLabel(mode: ScenarioMode): string {
  switch (mode) {
    case "explorer":
      return "Explorer";
    case "professional":
      return "Realistic practice";
    case "blind":
      return "Blind replay";
    case "challenge":
      return "Local challenge";
  }
}

export function scenarioModeDescription(mode: ScenarioMode): string {
  switch (mode) {
    case "explorer":
      return "Flexible assumptions, full research context, and optional major-event pauses for guided learning.";
    case "professional":
      return "Scenario broker rules and structured decision plans stay locked while research context remains visible.";
    case "blind":
      return "The asset and ending stay hidden, and the replay cannot skip ahead.";
    case "challenge":
      return "A complete local replay with locked rules. It is practice, not hosted anti-cheat competition.";
  }
}
