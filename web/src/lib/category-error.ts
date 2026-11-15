// What to tell the owner when a save names a category that is no longer in
// the fixed list (corefinance ADR-0002).
export const PICK_ANOTHER_CATEGORY =
  "That category is no longer available. Pick one from the list and save again.";

export const editToPickCategory = (subject: "entry" | "rule") =>
  `That category is no longer available. Edit this ${subject} and pick one from the list.`;
