import { Repeat } from "solid-js";

const CONFETTI_PIECES = 56;

const CONFETTI_COLORS = [
  "var(--gold)",
  "var(--accent)",
  "var(--flip-three)",
  "var(--success)",
  "var(--danger)",
  "var(--freeze-ink)",
] as const;

const GOLDEN_RATIO = 0.618034;

const scatter = (index: number, salt: number) =>
  ((index + 1) * (GOLDEN_RATIO + salt)) % 1;

const Confetti = () => (
  <div class="confetti" aria-hidden="true">
    <Repeat count={CONFETTI_PIECES}>
      {(index) => (
        <span
          class="confetti-piece"
          style={{
            "--confetti-color": CONFETTI_COLORS[index % CONFETTI_COLORS.length],
            "--confetti-delay": `${Math.round(scatter(index, 0.11) * 600)}ms`,
            "--confetti-drift": `${Math.round((scatter(index, 0.23) - 0.5) * 16)}rem`,
            "--confetti-fall": `${Math.round(2200 + scatter(index, 0.37) * 1400)}ms`,
            "--confetti-spin": `${Math.round((scatter(index, 0.41) - 0.5) * 1440)}deg`,
            "--confetti-x": `${Math.round(scatter(index, 0) * 100)}%`,
          }}
        />
      )}
    </Repeat>
  </div>
);

export default Confetti;
