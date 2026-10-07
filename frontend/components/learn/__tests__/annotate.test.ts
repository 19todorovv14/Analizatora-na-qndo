/* Unit tests for the lesson-text annotation (components/learn/annotate.ts). */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { annotateLesson, type Block } from "../annotate";

const text = (b: Block) => b.segs.map((s) => s.t).join("");
const terms = (blocks: Block[][]) => blocks.flat().flatMap((b) => b.segs.filter((s) => s.term).map((s) => `${s.t}→${s.term}`));

describe("annotateLesson", () => {
  test("keeps the text intact", () => {
    const [[p]] = annotateLesson([["Свещта има **тяло (body)** между Open и Close."]]);
    assert.equal(text(p), "Свещта има тяло (body) между Open и Close.");
  });
  test("bullets become list items", () => {
    const [blocks] = annotateLesson([["Увод", "- първо", "- второ"]]);
    assert.deepEqual(blocks.map((b) => b.kind), ["p", "li", "li"]);
    assert.equal(text(blocks[1]), "първо");
  });
  test("**bold** segments are flagged", () => {
    const [[p]] = annotateLesson([["a **b** c"]]);
    assert.deepEqual(
      p.segs.map((s) => [s.t, !!s.bold]),
      [
        ["a ", false],
        ["b", true],
        [" c", false],
      ],
    );
  });
  test("in-app paths in parentheses become links", () => {
    const [[p]] = annotateLesson([["Упражни в Leverage Lab (/learn/leverage) и после в (/simulator)."]]);
    assert.deepEqual(p.segs.filter((s) => s.href).map((s) => s.href), ["/learn/leverage", "/simulator"]);
  });
  test("each glossary term is wrapped only at its first mention across body and sections", () => {
    const out = annotateLesson([["Stop loss пази сметката. Нов stop loss…"], ["Още за stop loss и leverage."]]);
    assert.deepEqual(terms(out), ["Stop loss→stoploss", "leverage→leverage"]);
  });
  test("case-sensitive aliases: 'High' is a term, 'high' is just a word", () => {
    assert.deepEqual(terms(annotateLesson([["цената е high днес"]])), []);
    assert.deepEqual(terms(annotateLesson([["High е най-високата цена"]])), ["High→high"]);
  });
  test("Cyrillic suffixes still match the Latin term (spread-ът)", () => {
    assert.deepEqual(terms(annotateLesson([["spread-ът е разход"]])), ["spread→spread"]);
  });
  test("longer aliases win over their prefixes (position sizing vs position size)", () => {
    assert.deepEqual(terms(annotateLesson([["position sizing по риска"]])), ["position sizing→position_size"]);
  });
  test("Latin word boundaries: 'longer' is not 'long'", () => {
    assert.deepEqual(terms(annotateLesson([["a longer test"]])), []);
  });
});
