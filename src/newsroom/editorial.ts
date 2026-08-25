// ─── Who works here ───
//
// portaBaltica's newsroom is a small crew of disclosed AI agents overseen by
// one accountable human. This module is the single place their names, roles and
// disclosure labels are defined, so no page can invent a variant.
//
// HOUSE NAMING
// ------------
// Everyone in the newsroom carries the surname of a Baltic lighthouse or
// coastal station. It is a house style, not a disguise: the reader is told what
// each agent is by an explicit label, never left to infer it from a name.
// Surnames like Kolka or Akmeņrags read as places rather than family names,
// which quietly reinforces the label instead of fighting it.
//
// The human keeps a lighthouse surname too. He is the masthead, so he belongs
// to the same house — and because the AI/human distinction is carried by the
// role label rather than by the name, nothing is blurred by including him.

/** Appended to every correspondent byline. The validator looks for exactly this. */
export const BYLINE_SUFFIX = 'AI correspondent';

/** Appended wherever the editor is named. Same rule, same reason. */
export const EDITOR_SUFFIX = 'AI editor';

/**
 * The AI editor. Reviews what the correspondents file, sends work back with
 * notes, and decides what publishes. Not a rubber stamp, and not a human.
 */
export const AI_EDITOR = {
  id: 'saulkrasti',
  name: 'Dace Saulkrasti',
  role: EDITOR_SUFFIX,
} as const;

/**
 * The accountable human. Oversight only: he does not write, and does not
 * approve stories one by one — he answers for the system that does.
 */
export const ACCOUNTABLE_PUBLISHER = 'Andre Kõpu';

/** What he is, wherever he is named. */
export const PUBLISHER_ROLE = 'accountable publisher';

/**
 * Names this masthead has used before.
 *
 * Articles published earlier stored the publisher's previous name in
 * `provenance.accountable_editor`. It is the same person, so printing the
 * stored string verbatim would show two names for one human and imply a
 * handover that never happened. Mapping the old name to the current one is a
 * display concern rather than a rewrite of provenance: the stored JSON is
 * untouched and the archived value remains what it always was.
 */
const PREVIOUS_PUBLISHER_NAMES = new Set([
  'Sam Samoletovs',
  'Sam Samoletov',
  'Andre Ovīši',
]);

/** Resolves whatever an article stored into the name to print today. */
export function publisherName(stored?: string | null): string {
  const value = stored?.trim();
  if (!value) return ACCOUNTABLE_PUBLISHER;
  return PREVIOUS_PUBLISHER_NAMES.has(value) ? ACCOUNTABLE_PUBLISHER : value;
}
