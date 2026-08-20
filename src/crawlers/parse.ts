/**
 * Parsing dei log di accesso del web server (Common/Combined Log Format, quello di Apache
 * e nginx di default). È l'unica fonte affidabile per sapere quali crawler hanno visitato
 * il sito e quando: nessuna scansione esterna può ricostruirlo.
 */

export interface LogEntry {
  ip: string;
  /** Timestamp della richiesta. */
  time: Date;
  method: string;
  path: string;
  status: number;
  userAgent: string;
}

// 203.0.113.7 - - [19/Aug/2026:14:03:22 +0200] "GET /pagina HTTP/1.1" 200 5123 "ref" "UA"
const LINE_PATTERN =
  /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"(\S+)\s+(\S+)[^"]*"\s+(\d{3})\s+\S+(?:\s+"[^"]*"\s+"([^"]*)")?/;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Data in formato Apache: 19/Aug/2026:14:03:22 +0200 */
export function parseLogDate(raw: string): Date | null {
  const match = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s+([+-]\d{4})$/.exec(raw);
  if (!match) return null;

  const month = MONTHS[(match[2] as string).toLowerCase()];
  if (month === undefined) return null;

  const offsetRaw = match[7] as string;
  const sign = offsetRaw.startsWith('-') ? -1 : 1;
  const offsetMinutes =
    sign * (Number(offsetRaw.slice(1, 3)) * 60 + Number(offsetRaw.slice(3, 5)));

  const utc = Date.UTC(
    Number(match[3]),
    month,
    Number(match[1]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
  return new Date(utc - offsetMinutes * 60 * 1000);
}

export function parseLogLine(line: string): LogEntry | null {
  const match = LINE_PATTERN.exec(line);
  if (!match) return null;

  const time = parseLogDate(match[2] as string);
  if (!time) return null;

  return {
    ip: match[1] as string,
    time,
    method: match[3] as string,
    path: match[4] as string,
    status: Number(match[5]),
    userAgent: match[6] ?? '',
  };
}

export interface ParsedLog {
  entries: LogEntry[];
  totalLines: number;
  unparsedLines: number;
}

export function parseLog(content: string): ParsedLog {
  const entries: LogEntry[] = [];
  let totalLines = 0;
  let unparsedLines = 0;

  for (const line of content.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    totalLines += 1;
    const entry = parseLogLine(line);
    if (entry) entries.push(entry);
    else unparsedLines += 1;
  }

  return { entries, totalLines, unparsedLines };
}
