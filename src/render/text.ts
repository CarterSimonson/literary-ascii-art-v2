import { decodeHTML } from "entities";
import { Lexer, type MarkedToken, type Token } from "marked";

function tokenText(input: Token): string {
  const token = input as MarkedToken;

  if ("tokens" in token) {
    const text = token.tokens.map(tokenText).join("");

    if (
      ["paragraph", "heading", "blockquote", "list_item"].includes(token.type)
    ) {
      return text + " ";
    }

    return text;
  }

  if (token.type === "list") {
    return token.items.map(tokenText).join(" ");
  }

  if (token.type === "table") {
    return (
      [token.header, ...token.rows]
        .flatMap((row) =>
          row.map((cell) => cell.tokens.map(tokenText).join("")),
        )
        .join(" ") + " "
    );
  }

  if (token.type === "html") {
    return token.text
      .replace(
        /<\/?(?:br|p|div|li|ul|ol|h[1-6]|pre|blockquote|tr|td|th)\b[^>]*>/gi,
        " ",
      )
      .replace(/<[^>]*>/g, "");
  }

  if (token.type === "space" || token.type === "br" || token.type === "hr") {
    return " ";
  }

  if (token.type === "code") {
    return token.text + " ";
  }

  if ("text" in token) {
    return token.text;
  }

  return "";
}

export function normalizeRenderText(source: string): string[] {
  const withoutHiddenHtml = source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const plain = new Lexer({ gfm: true })
    .lex(withoutHiddenHtml)
    .map(tokenText)
    .join("");
  const compact = decodeHTML(plain)
    .normalize("NFC")
    .replace(/[\p{White_Space}]+/gu, " ")
    .replace(/[\p{Cc}\p{Cf}*_`~]/gu, "")
    .replace(/ +/g, " ")
    .trim();
  const characters = Array.from(compact);

  if (characters.length === 0) {
    throw new Error("Book text has no characters after render cleanup");
  }

  return characters;
}
