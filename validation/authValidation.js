const { z } = require("zod");

const loginSchema = z.object({
  userId: z
    .string({
      required_error: "ユーザーIDを入力してください",
      invalid_type_error: "ユーザーIDを入力してください",
    })
    .trim()
    .min(1, "ユーザーIDを入力してください"),
  password: z
    .string({
      required_error: "パスワードを入力してください",
      invalid_type_error: "パスワードを入力してください",
    })
    .min(1, "パスワードを入力してください"),
});

module.exports = {
  loginSchema,
};
