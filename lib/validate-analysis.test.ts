import { describe, it, expect } from 'vitest';
import { parseAnalysis } from './validate-analysis';

const HOW_ITEM = {
  title: 'Radical Transparency',
  description: 'We publish full supply chain traceability.',
  uniqueness: 'Unique because we name every farm.',
};

const WHAT_ITEM = {
  title: 'Weekly Meal Kit',
  description: 'Organic meals traced to source.',
  why_connection: 'Because we believe you have the right to know.',
};

function makeValidJson(): string {
  const result = {
    why: {
      statement: 'We believe food transparency is a fundamental right.',
      depth_note: 'True even if product line changed entirely.',
    },
    how: Array(4).fill(HOW_ITEM),
    what: Array(3).fill(WHAT_ITEM),
    positioning_note: 'Inside-out communication gives strategic advantage.',
  };
  return JSON.stringify(result);
}

describe('parseAnalysis — happy path', () => {
  it('parses a clean JSON string', () => {
    const result = parseAnalysis(makeValidJson());
    expect(result.why.statement).toBe('We believe food transparency is a fundamental right.');
    expect(result.how).toHaveLength(4);
    expect(result.what).toHaveLength(3);
  });

  it('strips markdown code fences', () => {
    const fenced = '```json\n' + makeValidJson() + '\n```';
    const result = parseAnalysis(fenced);
    expect(result.positioning_note).toBeTruthy();
  });

  it('handles trailing commas', () => {
    // Inject a trailing comma before a closing brace and verify it is handled
    const withTrailingComma = makeValidJson().replace(
      '"positioning_note":"Inside-out communication gives strategic advantage."',
      '"positioning_note":"Inside-out communication gives strategic advantage.",',
    );
    // The fix in parseAnalysis strips the trailing comma, making it valid JSON
    expect(() => parseAnalysis(withTrailingComma)).not.toThrow();
  });

  it('extracts JSON from surrounding text', () => {
    const padded = 'Here is the result: ' + makeValidJson() + ' End.';
    const result = parseAnalysis(padded);
    expect(result.why.statement).toBeTruthy();
  });

  it('does not rewrite comma-brace sequences inside quoted strings', () => {
    const obj = JSON.parse(makeValidJson());
    obj.positioning_note = 'Keep the literal sequences ,} and ,] exactly as written.';

    const result = parseAnalysis(JSON.stringify(obj));

    expect(result.positioning_note).toBe('Keep the literal sequences ,} and ,] exactly as written.');
  });
});

describe('parseAnalysis — wrong item counts', () => {
  it('throws when how has 3 items instead of 4', () => {
    const obj = JSON.parse(makeValidJson());
    obj.how = Array(3).fill(HOW_ITEM);
    expect(() => parseAnalysis(JSON.stringify(obj))).toThrow('Invalid analysis response');
  });

  it('throws when how has 5 items instead of 4', () => {
    const obj = JSON.parse(makeValidJson());
    obj.how = Array(5).fill(HOW_ITEM);
    expect(() => parseAnalysis(JSON.stringify(obj))).toThrow('Invalid analysis response');
  });

  it('throws when what has 2 items instead of 3', () => {
    const obj = JSON.parse(makeValidJson());
    obj.what = Array(2).fill(WHAT_ITEM);
    expect(() => parseAnalysis(JSON.stringify(obj))).toThrow('Invalid analysis response');
  });
});

describe('parseAnalysis — missing fields', () => {
  it('throws when why.statement is missing', () => {
    const obj = JSON.parse(makeValidJson());
    delete obj.why.statement;
    expect(() => parseAnalysis(JSON.stringify(obj))).toThrow('Invalid analysis response');
  });

  it('throws when a how item is missing uniqueness', () => {
    const obj = JSON.parse(makeValidJson());
    obj.how[0] = { title: 'T', description: 'D' };
    expect(() => parseAnalysis(JSON.stringify(obj))).toThrow('Invalid analysis response');
  });

  it('throws when a what item is missing why_connection', () => {
    const obj = JSON.parse(makeValidJson());
    obj.what[0] = { title: 'T', description: 'D' };
    expect(() => parseAnalysis(JSON.stringify(obj))).toThrow('Invalid analysis response');
  });

  it('throws when positioning_note is empty string', () => {
    const obj = JSON.parse(makeValidJson());
    obj.positioning_note = '';
    expect(() => parseAnalysis(JSON.stringify(obj))).toThrow('Invalid analysis response');
  });
});

describe('parseAnalysis — malformed input', () => {
  it('throws on empty string', () => {
    expect(() => parseAnalysis('')).toThrow('Invalid analysis response');
  });

  it('throws on non-JSON text', () => {
    expect(() => parseAnalysis('not json at all')).toThrow('Invalid analysis response');
  });

  it('throws on valid JSON that is not an object', () => {
    expect(() => parseAnalysis('[1, 2, 3]')).toThrow('Invalid analysis response');
  });
});
