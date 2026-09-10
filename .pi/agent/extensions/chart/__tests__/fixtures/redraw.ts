import {
  type Component,
  Input,
  type Terminal,
  TuiAltScreen,
  TuiMainScreen,
} from "@earendil-works/pi-tui";

/** Real Pi input dispatch and renderer; the terminal sink records bytes, not display latency. */
export function measureRedraw(component: Component, fullscreen: boolean) {
  let onInput: (data: string) => void = () => {};
  let output = "";
  const terminal: Terminal = {
    columns: 80,
    rows: 40,
    kittyProtocolActive: false,
    start(input) {
      onInput = input;
    },
    stop() {},
    async drainInput() {},
    write(data) {
      output += data;
    },
    moveBy() {},
    hideCursor() {},
    showCursor() {},
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},
    setTitle() {},
    setProgress() {},
  };
  const tui = fullscreen ? new TuiAltScreen(terminal) : new TuiMainScreen(terminal);
  const input = new Input();
  tui.addChild(component);
  tui.addChild(input);
  tui.setFocus(input);
  tui.start();
  tui.renderNow();
  const initialTransmissions = output
    .split("\u001b_G")
    .slice(1)
    .filter((sequence) => sequence.split(";", 1)[0]?.includes("a=T")).length;
  // Warm the same dispatch/diff path before collecting 100 independent input redraws.
  for (let i = 0; i < 20; i++) {
    onInput(i % 2 === 0 ? "x" : "\u007f");
    tui.renderNow();
  }
  output = "";
  const times: number[] = [];
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    onInput(i % 2 === 0 ? "x" : "\u007f");
    tui.renderNow();
    times.push(performance.now() - start);
  }
  const bytes = Buffer.byteLength(output);
  const transmissions = output
    .split("\u001b_G")
    .slice(1)
    .filter((sequence) => sequence.split(";", 1)[0]?.includes("a=T")).length;
  tui.stop();
  times.sort((a, b) => a - b);
  return {
    fullscreen,
    initialTransmissions,
    transmissions,
    bytes,
    medianMs: times[50],
    p95Ms: times[95],
  };
}
