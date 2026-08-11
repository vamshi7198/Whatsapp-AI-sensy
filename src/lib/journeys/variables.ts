/**
 * Filling {{name}} placeholders in a journey's messages.
 *
 * Deliberately not a template language. Anything more — expressions, loops,
 * conditionals inside text — becomes a thing the operator has to debug in a
 * message a real customer already received.
 *
 * An unknown placeholder is replaced with nothing rather than left visible.
 * "Hi {{first_name}}" reaching a customer as literal braces looks broken in a
 * way that a slightly bare "Hi" does not.
 */

/** What can be dropped into a message. Grouped for the picker in the builder. */
export const BUILT_IN_VARIABLES = [
  { key: "name", label: "Full name", group: "Contact" },
  { key: "first_name", label: "First name", group: "Contact" },
  { key: "phone", label: "Phone number", group: "Contact" },
  { key: "email", label: "Email", group: "Contact" },
] as const;

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Values derived from other values, so the operator does not have to.
 *
 * first_name is the one people actually want: "Hi Vamshi" reads better than
 * "Hi Vamshi Preetham Ella" in a chat.
 */
function derive(values: Record<string, unknown>): Record<string, unknown> {
  const name = typeof values.name === "string" ? values.name.trim() : "";

  return {
    ...values,
    ...(name && values.first_name === undefined
      ? { first_name: name.split(/\s+/)[0] }
      : {}),
  };
}

/** Replaces every {{placeholder}} with its value. */
export function render(
  text: string,
  values: Record<string, unknown>,
): string {
  if (!text) return "";

  const all = derive(values);

  return text.replace(PLACEHOLDER, (_match, key: string) => {
    const value = all[key];

    if (value === null || value === undefined) return "";
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value === "object") return "";

    return String(value);
  });
}

/** The placeholders a piece of text uses, for validation and the picker. */
export function usedVariables(text: string): string[] {
  const found = new Set<string>();

  for (const match of text.matchAll(PLACEHOLDER)) {
    found.add(match[1]);
  }

  return [...found];
}

/**
 * Placeholders that nothing will ever fill.
 *
 * Reported before publishing, because a message that silently loses a word is
 * worse than one that never went out.
 */
export function unknownVariables(
  text: string,
  available: string[],
): string[] {
  const known = new Set([
    ...available,
    ...BUILT_IN_VARIABLES.map((v) => v.key),
  ]);

  return usedVariables(text).filter((key) => !known.has(key));
}
