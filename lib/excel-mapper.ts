import * as XLSX from "xlsx";

export type ParsedClassSession = {
  weekday: number;
  start_time: string;
  end_time: string | null;
  note: string | null;
};

export type ParsedClass = {
  title: string;
  audience: "adult" | "kids" | "all";
  level: string | null;
  class_type: string | null;
  duration_minutes: number;
  price: number | null;
  sessions: ParsedClassSession[];
  instructor: string | null;
  source_row: number;
  warnings: string[];
  selected: boolean;
};

export type ClassExcelParseResult = {
  rows: ParsedClass[];
  errors: { row: number; reason: string }[];
  unmappedHeaders: string[];
  mappedHeaders: Record<string, string>;
};

const COLUMN_PATTERNS: Record<string, string[]> = {
  title: ["수업명", "수업이름", "클래스명", "클래스", "수업", "class name", "classname", "class", "name"],
  days: ["요일", "수업일", "수업요일", "day", "days", "날짜"],
  duration: ["수업시간분", "수업시간", "시간분", "소요시간", "진행시간", "duration", "length", "분"],
  start_time: ["시작시간", "수업시작", "시작", "start time", "start", "time", "시간"],
  level: ["레벨", "수준", "난이도", "등급", "level"],
  audience: ["대상", "수업대상", "연령", "성인키즈", "구분", "target", "audience"],
  price: ["가격", "수강료", "금액", "비용", "price", "fee", "요금"],
  instructor: ["강사", "선생님", "담당", "강사명", "instructor", "teacher"],
  type: ["유형", "수업유형", "종류", "class type", "classtype", "type"],
};

const normalizeHeader = (value: string) =>
  value.toLocaleLowerCase().replace(/[\\s_()[\\]·.]/g, "");

function detectColumns(headers: string[]) {
  const result: Record<string, string> = {};
  const used = new Set<string>();
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    // "수업시간(분)" is duration, while plain "시간" is a start-time candidate.
    const field = Object.entries(COLUMN_PATTERNS).find(([key, patterns]) =>
      !used.has(key) && patterns.some(pattern => normalized.includes(normalizeHeader(pattern)))
    )?.[0];
    if (field) { result[header] = field; used.add(field); }
  }
  return result;
}

function parseDays(raw: unknown): number[] {
  const value = String(raw ?? "").toLocaleLowerCase().replace(/요일/g, "");
  const map: Record<string, number> = {
    일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6,
    sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tuesday: 2,
    wed: 3, wednesday: 3, thu: 4, thursday: 4, fri: 5, friday: 5,
    sat: 6, saturday: 6,
  };
  if (/매일/.test(value)) return [0, 1, 2, 3, 4, 5, 6];
  if (/평일/.test(value)) return [1, 2, 3, 4, 5];
  if (/주말/.test(value)) return [0, 6];
  const tokens = value.split(/[,·/\\s]+/).filter(Boolean);
  const found = new Set<number>();
  for (const token of tokens) {
    if (map[token] !== undefined) found.add(map[token]);
    else if (/^[월화수목금토일]{2,7}$/.test(token)) {
      for (const char of token) found.add(map[char]);
    }
  }
  return [...found].sort((a, b) => a - b);
}

