export interface FileChange {
  filename: string;
  previous_filename?: string;
  status: string;
  patch?: string;
}
export interface PullRequest {
  number: number;
  title: string;
  body: string;
  html_url: string;
  user: { login: string };
  merged_at: string | null;
  head: { sha: string };
  base: { sha: string; ref: string };
}
export interface ReviewComment {
  id: number;
  body: string;
  path: string;
  line: number | null;
  original_line?: number;
  commit_id: string;
  in_reply_to_id?: number;
  html_url: string;
  created_at: string;
  user: { login: string };
}
export interface Commit {
  sha: string;
  html_url: string;
  commit: { message: string; author: { name: string; date: string } };
  author: { login: string } | null;
  parents: { sha: string }[];
  files: FileChange[];
}
export interface Issue {
  number: number;
  title: string;
  body: string;
  html_url: string;
}
export interface Review { user: { login: string }; state: string; html_url: string; body?: string; submitted_at?: string | null }
export interface DiscussionComment { id: number; body: string; html_url: string; created_at: string; user: { login: string } }
export interface CommitComparison { status: string; base_commit: { sha: string }; merge_base_commit: { sha: string }; files: FileChange[] }
export interface ReviewInput {
  body: string;
  comments: { path: string; line: number; body: string }[];
}
