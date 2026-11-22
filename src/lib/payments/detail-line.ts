/* One line of a receiving account's details, as the env var holds it —
   "IBAN: BE56 9059 8872 9188" — split for display. Shared by the checkout
   page and the details email so the two can never label the same line
   differently. A line with no label stays whole. */

export interface DetailLine {
  label: string;
  value: string;
}

export function splitDetailLine(line: string): DetailLine {
  const at = line.indexOf(":");
  if (at > 0 && at <= 40) {
    const value = line.slice(at + 1).trim();
    if (value) return { label: line.slice(0, at).trim(), value };
  }
  return { label: "Detail", value: line.trim() };
}
