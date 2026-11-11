// Note mirrors coreban's note responses: an item in the owner's Feed. This
// slice has plain notes only (free text the owner posted).
export interface Note {
  id: string;
  text: string;
  // Set while the note is archived: collapsed in the Feed, kept, and still
  // in its place.
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

// FeedPage is one page of the Feed, oldest first. older is the cursor for
// the page before it, null once the page reaches the first note.
export interface FeedPage {
  notes: Note[];
  older: string | null;
}
