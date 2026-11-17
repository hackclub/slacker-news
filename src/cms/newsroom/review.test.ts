import { describe, expect, test } from "bun:test";
import {
  approve,
  expired,
  fingerprint,
  locate,
  newReview,
  noteEdit,
  parseApprovers,
  policyFrom,
  publishBlock,
  requestChanges,
  reviewedCollections,
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

describe("several approvals", () => {
  const two = { required: 2, approvers: [] };
  const second = { id: "e2", role: ROLE.EDITOR };

  test("wait for enough different people", () => {
    const review = approve(inReview(), editor, "h", null, two);
    expect(review.state).toBe("in_review");
    expect(publishBlock(review, "h")).toBeTruthy();
    approve(review, second, "h", null, two);
    expect(review.state).toBe("approved");
    expect(publishBlock(review, "h")).toBeUndefined();
  });
  test("one person cannot approve twice", () => {
    const review = approve(inReview(), editor, "h", null, two);
    expect(() => approve(review, editor, "h", null, two)).toThrow(RuleError);
  });
  test("an edit between approvals drops the earlier one", () => {
    const review = approve(inReview(), editor, "h", null, two);
    expect(noteEdit(review, "w", "changed")).toBe(true);
    expect(review.approvals).toHaveLength(0);
    approve(review, second, "changed", null, two);
    expect(review.state).toBe("in_review");
  });
  test("requesting changes clears approvals", () => {
    const review = approve(inReview(), editor, "h", null, two);
    requestChanges(review, second, "Fix it.");
    expect(review.approvals).toHaveLength(0);
  });
});

describe("named approvers", () => {
  const named = { required: 1, approvers: ["Boss@Example.com", "id-7"] };
  test("an editor not on the list is refused", () => {
    expect(() => approve(inReview(), editor, "h", null, named)).toThrow(
      RuleError,
    );
  });
  test("matches by email, ignoring case, or by id", () => {
    const byEmail = { id: "x", role: ROLE.EDITOR, email: "boss@example.com" };
    expect(approve(inReview(), byEmail, "h", null, named).state).toBe(
      "approved",
    );
    const byId = { id: "id-7", role: ROLE.EDITOR };
    expect(approve(inReview(), byId, "h", null, named).state).toBe("approved");
  });
  test("an admin may always approve", () => {
    expect(approve(inReview(), admin, "h", null, named).state).toBe("approved");
  });
});

describe("settings", () => {
  test("approvers are split on commas and lines", () => {
    expect(parseApprovers("a@x.co, b@x.co\nc")).toEqual([
      "a@x.co",
      "b@x.co",
      "c",
    ]);
  });
  test("approvals needed stays between 1 and 5", () => {
    expect(policyFrom({ requiredApprovals: 0 }).required).toBe(1);
    expect(policyFrom({ requiredApprovals: 9 }).required).toBe(5);
    expect(policyFrom({ requiredApprovals: "x" }).required).toBe(1);
    expect(policyFrom({ requiredApprovals: 2 }).required).toBe(2);
  });
  test("posts are reviewed by default", () => {
    expect(reviewedCollections(undefined)).toEqual(["posts"]);
    expect(reviewedCollections("posts, pages")).toEqual(["posts", "pages"]);
  });
});

describe("expiry", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  test("an article expires once its time has passed", () => {
    expect(expired("2026-11-20T11:00:00Z", now)).toBe(true);
    expect(expired("2026-11-21T00:00:00Z", now)).toBe(false);
  });
  test("no date, or a bad one, never expires", () => {
    expect(expired(undefined, now)).toBe(false);
    expect(expired("not a date", now)).toBe(false);
  });
});
