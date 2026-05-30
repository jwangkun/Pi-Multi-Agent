export interface JSONSchema {
  type?: string;
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  additionalProperties?: boolean;
  description?: string;
  enum?: string[];
  anyOf?: JSONSchema[];
  oneOf?: JSONSchema[];
  allOf?: JSONSchema[];
  [key: string]: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  path: string;
  message: string;
  expected?: string;
  received?: string;
}

export function validateAgainstSchema(value: unknown, schema: JSONSchema): ValidationResult {
  const errors: ValidationError[] = [];
  validateNode(value, schema, '', errors);
  return { valid: errors.length === 0, errors };
}

function validateNode(value: unknown, schema: JSONSchema, path: string, errors: ValidationError[]): void {
  if (schema.type) {
    const actualType = getTypeOf(value);
    if (schema.type === 'integer') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        errors.push({ path, message: `Expected integer, got ${actualType}`, expected: 'integer', received: actualType });
        return;
      }
    } else if (actualType !== schema.type) {
      errors.push({ path, message: `Expected ${schema.type}, got ${actualType}`, expected: schema.type, received: actualType });
      return;
    }
  }

  if (schema.enum && !schema.enum.includes(value as string)) {
    errors.push({ path, message: `Value must be one of: ${schema.enum.join(', ')}`, expected: schema.enum.join('|'), received: String(value) });
  }

  if (schema.type === 'object' && schema.properties && typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;

    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in obj)) {
          errors.push({ path: `${path}.${key}`, message: `Missing required property: ${key}`, expected: key });
        }
      }
    }

    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in obj) {
        validateNode(obj[key], propSchema, `${path}.${key}`, errors);
      }
    }

    if (schema.additionalProperties === false) {
      const allowedKeys = new Set(Object.keys(schema.properties));
      for (const key of Object.keys(obj)) {
        if (!allowedKeys.has(key)) {
          errors.push({ path: `${path}.${key}`, message: `Additional property not allowed: ${key}` });
        }
      }
    }
  }

  if (schema.type === 'array' && Array.isArray(value)) {
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        validateNode(value[i], schema.items, `${path}[${i}]`, errors);
      }
    }
  }

  if (schema.anyOf) {
    const anyValid = schema.anyOf.some((s) => {
      const subErrors: ValidationError[] = [];
      validateNode(value, s, path, subErrors);
      return subErrors.length === 0;
    });
    if (!anyValid) {
      errors.push({ path, message: 'Value does not match any of the expected schemas' });
    }
  }
}

function getTypeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

export function parseStructuredOutput(text: string, schema: JSONSchema): { data: unknown; validation: ValidationResult } {
  let parsed: unknown;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!jsonMatch) {
      return {
        data: null,
        validation: { valid: false, errors: [{ path: '', message: 'No JSON object or array found in output' }] },
      };
    }
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return {
      data: null,
      validation: { valid: false, errors: [{ path: '', message: 'Failed to parse JSON from output' }] },
    };
  }

  const validation = validateAgainstSchema(parsed, schema);
  return { data: parsed, validation };
}
