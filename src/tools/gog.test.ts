import { expect, test, describe } from 'bun:test';
import { parseArgs, validateReadOnly, simplifyGogOutput } from './gog.js';

describe('GOG Tool - Arguments Parser', () => {
  test('should parse simple space-separated arguments', () => {
    const parsed = parseArgs("gmail search newer_than:7d");
    expect(parsed).toEqual(['gmail', 'search', 'newer_than:7d']);
  });

  test('should parse single quoted arguments with spaces', () => {
    const parsed = parseArgs("gmail search 'newer_than:7d from:me'");
    expect(parsed).toEqual(['gmail', 'search', 'newer_than:7d from:me']);
  });

  test('should parse double quoted arguments with spaces', () => {
    const parsed = parseArgs('gmail search "newer_than:7d from:me"');
    expect(parsed).toEqual(['gmail', 'search', 'newer_than:7d from:me']);
  });

  test('should parse nested options correctly', () => {
    const parsed = parseArgs("calendar events primary --from '2026-05-20T00:00:00Z'");
    expect(parsed).toEqual(['calendar', 'events', 'primary', '--from', '2026-05-20T00:00:00Z']);
  });
});

describe('GOG Tool - Read-Only Validator', () => {
  test('should allow gmail search and get/raw/cat commands', () => {
    expect(validateReadOnly(['gmail', 'search', 'newer_than:7d'])).toBe(true);
    expect(validateReadOnly(['gmail', 'get', 'msgId'])).toBe(true);
    expect(validateReadOnly(['gmail', 'cat', 'msgId'])).toBe(true);
    expect(validateReadOnly(['gmail', 'messages', 'search', 'in:inbox'])).toBe(true);
    expect(validateReadOnly(['gmail', 'messages', 'get', 'msgId'])).toBe(true);
    expect(validateReadOnly(['gmail', 'messages', 'cat', 'msgId'])).toBe(true);
    expect(validateReadOnly(['gmail', 'drafts', 'get', 'draftId'])).toBe(true);
  });

  test('should reject gmail write/send/draft commands', () => {
    expect(validateReadOnly(['gmail', 'send', '--to', 'a@b.com'])).toBe(false);
    expect(validateReadOnly(['gmail', 'drafts', 'create'])).toBe(false);
    expect(validateReadOnly(['gmail', 'reply', '--to', 'a@b.com'])).toBe(false);
  });

  test('should allow calendar read commands', () => {
    expect(validateReadOnly(['calendar', 'events', 'primary'])).toBe(true);
    expect(validateReadOnly(['calendar', 'colors'])).toBe(true);
  });

  test('should reject calendar create/update commands', () => {
    expect(validateReadOnly(['calendar', 'create', 'primary'])).toBe(false);
    expect(validateReadOnly(['calendar', 'update', 'primary'])).toBe(false);
  });

  test('should allow drive search and list/download', () => {
    expect(validateReadOnly(['drive', 'search', 'query'])).toBe(true);
    expect(validateReadOnly(['drive', 'ls'])).toBe(true);
    expect(validateReadOnly(['drive', 'list'])).toBe(true);
    expect(validateReadOnly(['drive', 'download', 'fileId'])).toBe(true);
  });

  test('should allow sheets get and metadata', () => {
    expect(validateReadOnly(['sheets', 'get', 'sheetId', 'Tab!A1'])).toBe(true);
    expect(validateReadOnly(['sheets', 'metadata', 'sheetId'])).toBe(true);
  });

  test('should reject sheets write/update/append/clear', () => {
    expect(validateReadOnly(['sheets', 'update', 'sheetId'])).toBe(false);
    expect(validateReadOnly(['sheets', 'append', 'sheetId'])).toBe(false);
    expect(validateReadOnly(['sheets', 'clear', 'sheetId'])).toBe(false);
  });

  test('should allow docs cat but reject export', () => {
    expect(validateReadOnly(['docs', 'cat', 'docId'])).toBe(true);
    expect(validateReadOnly(['docs', 'export', 'docId'])).toBe(false);
  });
});

describe('GOG Tool - Arguments Parser escaping and contractions', () => {
  test('should handle backslash escaped quotes', () => {
    const parsedDouble = parseArgs('gmail search \\"hello\\"');
    expect(parsedDouble).toEqual(['gmail', 'search', '"hello"']);

    const parsedSingle = parseArgs("gmail search \\'hello\\'");
    expect(parsedSingle).toEqual(['gmail', 'search', "'hello'"]);
  });

  test('should not toggle quote state on contractions', () => {
    const parsedContraction = parseArgs("gmail search don't");
    expect(parsedContraction).toEqual(['gmail', 'search', "don't"]);

    const parsedContractionInQuotes = parseArgs("gmail search 'don't do it'");
    expect(parsedContractionInQuotes).toEqual(['gmail', 'search', "don't do it"]);
  });
});

describe('GOG Tool - Output Simplification', () => {
  test('should format gmail search JSON outputs nicely', () => {
    const rawStdout = JSON.stringify({
      threads: [
        { id: 'msg1', from: 'Test From', subject: 'Test Subject', date: '2026-05-21 12:00' }
      ]
    });
    const simplified = simplifyGogOutput(rawStdout, ['gmail', 'search', 'test']);
    expect(simplified).toContain('[Mensajes encontrados en Gmail');
    expect(simplified).toContain('#1 | ID: "msg1" | De: "Test From" | Asunto: "Test Subject"');
    expect(simplified).toContain('El correo #1 es el ÚLTIMO recibido');
  });

  test('should format gmail get message JSON outputs nicely', () => {
    const rawStdout = JSON.stringify({
      id: 'msg1',
      from: 'Sender Name',
      date: '2026-05-21 10:00',
      subject: 'My Subject',
      snippet: 'This is the body content of the mail.'
    });
    const simplified = simplifyGogOutput(rawStdout, ['gmail', 'get', 'msg1']);
    expect(simplified).toContain('[Detalles del Correo de Gmail]');
    expect(simplified).toContain('ID: "msg1"');
    expect(simplified).toContain('De: "Sender Name"');
    expect(simplified).toContain('Asunto: "My Subject"');
    expect(simplified).toContain('This is the body content of the mail.');
  });
});

