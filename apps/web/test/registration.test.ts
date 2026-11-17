import { describe, expect, it } from 'vitest';
import { ageGroup, detectColumns, DIVISION_PRESET, mapRows, parseCsv } from '../src/admin/registration.ts';

const divisions = DIVISION_PRESET.map((d) => d.name);

describe('parseCsv', () => {
  it('handles quotes, commas and newlines inside quotes, CRLF and a BOM', () => {
    const text = '﻿Name,Team\r\n"Delgado, Ray","Sponsor ""A"""\r\n"Multi\nLine",B\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      ['Name', 'Team'],
      ['Delgado, Ray', 'Sponsor "A"'],
      ['Multi\nLine', 'B'],
    ]);
  });
  it('keeps a final row without a trailing newline and drops blank lines', () => {
    expect(parseCsv('a,b\n\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('detectColumns', () => {
  it('matches common header names from registration tools', () => {
    const map = detectColumns(['Shooter First Name', 'Last Name', 'Age', 'Gender', 'Team Name', 'Squad #', 'E-mail', 'Cell Phone', 'Order ID']);
    expect(map).toEqual({ firstName: 0, lastName: 1, age: 2, gender: 3, team: 4, squad: 5, email: 6, phone: 7, ref: 8 });
  });
  it('recognizes a single full-name column and a division column', () => {
    expect(detectColumns(['Participant Name', 'Class'])).toEqual({ fullName: 0, division: 1 });
  });
});

describe('mapRows', () => {
  it('derives the division from age and gender using the 2026 age groups', () => {
    const data = parseCsv('First,Last,Age,Gender\nKaden,Whitfield,15,M\nEmma,Ruiz,11,F\nRay,Delgado,44,male\nAva,Kirby,18,girl');
    const { rows, problems } = mapRows(data, detectColumns(data[0]!), divisions);
    expect(problems).toEqual([]);
    expect(rows.map((r) => [r.first_name, r.division, r.is_minor])).toEqual([
      ['Kaden', 'Intermediate Male', true],
      ['Emma', 'Junior Female', true],
      ['Ray', 'Adult Male', false],
      ['Ava', 'Intermediate Female', false], // 18 is in Intermediate but not a minor
    ]);
  });

  it('accepts a division column, including "Intermediate" plus a gender column', () => {
    const data = parseCsv('Name,Division,Gender\nLisa Strand,adult female,\nNora Ortiz,Intermediate,F');
    const { rows, problems } = mapRows(data, detectColumns(data[0]!), divisions);
    expect(problems).toEqual([]);
    expect(rows.map((r) => [r.first_name, r.last_name, r.division, r.is_minor])).toEqual([
      ['Lisa', 'Strand', 'Adult Female', false],
      ['Nora', 'Ortiz', 'Intermediate Female', true], // no age: youth divisions are treated as minors
    ]);
  });

  it('an explicit minor column wins over age', () => {
    const data = parseCsv('First,Age,Minor\nSam,17,no');
    expect(mapRows(data, detectColumns(data[0]!), divisions).rows[0]!.is_minor).toBe(false);
  });

  it('reports errors and warnings per row', () => {
    const data = parseCsv('First,Last,Division,Squad,Order,Age\n,Nobody,,,,\nAl,X,Senior,,,\nBo,Y,,two,,\nCy,Z,,3,0,\nDi,W,,,,abc');
    const { problems } = mapRows(data, detectColumns(data[0]!), divisions);
    expect(problems).toEqual([
      { row: 1, level: 'error', message: 'Missing first name.' },
      { row: 2, level: 'error', message: 'Division "Senior" doesn\'t match any division for this event.' },
      { row: 3, level: 'warning', message: 'No division or age, so this shooter won’t appear in division rankings.' },
      { row: 3, level: 'error', message: 'Squad "two" must be a number.' },
      { row: 4, level: 'warning', message: 'No division or age, so this shooter won’t appear in division rankings.' },
      { row: 4, level: 'error', message: 'Shooting order "0" must be 1–99.' },
      { row: 5, level: 'warning', message: 'Age "abc" is not a number.' },
      { row: 5, level: 'warning', message: 'No division or age, so this shooter won’t appear in division rankings.' },
    ]);
  });

  it('strips a "Squad" prefix from squad numbers', () => {
    const data = parseCsv('First,Squad\nGus,Squad 7');
    expect(mapRows(data, detectColumns(data[0]!), []).rows[0]!.squad).toBe('7');
  });

  it('needs a name column', () => {
    const data = parseCsv('Team\nA');
    expect(mapRows(data, detectColumns(data[0]!), divisions).problems[0]!.level).toBe('error');
  });

  it('age groups follow the 2026 rules', () => {
    expect([12, 13, 18, 19].map(ageGroup)).toEqual(['Junior', 'Intermediate', 'Intermediate', 'Adult']);
  });
});
