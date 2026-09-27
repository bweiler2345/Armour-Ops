// Temporary passwords are generated on the server, shown to the owner once,
// and never stored or logged by Armour Ops.
//
// 16 characters from a 31-character alphabet with look-alike characters
// removed (no 0/o, 1/l/i), about 79 bits of randomness. Shown in groups of
// four so it is easy to text and type on a phone. The hyphens are part of the
// password.

export const TEMPORARY_PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const LENGTH = 16;
const GROUP = 4;

type RandomSource = (bytes: Uint8Array) => Uint8Array;

const defaultRandom: RandomSource = (bytes) => crypto.getRandomValues(bytes);

export function generateTemporaryPassword(random: RandomSource = defaultRandom) {
  const alphabet = TEMPORARY_PASSWORD_ALPHABET;
  // Reject bytes above the largest multiple of the alphabet size so every
  // character is equally likely (no modulo bias).
  const limit = 256 - (256 % alphabet.length);
  const chars: string[] = [];

  while (chars.length < LENGTH) {
    const bytes = random(new Uint8Array(LENGTH * 2));
    for (const byte of bytes) {
      if (byte >= limit) continue;
      chars.push(alphabet[byte % alphabet.length]);
      if (chars.length === LENGTH) break;
    }
  }

  const groups: string[] = [];
  for (let i = 0; i < LENGTH; i += GROUP) {
    groups.push(chars.slice(i, i + GROUP).join(""));
  }
  return groups.join("-");
}
