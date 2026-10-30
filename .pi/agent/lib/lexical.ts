/** English and Danish function words that carry no search signal. */
export const STOP_WORDS = new Set(
  "a about all also any an and are as at be by can could did do does for from had has have how i if in into is it its just me my may might must of on or our should so some than that the their them then there these they this those to us was we were what when where which who whom whose why will would with you your exact earlier previous af alle anden at blev bliver de dem den denne der det dette dig dine du efter eller en er et flere for fra hun hvad hvem hver hvilken hvilket hvilke hvis hvor hvordan hvorfor hvornår ikke igen jeg kan kunne lidt man mange med meget men mig min mine mod må ned noget nogle nu når og også om os over på så samme sig sin sine skal skulle som til under var vi vil ville være været".split(
    " ",
  ),
);

export interface IdentifierLexeme {
  /** Lowercased camelCase and snake_case parts. */
  readonly parts: readonly string[];
  /** The parts joined, present only for multi-part identifiers. */
  readonly compound?: string;
}

const IDENTIFIER = /[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)*/gu;
// Digits stay attached (`topic7`, `jev14`): splitting them makes lone numbers match everywhere.
const CAMEL_BOUNDARY = /(?<=\p{Ll})(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/u;

/** Splits text into identifiers and their camelCase and snake_case parts. */
export function identifierLexemes(text: string): IdentifierLexeme[] {
  return (text.match(IDENTIFIER) ?? []).map((identifier) => {
    const parts = identifier.split("_").flatMap((part) => part.split(CAMEL_BOUNDARY));
    const lowered = parts.map((part) => part.toLowerCase()).filter(Boolean);
    return lowered.length > 1 ? { parts: lowered, compound: lowered.join("") } : { parts: lowered };
  });
}
