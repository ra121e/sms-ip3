const path = require("path");
const express = require("express");
const session = require("express-session");
const mockUsers = require("../data/mockUsers");
const { loginSchema } = require("../validation/authValidation");
const { generateOtp } = require("../services/otpService");
const { sendOtp } = require("../services/smsService");

const app = express();

const PORT = process.env.PORT || 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));

app.use(express.static(path.join(__dirname, "..", "public")));

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
      maxAge: 10 * 60 * 1000,
    },
  })
);

app.get("/login", (req, res) => {
  res.render("login");
});

app.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.render("login", {
      userId: req.body.userId || "",
      error: parsed.error.issues[0].message,
    });
  }

  const { userId, password } = parsed.data;
  const user = mockUsers.find(
    (u) => u.userId === userId && u.password === password
  );

  if (!user) {
    return res.render("login", {
      userId,
      error: "存在しないユーザーです",
    });
  }

  const code = generateOtp();
  req.session.pendingUserId = user.userId;
  req.session.otpCode = code;

  try {
    await sendOtp(user.phone, code, user.userId);
    console.log(`[SMS送信成功] to ${user.phone}: ワンタイムパスワードは ${code} です。`);
  } catch (error) {
    console.error(`[SMS送信失敗] ${error.message}`);
    console.log(`[SMS MOCK] to ${user.phone}: ワンタイムパスワードは ${code} です。`);
  }

  res.render("otp-verify");
});

app.post("/otp-verify", (req, res) => {
  if (!req.session.pendingUserId || !req.session.otpCode) {
    return res.redirect("/login");
  }

  const { otp } = req.body;

  if (otp !== req.session.otpCode) {
    return res.render("otp-verify", { error: "コードが違います。" });
  }

  req.session.authenticated = true;
  req.session.otpCode = null;
  res.render("success");
});

app.use((req, res) => {
  res.redirect("/login");
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});