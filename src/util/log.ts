const useColor = process.env.NO_COLOR === undefined && process.stdout.isTTY === true;

const wrap = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

export const color = {
  dim: wrap("2"),
  bold: wrap("1"),
  red: wrap("31"),
  green: wrap("32"),
  yellow: wrap("33"),
  blue: wrap("34"),
  cyan: wrap("36"),
};

export function stamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

export function info(msg: string): void {
  console.log(`${color.dim(stamp())} ${msg}`);
}

export function step(msg: string): void {
  console.log(`\n${color.cyan(`== ${msg}`)}`);
}

export function ok(msg: string): void {
  console.log(`${color.dim(stamp())} ${color.green(msg)}`);
}

export function warn(msg: string): void {
  console.log(`${color.dim(stamp())} ${color.yellow(msg)}`);
}

export function fail(msg: string): void {
  console.error(`${color.dim(stamp())} ${color.red(msg)}`);
}

export function humanDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
