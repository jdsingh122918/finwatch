import { z, type ZodObject, type ZodRawShape } from "zod";
import type { ToolDefinition } from "@finwatch/shared";

export type ToolHandler<T extends ZodRawShape> = (
  args: z.infer<ZodObject<T>>
) => Promise<unknown>;

export type ToolEntry<T extends ZodRawShape = ZodRawShape> = {
  name: string;
  description: string;
  inputSchema: ZodObject<T>;
  handler: ToolHandler<T>;
};

export class ToolNotFoundError extends Error {
  constructor(name: string) {
    super(`Tool not found: ${name}`);
    this.name = "ToolNotFoundError";
  }
}

export class ToolValidationError extends Error {
  constructor(toolName: string, issues: z.ZodIssue[]) {
    const details = issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
    super(`Validation failed for tool '${toolName}': ${details}`);
    this.name = "ToolValidationError";
  }
}

export class ToolExecutionError extends Error {
  constructor(toolName: string, cause: Error) {
    super(`Tool '${toolName}' execution failed: ${cause.message}`);
    this.name = "ToolExecutionError";
    this.cause = cause;
  }
}

// Internal storage type that erases the generic
type StoredTool = {
  name: string;
  description: string;
  inputSchema: ZodObject<ZodRawShape>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

export class ToolRegistry {
  private tools = new Map<string, StoredTool>();

  register<T extends ZodRawShape>(entry: ToolEntry<T>): void {
    if (this.tools.has(entry.name)) {
      throw new Error(`Tool already registered: ${entry.name}`);
    }
    this.tools.set(entry.name, {
      name: entry.name,
      description: entry.description,
      inputSchema: entry.inputSchema as unknown as ZodObject<ZodRawShape>,
      handler: entry.handler as (args: Record<string, unknown>) => Promise<unknown>,
    });
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  listTools(): string[] {
    return [...this.tools.keys()];
  }

  async execute(name: string, rawArgs: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new ToolNotFoundError(name);
    }

    // Validate input
    const parseResult = tool.inputSchema.safeParse(rawArgs);
    if (!parseResult.success) {
      throw new ToolValidationError(name, parseResult.error.issues);
    }

    // Execute handler with validated & coerced args
    try {
      return await tool.handler(parseResult.data as Record<string, unknown>);
    } catch (err) {
      throw new ToolExecutionError(
        name,
        err instanceof Error ? err : new Error(String(err))
      );
    }
  }

  getToolDefinitions(): ToolDefinition[] {
    const definitions: ToolDefinition[] = [];

    for (const tool of this.tools.values()) {
      // Convert Zod schema to JSON Schema
      const jsonSchema = zodToJsonSchema(tool.inputSchema);
      definitions.push({
        name: tool.name,
        description: tool.description,
        inputSchema: jsonSchema,
      });
    }

    return definitions;
  }
}

/**
 * Converts a Zod object schema to a JSON Schema compatible object.
 * Handles common Zod types used in tool definitions.
 */
function zodToJsonSchema(schema: ZodObject<ZodRawShape>): Record<string, unknown> {
  const shape = schema.shape;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const { jsonSchema, isOptional } = zodFieldToJsonSchema(value as z.ZodTypeAny);
    properties[key] = jsonSchema;
    if (!isOptional) {
      required.push(key);
    }
  }

  const result: Record<string, unknown> = {
    type: "object",
    properties,
  };

  if (required.length > 0) {
    result.required = required;
  }

  return result;
}

function zodFieldToJsonSchema(field: z.ZodTypeAny): {
  jsonSchema: Record<string, unknown>;
  isOptional: boolean;
} {
  let isOptional = false;
  let current: z.ZodTypeAny = field;

  // Unwrap optional
  if (current instanceof z.ZodOptional) {
    isOptional = true;
    current = current.unwrap();
  }

  // Unwrap default
  if (current instanceof z.ZodDefault) {
    isOptional = true;
    current = current._def.innerType as z.ZodTypeAny;
  }

  const schema: Record<string, unknown> = {};

  if (current instanceof z.ZodString) {
    schema.type = "string";
  } else if (current instanceof z.ZodNumber) {
    schema.type = "number";
  } else if (current instanceof z.ZodBoolean) {
    schema.type = "boolean";
  } else if (current instanceof z.ZodEnum) {
    schema.type = "string";
    schema.enum = current._def.values;
  } else if (current instanceof z.ZodArray) {
    schema.type = "array";
    const inner = zodFieldToJsonSchema(current._def.type as z.ZodTypeAny);
    schema.items = inner.jsonSchema;
  } else if (current instanceof z.ZodObject) {
    const inner = zodToJsonSchema(current as ZodObject<ZodRawShape>);
    Object.assign(schema, inner);
  } else {
    // Fallback for unhandled types
    schema.type = "object";
  }

  // Add description if present
  if (current.description) {
    schema.description = current.description;
  }

  return { jsonSchema: schema, isOptional };
}
