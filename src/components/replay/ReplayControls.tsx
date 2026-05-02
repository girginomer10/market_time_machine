import { useEffect } from "react";
import { useSessionStore } from "../../store/sessionStore";
import { REPLAY_SPEEDS } from "../../domain/replay/engine";

const SELECTABLE_SPEEDS = REPLAY_SPEEDS.filter((s) => s.label !== "step");

export default function ReplayControls() {
  const status = useSessionStore((s) => s.status);
  const speed = useSessionStore((s) => s.speed);
  const currentIndex = useSessionStore((s) => s.currentIndex);
  const total = useSessionStore((s) => s.primaryCandlesLength);
  const play = useSessionStore((s) => s.play);
  const pause = useSessionStore((s) => s.pause);
  const stepForward = useSessionStore((s) => s.stepForward);
  const setSpeed = useSessionStore((s) => s.setSpeed);
  const finish = useSessionStore((s) => s.finish);
  const reset = useSessionStore((s) => s.resetScenario);

  useEffect(() => {
    if (status !== "playing") return;
    if (!Number.isFinite(speed.tickMs)) return;
    const id = window.setInterval(() => {
      stepForward();
    }, speed.tickMs);
    return () => window.clearInterval(id);
  }, [status, speed.tickMs, stepForward]);

  const isFinished = status === "finished";
  const isPlaying = status === "playing";
  const progressPct =
    total > 0 ? Math.round(((currentIndex + 1) / total) * 100) : 0;

  return (
    <div className="controls" role="toolbar" aria-label="Replay controls">
      {isPlaying ? (
        <button className="btn" onClick={pause} aria-label="Pause replay">
          Pause
        </button>
      ) : (
        <button
          className="btn primary"
          onClick={play}
          disabled={isFinished}
          aria-label="Play replay"
        >
          Play
        </button>
      )}
      <button
        className="btn"
        onClick={stepForward}
        disabled={isFinished}
        aria-label="Step forward one candle"
      >
        Step ▶
      </button>
      <div className="speed-group" aria-label="Replay speed">
        {SELECTABLE_SPEEDS.map((s) => (
          <button
            key={s.label}
            className={s.label === speed.label ? "active" : ""}
            onClick={() => setSpeed(s.label)}
            aria-pressed={s.label === speed.label}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="firewall-badge" title="Information firewall is active">
        <span className="dot mixed" /> Firewall {progressPct}%
      </div>
      <div style={{ flex: 1 }} />
      <button
        className="btn"
        onClick={finish}
        disabled={isFinished}
        title="Skip to end and reveal the report"
      >
        Skip to end
      </button>
      <button className="btn danger" onClick={reset} title="Reset replay">
        Reset
      </button>
    </div>
  );
}