function parseTime(raw: unknown): string {
  if (typeof raw === "number" && raw >= 0 && raw < 1) {
    const total = Math.round(raw * 1440) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const match = text.match(/(오전|오후|am|pm)?\\s*(\\d{1,2})(?::(\\d{1,2})|시(?:\\s*(\\d{1,2})분?)?)?\\s*(오전|오후|am|pm)?/i);
  if (!match) return "";
  let hour = Number(match[2]);
  const minute = Number(match[3] ?? match[4] ?? 0);
  const meridiem = (match[1] || match[5] || "").toLowerCase();
  if (minute > 59 || hour > 24 || (hour === 24 && minute !== 0)) return "";
  if ((meridiem === "오후" || meridiem === "pm") && hour < 12) hour += 12;
  if ((meridiem === "오전" || meridiem === "am") && hour === 12) hour = 0;
  if (hour === 24) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseLevel(raw: unknown): string | null {
  const value = String(raw ?? "").toLowerCase();
  if (/입문|beginner/.test(value)) return "입문";
  if (/초급|기초/.test(value)) return "초급";
  if (/중급|intermediate/.test(value)) return "중급";
  if (/고급|advanced/.test(value)) return "고급";
  return value.trim() || null;
}

function parseAudience(raw: unknown): "adult" | "kids" | "all" | null {
  const value = String(raw ?? "").toLowerCase();
  if (!value || /전체|모두|all|공통/.test(value)) return "all";
  if (/키즈|아동|어린이|유아|초등|kids|child/.test(value)) return "kids";
  if (/성인|adult|어른/.test(value)) return "adult";
  return null;
}

function parsePrice(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = typeof raw === "number" ? raw : Number(String(raw).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

export function parseClassExcel(base64: string): ClassExcelParseResult {
  const workbook = XLSX.read(base64, { type: "base64", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return { rows: [], errors: [{ row: 1, reason: "첫 번째 시트를 찾을 수 없습니다." }], unmappedHeaders: [], mappedHeaders: {} };
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
  if (!rawRows.length) return { rows: [], errors: [{ row: 1, reason: "등록할 데이터가 없습니다." }], unmappedHeaders: [], mappedHeaders: {} };
  const headers = Object.keys(rawRows[0]);
  const columnMap = detectColumns(headers);
  const unmappedHeaders = headers.filter(header => !columnMap[header]);
  const get = (row: Record<string, unknown>, field: string) => {
    const header = Object.keys(columnMap).find(key => columnMap[key] === field);
    return header ? row[header] : undefined;
  };
  const rows: ParsedClass[] = [];
  const errors: { row: number; reason: string }[] = [];
  const seen = new Set<string>();
  rawRows.forEach((raw, index) => {
    const sourceRow = index + 2;
    const title = String(get(raw, "title") ?? "").trim();
    if (!title) { errors.push({ row: sourceRow, reason: "수업명이 비어 있어 제외했습니다." }); return; }
    const audienceRaw = get(raw, "audience");
    const audience = parseAudience(audienceRaw);
    if (audience === null) { errors.push({ row: sourceRow, reason: "대상은 성인·키즈·전체 중 하나로 입력해 주세요." }); return; }
    const duplicateKey = title.toLocaleLowerCase();
    if (seen.has(duplicateKey)) { errors.push({ row: sourceRow, reason: "파일 안에 같은 수업명이 있어 중복 제외했습니다." }); return; }
    seen.add(duplicateKey);
    const warnings: string[] = [];
    const durationRaw = get(raw, "duration");
    const durationNumber = durationRaw === "" || durationRaw === undefined ? 60 :
      Number(typeof durationRaw === "number" ? durationRaw : String(durationRaw).replace(/[^0-9.]/g, ""));
    if (!Number.isInteger(durationNumber) || durationNumber < 10 || durationNumber > 240) {
      errors.push({ row: sourceRow, reason: "수업 시간은 10~240분으로 입력해 주세요." }); return;
    }
    const days = parseDays(get(raw, "days"));
    const startTime = parseTime(get(raw, "start_time"));
    const sessions: ParsedClassSession[] = [];
    if (days.length && startTime) {
      for (const weekday of days) sessions.push({ weekday, start_time: startTime, end_time: null, note: null });
    } else if (get(raw, "days") || get(raw, "start_time")) {
      warnings.push("요일 또는 시작 시간을 인식하지 못해 시간표는 등록하지 않습니다.");
    }
    const priceRaw = get(raw, "price");
    const price = parsePrice(priceRaw);
    if (priceRaw === "" || priceRaw === undefined) warnings.push("가격 미입력");
    else if (price === null) warnings.push("가격을 숫자로 인식하지 못했습니다.");
    rows.push({
      title: title.slice(0, 100), audience, level: parseLevel(get(raw, "level")),
      class_type: String(get(raw, "type") ?? "").trim() || null,
      duration_minutes: durationNumber, price, sessions,
      instructor: String(get(raw, "instructor") ?? "").trim() || null,
      source_row: sourceRow, warnings, selected: true,
    });
  });
  return { rows, errors, unmappedHeaders, mappedHeaders: columnMap };
}
