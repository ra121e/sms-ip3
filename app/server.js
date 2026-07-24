const express = require("express");
const session = require("express-session");

const app = express();

const PORT = process.env.PORT || 3000;

// フォームのPOSTボディ(application/x-www-form-urlencoded)を受け取るために必須
app.use(express.urlencoded({ extended: true }));

// セッション設定
// Docker/Caddyを使わないHTTP環境のため secure は false 固定
// (ARCHITECTURE.md 5.3節参照。secure: true にすると HTTPS 前提になり、
//  HTTP環境ではブラウザがCookieを送信しなくなるので注意)
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // Caddy/TLSなし・HTTP環境のため false 固定
      httpOnly: true, // JSからCookieを読めないようにする(XSS対策)
      maxAge: 10 * 60 * 1000, // 10分。ログイン〜OTP検証の一連の流れをカバー
    },
  })
);

// TODO(Step 1): express.static("public") と EJS の view engine 設定、authRoutes のマウントをここに追加する

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
