import { describe, expect, test } from "bun:test";
import {
  approve,
  fingerprint,
  locate,
  newReview,
  noteEdit,
  publishBlock,
  requestChanges,
  ROLE,
  RuleError,
  submit,
} from "./review";

const writer = { id: "w", role: ROLE.AUTHOR };
const editor = { id: "e", role: ROLE.EDITOR };
const admin = { id: "a", role: ROLE.ADMIN };

const inReview = () => submit(newReview("1", "posts"), writer);

describe("submitting", () => {
  test("moves a draft into review", () => {
    expect(inReview().state).toBe("in_review");
  });
  test("is refused for readers", () => {
    expect(() =>
      submit(newReview("1", "posts"), { id: "r", role: ROLE.SUBSCRIBER }),
    ).toThrow(RuleError);
  });
  test("is refused twice in a row", () => {
    expect(() => submit(inReview(), writer)).toThrow(RuleError);
  });
  test("is allowed again after changes were requested", () => {
    const review = requestChanges(inReview(), editor, "Cite a source.");
    expect(submit(review, writer).state).toBe("in_review");
  });
});

describe("deciding", () => {
  test("an editor approves", () => {
    expect(approve(inReview(), editor, "h").state).toBe("approved");
  });
  test("an author cannot approve", () => {
    expect(() => approve(inReview(), writer, "h")).toThrow(RuleError);
  });
  test("nobody approves what they submitted, except an admin", () => {
    const review = submit(newReview("1", "posts"), editor);
    expect(() => approve(review, editor, "h")).toThrow(RuleError);
    expect(approve(review, admin, "h").state).toBe("approved");
  });
  test("nobody approves an article they wrote", () => {
    expect(() => approve(inReview(), editor, "h", editor.id)).toThrow(
      RuleError,
    );
  });
  test("changes cannot be requested without saying what", () => {
    expect(() => requestChanges(inReview(), editor, "  ")).toThrow(RuleError);
  });
  test("only an article in review can be decided on", () => {
    expect(() => approve(newReview("1", "posts"), editor, "h")).toThrow(
      RuleError,
    );
  });
});

describe("publishing", () => {
  test("is blocked in every state but approved", () => {
    expect(publishBlock(null, "h")).toBeTruthy();
    expect(publishBlock(newReview("1", "posts"), "h")).toBeTruthy();
    expect(publishBlock(inReview(), "h")).toBeTruthy();
    expect(
      publishBlock(requestChanges(inReview(), editor, "No."), "h"),
    ).toBeTruthy();
  });
  test("is allowed for the approved text", () => {
    expect(publishBlock(approve(inReview(), editor, "h"), "h")).toBeUndefined();
  });
  test("is blocked for any other text", () => {
    expect(
      publishBlock(approve(inReview(), editor, "h"), "other"),
    ).toBeTruthy();
  });
  test("an edit after approval sends the article back to review", () => {
    const review = approve(inReview(), editor, "h");
    expect(noteEdit(review, "w", "h")).toBe(false);
    expect(noteEdit(review, "w", "changed")).toBe(true);
    expect(review.state).toBe("in_review");
    expect(publishBlock(review, "changed")).toBeTruthy();
  });
});

describe("fingerprint", () => {
  const names = ["title", "body"];
  test("changes with the text", async () => {
    const a = await fingerprint({ title: "T", body: "one" }, names);
    const b = await fingerprint({ title: "T", body: "two" }, names);
    expect(a).not.toBe(b);
  });
  test("ignores fields reviewers do not read", async () => {
    const a = await fingerprint({ title: "T", body: "one", date: "x" }, names);
    const b = await fingerprint({ title: "T", body: "one", date: "y" }, names);
    expect(a).toBe(b);
  });
});

describe("locate", () => {
  test("finds the line of a passage", () => {
    expect(locate("a\nb\nclaim here", "claim")).toEqual({ line: 3 });
  });
  test("says nothing about a passage that is gone", () => {
    expect(locate("a\nb", "claim")).toBeUndefined();
  });
});
