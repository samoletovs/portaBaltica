// Editorial constants, deliberately in their own module.
//
// The masthead needs the accountable editor's name on every page, including
// the front page. Importing it from the full correspondent registry would drag
// all five personas into the entry chunk for the sake of one string.

/** Appended to every byline. The validator's `byline_discloses_ai` check looks for exactly this. */
export const BYLINE_SUFFIX = 'AI correspondent';

/** The human who answers for everything published here. */
export const ACCOUNTABLE_EDITOR = 'Sam Samoletovs';
