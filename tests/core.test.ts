import assert from "node:assert/strict";
import test from "node:test";
import { alterNumber, isNumberText, parseSwedishNumber } from "../lib/pdf-engine.ts";

test("parses annual-report number formats", () => {
  assert.equal(parseSwedishNumber("1\u202f234"), 1234);
  assert.equal(parseSwedishNumber("1,186"), 1186);
  assert.equal(parseSwedishNumber("2,28"), 2.28);
  assert.equal(parseSwedishNumber("(1 917)"), -1917);
  assert.equal(parseSwedishNumber("−42"), -42);
  assert.equal(parseSwedishNumber("94,1%"), 94.1);
  assert.equal(parseSwedishNumber("not a number"), null);
});

test("recognizes complete numeric tokens only", () => {
  assert.equal(isNumberText("6 104"), true);
  assert.equal(isNumberText("2,28"), true);
  assert.equal(isNumberText("123,"), false);
  assert.equal(isNumberText("2024 report"), false);
});

test("scrambled numbers stay numeric and change", () => {
  const replacement = alterNumber("6 104");
  assert.notEqual(replacement, "6 104");
  assert.notEqual(parseSwedishNumber(replacement), null);
});
