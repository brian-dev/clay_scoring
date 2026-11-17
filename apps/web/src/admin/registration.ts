/**
 * Turns a registration export (CSV from EventCreate, a Google Form/Sheet, etc.) into
 * rows for the import_registrations database function.
 *
 * Column names vary between tools, so headers are matched loosely ("First Name",
 * "first", "Shooter First" all work). Anything the admin needs to fix is reported
 * per row before anything is saved.
 */

export interface ImportRow {
  first_name: string;
  last_name: string;
  is_minor: boolean;
  division: string;
  team: string;
  squad: string;
  shoot_order: string;
  email: string;
  phone: string;
  registration_ref: string;
}

export type Field =
  | 'firstName' | 'lastName' | 'fullName' | 'age' | 'minor' | 'gender' | 'division'
  | 'team' | 'squad' | 'order' | 'email' | 'phone' | 'ref';

export type ColumnMap = Partial<Record<Field, number>>;

export interface Problem {
  row: number;
  message: string;
  /** Warnings import fine; errors must be fixed first. */
  level: 'warning' | 'error';
}

/** The 2026 Slayin' Clays award divisions (from the event site). */
export const DIVISION_PRESET = [
  { name: 'Adult Male', sortOrder: 1 },
  { name: 'Adult Female', sortOrder: 2 },
  { name: 'Intermediate Male', sortOrder: 3 },
  { name: 'Intermediate Female', sortOrder: 4 },
  { name: 'Junior Male', sortOrder: 5 },
  { name: 'Junior Female', sortOrder: 6 },
] as const;

/** RFC 4180-style CSV: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF, BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

const SYNONYMS: [Field, RegExp][] = [
  ['firstName', /^(shooter)?(first|firstname|fname|given|givenname)$/],
  ['lastName', /^(shooter)?(last|lastname|lname|surname|familyname)$/],
  ['fullName', /^(shooter)?(name|fullname|shootername|participant|participantname)$/],
  ['age', /^(shooter)?age(onshootday)?$/],
  ['minor', /^(minor|isminor|under18|youth)$/],
  ['gender', /^(gender|sex|malefemale|mf)$/],
  ['division', /^(division|class|category|agegroup|agedivision)$/],
  ['team', /^(team|teamname|company|sponsorteam)$/],
  ['squad', /^(squad|squadnumber|squadno|squadnum)$/],
  ['order', /^(order|shootorder|shootingorder|position|squadposition)$/],
  ['email', /^(email|emailaddress|e?mail)$/],
  ['phone', /^(phone|phonenumber|cell|mobile|cellphone)$/],
  ['ref', /^(ref|registrationid|orderid|ticketid|confirmation|confirmationnumber|id)$/],
];

export function detectColumns(headers: readonly string[]): ColumnMap {
  const map: ColumnMap = {};
  headers.forEach((h, i) => {
    const n = norm(h);
    for (const [field, re] of SYNONYMS) {
      if (map[field] === undefined && re.test(n)) {
        map[field] = i;
        return;
      }
    }
  });
  return map;
}

const truthy = (v: string) => /^(y|yes|true|1|x|minor)$/i.test(v.trim());

function genderWord(v: string): 'Male' | 'Female' | null {
  const g = v.trim().toLowerCase();
  if (/^(m|male|man|boy|men)$/.test(g)) return 'Male';
  if (/^(f|female|woman|girl|women|ladies|lady)$/.test(g)) return 'Female';
  return null;
}

/** Age group from the 2026 rules: Junior 12 and under, Intermediate 13–18, Adult 19+. */
export function ageGroup(age: number): 'Junior' | 'Intermediate' | 'Adult' {
  if (age <= 12) return 'Junior';
  if (age <= 18) return 'Intermediate';
  return 'Adult';
}

export interface MappingResult {
  rows: ImportRow[];
  problems: Problem[];
}

/**
 * @param data      parsed CSV including the header row
 * @param map       column positions (from detectColumns, possibly adjusted by the admin)
 * @param divisions division names that exist for the event
 */
