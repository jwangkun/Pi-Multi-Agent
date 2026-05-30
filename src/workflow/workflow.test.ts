import { describe, it, expect } from 'vitest';
import { extractMeta, renderSnapshot } from './runtime.js';
import { TokenBudget } from './budget.js';
import { validateAgainstSchema, parseStructuredOutput } from './structured-output.js';
import { parallel, pipeline } from './pipeline.js';
import type { WorkflowSnapshot, AgentSnapshot } from './types.js';

describe('extractMeta', () => {
  it('parses valid meta from script', () => {
    const script = `
export const meta = {
  name: 'test_workflow',
  description: 'A test workflow',
  phases: [
    { title: 'Scan' },
    { title: 'Analyze' },
  ],
}

phase('Scan')
const result = await agent('Do something', { label: 'test' })
return result
`;

    const meta = extractMeta(script);
    expect(meta.name).toBe('test_workflow');
    expect(meta.description).toBe('A test workflow');
    expect(meta.phases).toHaveLength(2);
    expect(meta.phases[0]?.title).toBe('Scan');
    expect(meta.phases[1]?.title).toBe('Analyze');
  });

  it('throws when meta is missing', () => {
    const script = 'const x = 1';
    expect(() => extractMeta(script)).toThrow('must export a `meta` object');
  });

  it('throws when meta.name is missing', () => {
    const script = 'export const meta = { description: "test", phases: [] }';
    expect(() => extractMeta(script)).toThrow('meta.name is required');
  });

  it('throws when meta.description is missing', () => {
    const script = 'export const meta = { name: "test", phases: [] }';
    expect(() => extractMeta(script)).toThrow('meta.description is required');
  });

  it('throws when meta.phases is not an array', () => {
    const script = 'export const meta = { name: "test", description: "test", phases: "not_array" }';
    expect(() => extractMeta(script)).toThrow('meta.phases must be an array');
  });
});

describe('TokenBudget', () => {
  it('tracks token spending', () => {
    const budget = new TokenBudget(1000);
    expect(budget.total).toBe(1000);
    expect(budget.spent()).toBe(0);
    expect(budget.remaining()).toBe(1000);
    expect(budget.isExhausted()).toBe(false);

    budget.record(300);
    expect(budget.spent()).toBe(300);
    expect(budget.remaining()).toBe(700);

    budget.record(700);
    expect(budget.spent()).toBe(1000);
    expect(budget.isExhausted()).toBe(true);
  });

  it('calculates fraction correctly', () => {
    const budget = new TokenBudget(200);
    expect(budget.fraction()).toBe(0);
    budget.record(100);
    expect(budget.fraction()).toBe(0.5);
  });

  it('serializes to JSON', () => {
    const budget = new TokenBudget(500);
    budget.record(200);
    const json = budget.toJSON();
    expect(json).toEqual({ total: 500, spent: 200, remaining: 300 });
  });
});

describe('validateAgainstSchema', () => {
  it('validates a correct object', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const },
        age: { type: 'number' as const },
      },
      required: ['name'],
    };

    const result = validateAgainstSchema({ name: 'Alice', age: 30 }, schema);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects missing required properties', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const },
      },
      required: ['name'],
    };

    const result = validateAgainstSchema({}, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('Missing required property: name'))).toBe(true);
  });

  it('detects type mismatches', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        count: { type: 'number' as const },
      },
    };

    const result = validateAgainstSchema({ count: 'not a number' }, schema);
    expect(result.valid).toBe(false);
  });

  it('validates arrays with items schema', () => {
    const schema = {
      type: 'array' as const,
      items: { type: 'string' as const },
    };

    const valid = validateAgainstSchema(['a', 'b'], schema);
    expect(valid.valid).toBe(true);

    const invalid = validateAgainstSchema(['a', 1], schema);
    expect(invalid.valid).toBe(false);
  });

  it('validates enum values', () => {
    const schema = {
      type: 'string' as const,
      enum: ['red', 'green', 'blue'],
    };

    expect(validateAgainstSchema('red', schema).valid).toBe(true);
    expect(validateAgainstSchema('yellow', schema).valid).toBe(false);
  });

  it('rejects additional properties when additionalProperties is false', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const },
      },
      additionalProperties: false,
    };

    const result = validateAgainstSchema({ name: 'test', extra: 'field' }, schema);
    expect(result.valid).toBe(false);
  });
});

describe('parseStructuredOutput', () => {
  it('parses JSON from text', () => {
    const text = 'Here is the result: {"name": "test", "value": 42} end';
    const { data, validation } = parseStructuredOutput(text, {
      type: 'object',
      properties: {
        name: { type: 'string' },
        value: { type: 'number' },
      },
      required: ['name', 'value'],
    });

    expect(validation.valid).toBe(true);
    expect(data).toEqual({ name: 'test', value: 42 });
  });

  it('handles missing JSON', () => {
    const text = 'No JSON here';
    const { validation } = parseStructuredOutput(text, { type: 'object' });
    expect(validation.valid).toBe(false);
  });

  it('handles invalid JSON', () => {
    const text = '{broken json}';
    const { validation } = parseStructuredOutput(text, { type: 'object' });
    expect(validation.valid).toBe(false);
  });
});

describe('parallel', () => {
  it('runs thunks concurrently and returns results in order', async () => {
    const results = await parallel([
      () => Promise.resolve('a'),
      () => Promise.resolve('b'),
      () => Promise.resolve('c'),
    ]);
    expect(results).toEqual(['a', 'b', 'c']);
  });

  it('propagates errors', async () => {
    await expect(
      parallel([
        () => Promise.resolve('ok'),
        () => Promise.reject(new Error('fail')),
      ])
    ).rejects.toThrow('parallel thunk[1] failed: fail');
  });
});

describe('pipeline', () => {
  it('runs items through sequential stages with fan-out', async () => {
    const results = await pipeline(
      ['item1', 'item2'],
      async (prev, original, idx) => `stage1:${original}:${idx}`,
      async (prev, original, idx) => `stage2:${prev}`
    );
    expect(results).toEqual(['stage2:stage1:item1:0', 'stage2:stage1:item2:1']);
  });

  it('handles single stage', async () => {
    const results = await pipeline(
      [1, 2, 3],
      async (prev, original) => (original as number) * 2
    );
    expect(results).toEqual([2, 4, 6]);
  });
});

describe('renderSnapshot', () => {
  it('renders a workflow snapshot as text', () => {
    const snapshot: WorkflowSnapshot = {
      meta: {
        name: 'test_workflow',
        description: 'Test',
        phases: [{ title: 'Scan' }, { title: 'Analyze' }],
      },
      currentPhase: 'Analyze',
      agents: [
        { id: 1, label: 'inventory', phase: 'Scan', status: 'completed', startedAt: 1000, completedAt: 2000 },
        { id: 2, label: 'summary', phase: 'Analyze', status: 'running', startedAt: 2001 },
      ] as AgentSnapshot[],
      logs: ['Starting analysis'],
      status: 'running',
      startedAt: 1000,
      updatedAt: 3000,
    };

    const text = renderSnapshot(snapshot);
    expect(text).toContain('Workflow: test_workflow');
    expect(text).toContain('Scan');
    expect(text).toContain('Analyze');
    expect(text).toContain('inventory');
    expect(text).toContain('summary');
    expect(text).toContain('Starting analysis');
  });
});
