// Conventional Commits を commit-msg フック（lefthook）で機械検証する。
// subject は日本語想定のため、大文字小文字の規則（subject-case）は無効化する。
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "subject-case": [0],
  },
};