export function mapRows(data: string[][], map: ColumnMap, divisions: readonly string[]): MappingResult {
  const problems: Problem[] = [];
  const rows: ImportRow[] = [];
  const divByLower = new Map(divisions.map((d) => [d.toLowerCase(), d]));
  const cell = (r: string[], f: Field) => (map[f] !== undefined ? (r[map[f]!] ?? '').trim() : '');

  if (map.firstName === undefined && map.fullName === undefined) {
    problems.push({ row: 0, level: 'error', message: 'No name column found. Choose which column holds the first name or full name.' });
    return { rows, problems };
  }

  data.slice(1).forEach((r, idx) => {
    const rowNo = idx + 1;
    let first = cell(r, 'firstName');
    let last = cell(r, 'lastName');
    if (!first && map.fullName !== undefined) {
      const full = cell(r, 'fullName').replace(/\s+/g, ' ');
      const cut = full.lastIndexOf(' ');
      first = cut > 0 ? full.slice(0, cut) : full;
      last = cut > 0 ? full.slice(cut + 1) : '';
    }
    if (!first) {
      problems.push({ row: rowNo, level: 'error', message: 'Missing first name.' });
      return;
    }

    const ageText = cell(r, 'age');
    const age = ageText && /^\d{1,3}$/.test(ageText) ? Number(ageText) : null;
    if (ageText && age === null) problems.push({ row: rowNo, level: 'warning', message: `Age "${ageText}" is not a number.` });

    // Division: explicit column, else derived from age + gender.
    let division = '';
    const divText = cell(r, 'division');
    if (divText) {
      division = divByLower.get(divText.toLowerCase()) ?? '';
      if (!division) {
        const g = genderWord(cell(r, 'gender'));
        const guess = g ? divByLower.get(`${divText} ${g}`.toLowerCase()) : undefined;
        if (guess) division = guess;
        else problems.push({ row: rowNo, level: 'error', message: `Division "${divText}" doesn't match any division for this event.` });
      }
    } else if (age !== null) {
      const g = genderWord(cell(r, 'gender'));
      const guess = g ? divByLower.get(`${ageGroup(age)} ${g}`.toLowerCase()) : undefined;
      if (guess) division = guess;
      else problems.push({ row: rowNo, level: 'warning', message: 'No division: add a gender column or a division column.' });
    } else if (divisions.length > 0) {
      problems.push({ row: rowNo, level: 'warning', message: 'No division or age, so this shooter won’t appear in division rankings.' });
    }

    // Minor: explicit column, else age, else division name (errs on the side of privacy).
    let isMinor: boolean;
    const minorText = cell(r, 'minor');
    if (minorText) isMinor = truthy(minorText);
    else if (age !== null) isMinor = age < 18;
    else isMinor = /intermediate|junior|youth/i.test(division);

    const squad = cell(r, 'squad').replace(/^squad\s*/i, '');
    if (squad && !/^\d{1,4}$/.test(squad)) problems.push({ row: rowNo, level: 'error', message: `Squad "${squad}" must be a number.` });
    const order = cell(r, 'order');
    if (order && !/^[1-9]\d?$/.test(order)) problems.push({ row: rowNo, level: 'error', message: `Shooting order "${order}" must be 1–99.` });

    rows.push({
      first_name: first,
      last_name: last,
      is_minor: isMinor,
      division,
      team: cell(r, 'team'),
      squad,
      shoot_order: order,
      email: cell(r, 'email'),
      phone: cell(r, 'phone'),
      registration_ref: cell(r, 'ref'),
    });
  });

  return { rows, problems };
}

export const FIELD_LABELS: Record<Field, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  fullName: 'Full name',
  age: 'Age',
  minor: 'Under 18 (yes/no)',
  gender: 'Gender',
  division: 'Division',
  team: 'Team',
  squad: 'Squad number',
  order: 'Shooting order',
  email: 'Email',
  phone: 'Phone',
  ref: 'Registration ID',
};
