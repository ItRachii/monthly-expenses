export type Context =
  | { kind: "personal"; email: string }
  | { kind: "group"; groupId: string };
