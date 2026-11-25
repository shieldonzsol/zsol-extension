// The chip's look, inside its own shadow root: zSol's tokens, nothing from the page.
export const CHIP_CSS = `
:host { all: initial; }
.chip {
  --bg: #ffffff; --fg: #161616; --muted: #4d4d4d; --border: #dcdcdc; --primary: #00549a;
  --primary-fg: #ffffff; --frost: rgba(0, 84, 154, 0.07); --sell: #a10128;
  position: fixed; right: 16px; bottom: 16px; max-width: 240px;
  font: 13px/1.35 Inter, ui-sans-serif, system-ui, sans-serif; color: var(--fg);
}
@media (prefers-color-scheme: dark) {
  .chip {
    --bg: #171717; --fg: #f3f3f3; --muted: #c4c4c4; --border: #383838; --primary: #5cbafe;
    --primary-fg: #0a0a0a; --frost: rgba(92, 186, 254, 0.1); --sell: #ff8e96;
  }
}
.chip:not(:has(.mark)) {
  background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18); display: flex; flex-direction: column; gap: 8px;
}
.head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-weight: 600; }
p { margin: 0; }
.token { font-weight: 600; }
.quiet, .status { color: var(--muted); }
.row { display: flex; flex-wrap: wrap; gap: 6px; }
button {
  font: inherit; cursor: pointer; border-radius: 7px; border: 1px solid var(--border);
  background: var(--frost); color: var(--fg); padding: 5px 9px;
}
button:disabled { opacity: 0.5; cursor: default; }
button.sell { color: var(--sell); }
button.quiet { background: transparent; border-color: transparent; color: var(--muted); padding: 2px 4px; }
button.mark {
  background: var(--primary); color: var(--primary-fg); border: none; font-weight: 700;
  border-radius: 999px; padding: 8px 12px; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.2);
}
a { color: var(--primary); }
`;
