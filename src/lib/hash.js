import crypto from "node:crypto";

export function sha256(value) {
  const input = typeof value === "string" ? value : JSON.stringify(value);
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function canonicalJson(value) {
  return JSON.stringify(sortObject(value));
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = sortObject(value[key]);
      return acc;
    }, {});
  }
  return value;
}
