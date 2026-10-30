// icu-lite.mjs - a tiny ICU MessageFormat reader used by the i18n scripts.
//
// It understands exactly what this app uses:
//   plain text, {name}, {name, number}, {name, date, short} (kept as-is),
//   {name, plural|select|selectordinal, key {message} key {message} ...}
//   and "#" inside plural messages.
// An apostrophe is treated as plain text (intl-messageformat only starts
// quoting when it is followed by { } # | or another apostrophe, and this
// app never does that).
//
// parse(text) returns a list of nodes:
//   { type: "text", value }
//   { type: "arg", name, raw }                       simple or formatted argument
//   { type: "choice", name, kind, options: [{ key, nodes }] }
//   { type: "hash" }                                 "#" inside a plural branch
// parse() throws an Error with a readable message when braces do not match.

export function parse(text, insidePlural = false) {
  const nodes = [];
  let i = 0;
  let buffer = "";
  const flush = () => {
    if (buffer) nodes.push({ type: "text", value: buffer });
    buffer = "";
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === "{") {
      flush();
      const end = matchingBrace(text, i);
      const inner = text.slice(i + 1, end);
      nodes.push(parseArgument(inner));
      i = end + 1;
      continue;
    }
    if (ch === "}") {
      throw new Error(`unexpected "}" at position ${i}`);
    }
    if (ch === "#" && insidePlural) {
      flush();
      nodes.push({ type: "hash" });
      i += 1;
      continue;
    }
    buffer += ch;
    i += 1;
  }
  flush();
  return nodes;
}

function matchingBrace(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`unclosed "{" at position ${start}`);
}

function parseArgument(inner) {
  const firstComma = inner.indexOf(",");
  if (firstComma === -1) {
    const name = inner.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`bad argument name "{${inner}}"`);
    return { type: "arg", name, raw: `{${inner}}` };
  }
  const name = inner.slice(0, firstComma).trim();
  const rest = inner.slice(firstComma + 1);
  const secondComma = rest.indexOf(",");
  const kind = (secondComma === -1 ? rest : rest.slice(0, secondComma)).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`bad argument name in "{${inner}}"`);
  if (kind !== "plural" && kind !== "select" && kind !== "selectordinal") {
    return { type: "arg", name, raw: `{${inner}}` };
  }
  if (secondComma === -1) throw new Error(`"${kind}" without options in "{${inner}}"`);
  const body = rest.slice(secondComma + 1);
  const options = [];
  let j = 0;
  while (j < body.length) {
    while (j < body.length && /\s/.test(body[j])) j += 1;
    if (j >= body.length) break;
    let key = "";
    while (j < body.length && !/\s/.test(body[j]) && body[j] !== "{") {
      key += body[j];
      j += 1;
    }
    while (j < body.length && /\s/.test(body[j])) j += 1;
    if (body[j] !== "{") throw new Error(`option "${key}" has no {message} in "{${inner}}"`);
    const end = matchingBrace(body, j);
    const message = body.slice(j + 1, end);
    options.push({ key, nodes: parse(message, kind !== "select") });
    j = end + 1;
  }
  if (!options.some((option) => option.key === "other")) {
    throw new Error(`"${kind}" for "${name}" has no "other" option`);
  }
  return { type: "choice", name, kind, options };
}

/** Argument names used anywhere in a parsed message (sorted, unique). */
export function argumentNames(nodes, out = new Set()) {
  for (const node of nodes) {
    if (node.type === "arg") out.add(node.name);
    if (node.type === "choice") {
      out.add(node.name);
      for (const option of node.options) argumentNames(option.nodes, out);
    }
  }
  return [...out].sort();
}

/** Write nodes back to ICU text, transforming plain text with `mapText`. */
export function print(nodes, mapText = (value) => value) {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") out += mapText(node.value);
    else if (node.type === "hash") out += "#";
    else if (node.type === "arg") out += node.raw;
    else {
      const options = node.options.map((option) => `${option.key} {${print(option.nodes, mapText)}}`).join(" ");
      out += `{${node.name}, ${node.kind}, ${options}}`;
    }
  }
  return out;
}

/** Flatten nested JSON objects into [dotted.key, string] pairs, in order. */
export function flatten(value, prefix = "", out = []) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out.push([prefix, value]);
  }
  return out;
}
