/**
 * THE ONE CANONICAL SERIALISATION IN THE RENDER PATH — the function that decides
 * what an agreement's hash is computed over.
 *
 * WHY IT IS ITS OWN FILE (Carl, 12 September 2026; found by the reuse inventory).
 * This function was declared FOUR times inside `apps/core/src/render`: in
 * `renderer.ts`, in `agreement-document.ts`, and privately in `pdf-renderer.ts`
 * — three independent copies, none importing another, all feeding a SHA-256 that
 * ends up on a stored agreement.
 *
 * They were character-for-character equivalent, so nothing was ever wrong. That
 * is precisely why it was worth fixing: hard rule 13 requires ONE deterministic
 * render path, hashed at render and re-verified on every later display, with two
 * renders of the same agreement byte-identical. A hash function that exists
 * three times is a hash function that can diverge once — and the divergence
 * would be silent. Nothing would fail at the moment of the change; an old
 * agreement would simply stop verifying, months later, and the cause would be a
 * tidy-up nobody connected to it.
 *
 * THE VAULT KEEPS ITS OWN, DELIBERATELY (`apps/vault/src/chain/hash.ts`). The
 * vault is a human-authored zone (CLAUDE.md §7) and a separate service; its hash
 * chain is its own artefact and must not acquire a build-time dependency on the
 * core's render path. Two services that hash different things may each own their
 * serialisation. What must not happen is one service hashing one thing three
 * ways.
 *
 * ---
 *
 * THE RULES THIS ENCODES, none of which may change without changing every hash
 * ever computed:
 *
 *   - Object keys are sorted with the default `Array.prototype.sort` — UTF-16
 *     code-unit order, not locale order. `'Z'` sorts before `'a'`; `'ä'` sorts
 *     after both. Locale-aware sorting would be a different function.
 *   - Arrays keep their order. Order is meaning.
 *   - Scalars, and anything that is not an object, go through `JSON.stringify`.
 *
 * AND ONE DELIBERATE WART, PRESERVED. A property whose value is `undefined` is
 * serialised as the literal `undefined` — `{"n":null,"u":undefined}` — because
 * `JSON.stringify(undefined)` returns `undefined` (the value, not the string)
 * and template interpolation renders it. That is not valid JSON.
 *
 * IT IS KEPT ON PURPOSE. This output is never parsed; it is hashed. Every
 * agreement stored to date was hashed by a function that behaves this way, so
 * "fixing" it — dropping such keys, or emitting `null` — would change the digest
 * of every future render and quietly break the comparison against every past
 * one. If it is ever corrected it must be a versioned renderer change, with the
 * old behaviour retained for verifying old artefacts (hard rule 14's reasoning,
 * applied to a hash). `canonical_json_keeps_its_exact_output` pins this.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}
