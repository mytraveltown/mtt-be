// Keep these in sync with peek-a-search-main/src/lib/wordLimit.ts.

/** Maximum words in a saved agent "about" text; also the word target given to the AI. */
const ABOUT_MAX_WORDS = 200;

/** Maximum words in a saved package location_description; also the word target given to the AI. */
const LOCATION_DESCRIPTION_MAX_WORDS = 200;

/** Maximum words accepted as raw input before the AI condenses it to the saved limit. */
const TEXT_INPUT_MAX_WORDS = 1300;

const countWords = (text) => String(text ?? "").match(/\S+/g)?.length ?? 0;

/** Cuts text off right before the word that would exceed `maxWords`, keeping the original spacing. */
const limitWords = (text, maxWords) => {
  let wordIndex = 0;
  for (const match of String(text ?? "").matchAll(/\S+/g)) {
    if (wordIndex === maxWords) return text.slice(0, match.index);
    wordIndex += 1;
  }
  return text;
};

module.exports = {
  ABOUT_MAX_WORDS,
  LOCATION_DESCRIPTION_MAX_WORDS,
  TEXT_INPUT_MAX_WORDS,
  countWords,
  limitWords,
};
