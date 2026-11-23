import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import type {
  JsonSchemaType,
  JsonSchemaValidator,
} from '@modelcontextprotocol/sdk/validation/types.js';

import { McpToolError, MCP_ERROR_CODES } from '../tools/errors';
import type { McpToolDefinition } from '../tools/types';

/**
 * Argument names any tool accepts besides its schema: a caller that runs a
 * call on the user's confirmation adds them to dedupe its retries. A tool
 * that uses one declares it in its schema.
 */
export const RESERVED_ARGUMENTS: readonly string[] = [
  'idempotencyKey',
  'toolCallId',
];

const ajv = new AjvJsonSchemaValidator();
const validators = new WeakMap<
  McpToolDefinition,
  JsonSchemaValidator<unknown>
>();

function validatorOf(tool: McpToolDefinition): JsonSchemaValidator<unknown> {
  let validator = validators.get(tool);
  if (!validator) {
    // Undeclared top-level arguments are dropped before validation, so the
    // top-level `additionalProperties` never has anything to refuse.
    const schema = { ...tool.inputSchema };
    delete schema.additionalProperties;
    validator = ajv.getValidator(schema as JsonSchemaType);
    validators.set(tool, validator);
  }
  return validator;
}

/**
 * The arguments a tool runs with, or the refusal of the call.
 *
 * - An argument the schema does not declare is dropped: it never reaches the
 *   tool, so it is never forwarded to the gateway. Clients add their own
 *   keys (hints, tracing ids), and refusing them would break those clients
 *   for no gain. The reserved retry keys are kept.
 * - What the schema declares is enforced: a wrong type, an unknown enum
 *   value, a missing required argument or a malformed id (a `pattern`) is
 *   refused as `INVALID_ARGUMENT`, naming the problem, rather than forwarded
 *   to be ignored or answered by a less precise upstream error.
 */
export function prepareToolArguments(
  tool: McpToolDefinition,
  args: Record<string, unknown>,
): { args: Record<string, unknown> } | { error: McpToolError } {
  const schema = tool.inputSchema;
  const properties = (schema.properties ?? {}) as Record<string, unknown>;
  const open =
    schema.type !== 'object' ||
    (schema.additionalProperties !== undefined &&
      schema.additionalProperties !== false);
  const kept: Record<string, unknown> = {};
  const declared: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (open || key in properties) {
      kept[key] = value;
      declared[key] = value;
    } else if (RESERVED_ARGUMENTS.includes(key)) {
      kept[key] = value;
    }
  }
  const result = validatorOf(tool)(declared);
  if (!result.valid) {
    return {
      error: new McpToolError(
        MCP_ERROR_CODES.INVALID_ARGUMENT,
        `Invalid arguments for ${tool.name}: ${result.errorMessage.replace(/\bdata\b/g, 'arguments')}`,
      ),
    };
  }
  return { args: kept };
}
