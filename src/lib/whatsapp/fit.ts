/**
 * Trims rendered message text to what Meta will accept.
 *
 * A journey body is written by the operator but *finished* by whoever is
 * replying: "Thanks {{address}}, which of these suits you?" is short in the
 * builder and arbitrarily long once a customer has pasted their address into
 * it. WhatsApp lets an inbound message run to 4096 characters, and an
 * interactive reply caps out at 1024, so an ordinary long answer is enough to
 * push the next message over the line.
 *
 * Meta rejects the send, the step throws, and the session ends as FAILED — the
 * customer is dropped mid-conversation because they were talkative. Shortening
 * the text keeps them in the journey, which is the better failure by a wide
 * margin: a message ending in an ellipsis is a blemish, a dead session is a
 * lost customer. The full answer is still in the session context and on the
 * contact, so nothing is actually lost.
 */

const ELLIPSIS = "…";

export interface FitResult {
  text: string;
  /** True when the text was shortened, so the caller can log it. */
  truncated: boolean;
}

export function fit(text: string, limit: number): FitResult {
  // String.length counts UTF-16 code units, so an emoji counts as two. Meta
  // counts characters, which means this measures slightly high and trims
  // slightly early. Erring towards the shorter string is the safe direction —
  // the alternative is a message Meta refuses.
  if (text.length <= limit) return { text, truncated: false };

  const room = limit - ELLIPSIS.length;

  // Built up a code point at a time. Slicing by index can cut through a
  // surrogate pair and leave half an emoji, which arrives as a replacement box.
  let out = "";
  for (const character of text) {
    if (out.length + character.length > room) break;
    out += character;
  }

  // End on a whole word when a space is near the cut. Only near it: falling
  // back to the last space in a long unbroken string (a URL, say) would throw
  // away most of the message.
  const lastSpace = out.lastIndexOf(" ");
  if (lastSpace > room * 0.8) out = out.slice(0, lastSpace);

  return { text: out.trimEnd() + ELLIPSIS, truncated: true };
}
