// name-check.js — stops names or nicknames that use a slur or a swear word.
// Deliberately not strict: a word only counts when it stands on its own (separated by spaces or punctuation), never
// when it's part of a longer word or name, so names that happen to contain those letters are fine. It does see through
// the easy disguises inside one word: capitals, accents, numbers or symbols for letters ("sh1t", "$hit") and stretched
// letters ("shiiit"). Words that are also ordinary names, nicknames or words in other languages (e.g. Dick, Willy,
// Fanny, Gay, Cox, Dyke, Kike, Negro) are left out on purpose.
// To change what's blocked, edit BLOCKED (lowercase, one word each).

const BLOCKED = [
  // swear words
  "fuck", "fucks", "fucked", "fucker", "fuckers", "fucking", "fuckin", "fuckface", "fuckhead", "motherfucker", "motherfuckers", "motherfucking",
  "shit", "shits", "shitty", "shithead", "shitheads", "bullshit", "bitch", "bitches", "bitchy",
  "cunt", "cunts", "asshole", "assholes", "arsehole", "arseholes", "bastard", "bastards",
  "pussy", "pussies", "whore", "whores", "slut", "sluts", "twat", "twats", "wanker", "wankers",
  "dickhead", "dickheads", "cocksucker", "cocksuckers", "jizz", "dildo",
  // slurs
  "nigger", "niggers", "nigga", "niggas", "niggaz",
  "faggot", "faggots", "fag", "fags", "tranny", "trannies",
  "retard", "retards", "retarded",
  "chink", "chinks", "gook", "gooks", "spic", "spics", "wetback", "wetbacks",
  "paki", "pakis", "beaner", "beaners", "raghead", "ragheads", "towelhead", "towelheads",
];

// letters people swap in for others
const SWAPS = { "0": "o", "1": "i", "!": "i", "|": "i", "3": "e", "4": "a", "@": "a", "5": "s", "$": "s", "7": "t", "+": "t", "8": "b", "9": "g" };
const squash = (w) => w.replace(/(.)\1+/g, "$1"); // stretched letters count once ("shiiit" → "shit"; the list is compared the same way)
const BLOCKED_SET = new Set(BLOCKED.map(squash));

/** true if the name uses a blocked word as a word of its own */
export function nameIsBlocked(name) {
  const plain = String(name || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, ""); // (accents off)
  // words: runs of letters, digits and the swap symbols; anything else (spaces, brackets, dashes, dots…) separates them
  const words = plain.match(/[a-z0-9@$!|+]+/g) || [];
  // a word spelled out one letter at a time ("c.u.n.t", "f a g") also counts as that word
  for (const run of plain.match(/(?:^|[^a-z0-9@$!|+])((?:[a-z0-9@$!|+][^a-z0-9@$!|+]+){2,}[a-z0-9@$!|+])(?![a-z0-9@$!|+])/g) || [])
    words.push(run.replace(/[^a-z0-9@$!|+]/g, ""));
  return words.some((w) => {
    const letters = [...w].map((c) => SWAPS[c] ?? c).join("");
    if (!/^[a-z]+$/.test(letters)) return false; // still has digits in it: an ordinary number or code, not a word
    return BLOCKED_SET.has(squash(letters));
  });
}
