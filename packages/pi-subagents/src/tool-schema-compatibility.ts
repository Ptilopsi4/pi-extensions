import { type TObject, type TObjectOptions, type TProperties, type TSchema, Type } from "typebox";

const LLAMA_CPP_MAX_REPETITION_THRESHOLD = 2_000;

/**
 * Remove large nested string repetitions that llama.cpp cannot compile into GBNF.
 *
 * Runtime normalization and validation continue to bound these inputs.
 * See https://github.com/ggml-org/llama.cpp/issues/25746.
 */
export function grammarSafeToolObject<Properties extends TProperties>(
	properties: Properties,
	options?: TObjectOptions,
): TObject<Properties> {
	return makeGrammarSafeToolSchema(Type.Object(properties, options));
}

function makeGrammarSafeToolSchema<Schema extends TSchema>(schema: Schema): Schema {
	return cloneSchema(schema, 0) as Schema;
}

function cloneSchema(schema: unknown, depth: number): unknown {
	if (!isRecord(schema)) return schema;
	const clone = cloneWithDescriptors(schema);
	if (
		depth > 1 &&
		clone.type === "string" &&
		typeof clone.maxLength === "number" &&
		clone.maxLength >= LLAMA_CPP_MAX_REPETITION_THRESHOLD
	) {
		delete clone.maxLength;
	}
	if (isRecord(clone.properties)) {
		clone.properties = mapSchemas(clone.properties, depth + 1);
	}
	if (clone.items !== undefined) {
		clone.items = Array.isArray(clone.items)
			? clone.items.map((item) => cloneSchema(item, depth + 1))
			: cloneSchema(clone.items, depth + 1);
	}
	if (Array.isArray(clone.prefixItems)) {
		clone.prefixItems = clone.prefixItems.map((item) => cloneSchema(item, depth + 1));
	}
	for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
		if (Array.isArray(clone[keyword])) {
			clone[keyword] = clone[keyword].map((item) => cloneSchema(item, depth));
		}
	}
	if (isRecord(clone.patternProperties)) {
		clone.patternProperties = mapSchemas(clone.patternProperties, depth + 1);
	}
	if (isRecord(clone.additionalProperties)) {
		clone.additionalProperties = cloneSchema(clone.additionalProperties, depth + 1);
	}
	return clone;
}

function mapSchemas(schemas: Record<string, unknown>, depth: number): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(schemas).map(([name, schema]) => [name, cloneSchema(schema, depth)]),
	);
}

function cloneWithDescriptors(value: Record<string, unknown>): Record<string, unknown> {
	return Object.defineProperties(
		Object.create(Object.getPrototypeOf(value)),
		Object.getOwnPropertyDescriptors(value),
	) as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
