export interface FileDiff {
  path: string;
  kind: "config" | "text";
  before: string;
  after: string;
}
