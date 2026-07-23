# ARCHITECTURE.md — SMS認証Webアプリ 技術設計

前提: `PRODUCT.md` の要件を4時間で実装する。**Docker / Caddy / CI/CDは今回は採用しない**（時間があれば任意追加）。ローカルで `npm start` するだけで動く構成にする。

## 1. 技術スタック（元Grokガイドの選定を踏襲・簡略化）

| 項目 | 選定 | 理由 |
|---|---|---|
| 言語/ランタイム | Node.js (v20 LTS) | セットアップが速い |
| Webフレームワーク | Express | 最小構成で書ける |
| テンプレート | EJS | サーバーサイドレンダリングで完結、SPA不要 |
| バリデーション | Zod（余裕がなければ手書きif文でも可） | 入力検証を明示化 |
| OTP保存 | インメモリ `Map`（サーバー再起動で消えてOK） | DB不要、4時間なら十分 |
| セッション | `express-session`（メモリストア） | ログイン〜OTP検証間の状態保持に必須 |
| テスト | Jest + Supertest（余裕があれば） | 優先度は低（PRODUCT.md参照） |

**あえて外すもの**: Docker, Caddy, GitHub Actions, ESLint/Prettier強制, Git Flowのdevelopブランチ
→ 時間が余った場合のみ追加（stretch goal）。

## 2. ディレクトリ構成（最小構成）

```
sms-auth-app/
├── package.json
├── .env.example          # PORT, SESSION_SECRET など
├── app/
│   └── server.js         # Expressエントリーポイント、ポート・セッション設定
├── routes/
│   └── authRoutes.js     # /login, /verify-otp, /success
├── controllers/
│   └── authController.js # showLogin, processLogin, showVerify, verifyOtp
├── services/
│   ├── otpService.js      # OTP生成・保存・検証・失効
│   └── smsService.js      # モック送信（console.log等）
├── data/
│   └── mockUsers.js       # ハードコードユーザー
├── validation/
│   └── authValidation.js  # Zodスキーマ（任意）
├── views/
│   ├── login.ejs
│   ├── otp-verify.ejs
│   └── success.ejs
├── public/
│   └── css/style.css
└── __tests__/
    └── auth.test.js       # 任意（時間があれば）
```

## 3. ローカル起動・ポート・HTTP/Cookieに関する注意点（Dockerなし構成）

Docker/Caddyを使わないため、TLS終端は存在せず、Expressアプリ自身がポートを直接待ち受ける。この章の設定を誤ると「ログインは通るがOTP画面でセッションが切れる」といった不具合の原因になるため、必ず明記しておく。

### 3.1 ポート設定（`app/server.js`）
```js
const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
```
- ポート番号はハードコードせず `.env` の `PORT` を参照する
- `.env.example` に `PORT=3000` を記載し、各自 `.env` にコピーして揃える
- アクセスURL: `http://localhost:3000/login`（**HTTPSではない**。ローカル動作確認が目的のため今回はHTTPで問題ない）

### 3.2 ポート競合時の対処
```bash
# 使用中プロセスを確認して終了する（Mac/Linux）
lsof -i :3000
kill -9 <PID>

# または別ポートで起動する
PORT=3001 npm start
```

### 3.3 セッションCookie設定（`app/server.js`）
`express-session` の `cookie.secure` はHTTPS前提のオプション。Dockerなし・HTTP構成では **`secure: false`** にしないと、ブラウザがCookieを送信せずログイン〜OTP検証間の状態が保持されない不具合が起きる。

```js
const session = require("express-session");

app.use(session({
  secret: process.env.SESSION_SECRET || "dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,     // Dockerなし・HTTP環境のため false 固定（本番でTLS化するなら true）
    httpOnly: true,    // JSからCookieを読めないようにする（XSS対策）
    maxAge: 10 * 60 * 1000, // 10分。ログイン〜OTP検証の一連の流れをカバーできれば十分
  },
}));
```

**注意**: 元のGrokガイド（Docker + Caddy + TLS internal構成）を前提にした設定を流用する場合、`secure: true` のままだと今回の構成では正しく動かないので必ず `false` に変更すること。

## 4. データモデル

### 4.1 ユーザー（`data/mockUsers.js`）
```js
module.exports = [
  { userId: "user01", password: "password123", phone: "090-1111-2222" },
  { userId: "user02", password: "password456", phone: "090-3333-4444" },
];
```
※本番であればパスワードはハッシュ化必須だが、4時間ハッカソンかつハードコードのため平文比較で許容。ただしコメントでその旨明記する（教育的観点）。

### 4.2 OTPストア（`services/otpService.js` 内の `Map`）
セッションIDまたはuserIdをキーに以下を保持する。

```js
{
  code: "483920",          // 6桁文字列（先頭0埋め対応のため文字列で保持）
  expiresAt: 1690000000000, // Date.now() + 5分
  attempts: 0,               // 誤り回数
  maxAttempts: 5,
  used: false
}
```

**設計判断**:
- キーはユーザーIDそのものではなく**セッションID**にひもづける（同一ユーザーの多重ログインで衝突しないため）。ただし4時間なら`userId`キーでも実害はない。
- サーバー再起動で消える前提（インメモリ）。永続化は不要。

## 5. OTPライフサイクル設計（最重要ポイント）

```
[生成] --5分TTL--> [検証待ち] --正しい入力--> [used=trueにして即失効] --> 成功画面
                        |--誤り入力(attempts++)--> attempts >= maxAttempts なら失効してログイン画面へ差し戻し
                        |--TTL超過--> 自動的に無効（検証時にexpiresAtをチェック）
```

### 5.1 生成
```js
const crypto = require("crypto");
function generateOtp() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, "0");
}
```
`Math.random()` は使わない（暗号学的に安全でないため）。

### 5.2 検証
- `expiresAt < Date.now()` → 失効エラー
- `attempts >= maxAttempts` → ロックエラー（ログイン画面からやり直し）
- `code !== input` → `attempts++`、エラーメッセージ、OTP入力画面再表示
- 一致 → `used = true` にして即座にMapから削除、セッションに`authenticated=true`をセットして成功画面へ

### 5.3 タイミングセーフ比較（余裕があれば）
```js
const crypto = require("crypto");
function safeCompare(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
```
6桁OTPなので実害は小さいが、セキュリティ教育の観点で組み込むと評価ポイントになる。

## 6. ルーティング設計

| メソッド | パス | 処理内容 |
|---|---|---|
| GET | `/login` | ログイン画面表示 |
| POST | `/login` | ID/PW検証 → OK: OTP生成・モック送信・セッションに仮ユーザー情報保存 → `/verify-otp`へリダイレクト / NG: `/login`にエラー表示 |
| GET | `/verify-otp` | OTP入力画面表示（セッションに仮ログイン情報がなければ`/login`へリダイレクト） |
| POST | `/verify-otp` | OTP検証 → OK: セッション本認証化 → `/success` / NG: エラーメッセージ付きで同画面再表示 |
| GET | `/success` | 認証済みセッションのみアクセス可（未認証なら`/login`へリダイレクト） |

## 7. セキュリティ設計まとめ（評価されやすいポイント）

1. **OTP生成**: `crypto.randomInt`使用（予測不可能性）
2. **有効期限**: 5分などの短いTTL
3. **単一使用**: 検証成功で即時破棄
4. **試行回数制限**: 5回失敗でロック→ログインからやり直し（総当たり対策）
5. **セッション管理**: ログイン成功≠本認証完了。OTP検証完了まで`/success`にアクセスさせない
6. **パスワード非保持**: フォーム再表示時にパスワード欄は空にする
7. **エラーメッセージの粒度**: 「IDまたはパスワードが違います」のように、どちらが誤りか特定させない（ユーザー列挙攻撃対策）
8. **CookieのhttpOnly化**: JS経由でのセッションCookie読み取りを防止（XSS対策、3.3参照）

## 8. チーム分担案（並行開発しやすい単位）

| 担当 | 領域 | ファイル |
|---|---|---|
| A | ログイン画面 + ID/PW検証 | `views/login.ejs`, `authController.js`(showLogin, processLogin), `mockUsers.js` |
| B | OTP生成・保存・モック送信 | `otpService.js`, `smsService.js` |
| C | OTP画面 + 検証統合 + セッション制御 | `views/otp-verify.ejs`, `authController.js`(showVerify, verifyOtp), `server.js`のセッション設定 |
| D（いれば） | 成功画面 + スタイリング + 結合テスト | `views/success.ejs`, `public/css`, 手動テストシナリオ作成 |

各自が独立したファイルから着手できるよう分割してあるので、13:30〜15:00で並行作業→15:00以降で結合するのが効率的。

## 9. 開発手順（詳細ステップ・ファイル単位）

DEVELOPMENT_GUIDE.mdと同じ粒度で、各ステップが「ファイル1つの作成」または「単一機能を実現する複数ファイル」になるように分解している。チェックボックスはそのままPRやコミット単位の目安として使える。

### Step 0: プロジェクト基盤（13:00–13:30、全員で）
- [ ] `npm init -y` でリポジトリ初期化 → `package.json` 作成
- [ ] `npm install express express-session ejs zod` （Zodは任意）
- [ ] `npm install -D jest supertest` （テストは任意、余裕があれば）
- [ ] `.gitignore` 作成（`node_modules/`, `.env` を含める）
- [ ] `.env.example` 作成（`PORT=3000`, `SESSION_SECRET=change-me`）
- [ ] ディレクトリ作成: `app/`, `routes/`, `controllers/`, `services/`, `data/`, `validation/`, `views/`, `public/css/`, `__tests__/`
- [ ] `app/server.js` の最小雛形作成（Expressインスタンス生成 + `PORT`でlisten + `console.log`確認のみ、ルーティングはまだ空でOK）
- [ ] `npm start`（`package.json`の`scripts.start`に`node app/server.js`を設定）で`http://localhost:3000`に何かしら応答が返ることを確認

**コミット例**: `chore: プロジェクト基盤セットアップ（Docker/Caddyなし）`

### Step 1: ログイン画面表示（担当A）
- [ ] `data/mockUsers.js` 作成（テストユーザー2〜3件をハードコード）
- [ ] `views/login.ejs` 作成（`userId`, `password`の入力欄、エラーメッセージ表示エリア、`action="/login" method="POST"`）
- [ ] `public/css/style.css` 作成（最低限のフォーム見た目）
- [ ] `controllers/authController.js` に `showLogin(req, res)` 関数を追加（`login.ejs`をrenderするだけ）
- [ ] `routes/authRoutes.js` に `GET /login` を追加し `showLogin` を紐付け
- [ ] `app/server.js` に `express.static("public")` とEJSのview engine設定、`authRoutes`のマウントを追加
- [ ] ブラウザで `http://localhost:3000/login` にアクセスし画面が表示されることを確認

**コミット例**: `feat: ログイン画面UIとGETルート実装`

### Step 2: セッション設定（担当C、Step 1と並行可）
- [ ] `app/server.js` に `express-session` の設定を追加（3.3節の設定をそのまま使用、`secure: false`であることを確認）
- [ ] `express.urlencoded({ extended: true })` をミドルウェアに追加（フォームのPOSTボディを受け取るため必須）
- [ ] 動作確認: 適当なルートで `req.session.test = "ok"` をセットし、別リクエストで読み出せることを確認

**コミット例**: `feat: セッション設定追加（Dockerなし・HTTP用にsecure:false）`

### Step 3: ID/PW検証ロジック（担当A）
- [ ] `validation/authValidation.js` にZodスキーマ作成（`userId`, `password`が空文字でないこと程度でOK。任意）
- [ ] `controllers/authController.js` に `processLogin(req, res)` 関数を追加
  - `mockUsers.js` と照合
  - 一致すれば次のStep 4のOTP発行処理を呼び出す想定でTODOコメントを残す（Step 4完了後に接続）
  - 不一致なら `login.ejs` を「IDまたはパスワードが違います」というエラー付きで再render（パスワード欄は空にする）
- [ ] `routes/authRoutes.js` に `POST /login` を追加し `processLogin` を紐付け
- [ ] 誤ったID/PWでエラー表示されることを確認

**コミット例**: `feat: ログイン認証ロジックとバリデーション`

### Step 4: OTP生成・保存サービス（担当B、Step 1〜3と並行可）
- [ ] `services/otpService.js` 作成
  - `generateOtp()`: `crypto.randomInt`で6桁文字列生成（5.1節参照）
  - `issueOtp(key)`: OTPを生成し `Map` に `{ code, expiresAt, attempts: 0, maxAttempts: 5, used: false }` を保存して返す
  - `verifyOtp(key, input)`: 期限切れ・試行超過・不一致・一致（used=trueにして削除）の4パターンを判定して返す
- [ ] `services/smsService.js` 作成（`sendOtpMock(phone, code)`: `console.log`でコンソールに出力するだけのモック実装）
- [ ] 単体で `node -e "..."` のように簡易実行し、Map操作が正しく動くことを確認（Jestテストは余裕があれば）

**コミット例**: `feat: OTP生成・保存・検証サービスとSMSモック送信`

### Step 5: OTP発行とログイン処理の接続（担当A + B、Step 3・4完了後）
- [ ] `controllers/authController.js` の `processLogin` からStep4の `otpService.issueOtp` と `smsService.sendOtpMock` を呼び出すように接続
- [ ] セッションに「OTP検証待ち」の仮ユーザー情報（`req.session.pendingUserId`など）を保存
- [ ] 発行後 `/verify-otp` へリダイレクト
- [ ] ログインが成功するとOTPがコンソールに出力され、`/verify-otp`に遷移することを確認

**コミット例**: `feat: ログイン成功時にOTP発行しverify-otp画面へ遷移`

### Step 6: OTP入力画面（担当C）
- [ ] `views/otp-verify.ejs` 作成（6桁OTP入力欄、エラーメッセージ表示エリア、`action="/verify-otp" method="POST"`）
- [ ] `controllers/authController.js` に `showVerify(req, res)` 関数を追加
  - `req.session.pendingUserId` が無ければ `/login` へリダイレクト（直接アクセス防止）
  - あれば `otp-verify.ejs` をrender
- [ ] `routes/authRoutes.js` に `GET /verify-otp` を追加し `showVerify` を紐付け
- [ ] Step5完了後の遷移で画面が表示されることを確認

**コミット例**: `feat: OTP入力画面表示`

### Step 7: OTP検証処理（担当C）
- [ ] `controllers/authController.js` に `verifyOtp(req, res)` 関数を追加
  - `services/otpService.verifyOtp` を呼び出し、結果ごとに分岐
  - 成功: `req.session.authenticated = true` をセットし `pendingUserId` を削除、`/success` へリダイレクト
  - 期限切れ/試行超過: エラーメッセージ付きで `/login` へ差し戻し（セッションのpending情報もクリア）
  - 不一致: エラーメッセージ付きで `otp-verify.ejs` を再render
- [ ] `routes/authRoutes.js` に `POST /verify-otp` を追加し `verifyOtp` を紐付け
- [ ] 正しいOTP・誤ったOTP・期限切れの3パターンを手動で確認

**コミット例**: `feat: OTP検証ロジックとセキュリティ対策（期限切れ・試行回数制限・単一使用）`

### Step 8: 成功画面とアクセス制御（担当D、Step 7完了後）
- [ ] `views/success.ejs` 作成（ログイン成功メッセージ表示のみ、以降のコンテンツ不要）
- [ ] `controllers/authController.js` に `showSuccess(req, res)` 関数を追加
  - `req.session.authenticated` が真でなければ `/login` へリダイレクト（未認証での直接アクセス防止）
- [ ] `routes/authRoutes.js` に `GET /success` を追加し `showSuccess` を紐付け
- [ ] OTP検証成功後に成功画面が表示され、未認証で直接`/success`にアクセスするとログイン画面に戻ることを確認

**コミット例**: `feat: ログイン成功画面とアクセス制御`

### Step 9: 結合テスト・エラーケース確認（担当全員、16:30–17:30）
- [ ] 正しいID/PW → OTP発行 → 正しいOTP → 成功画面、の一連の流れを通しで確認
- [ ] 誤ったID/PWでログイン画面にエラー表示されることを確認
- [ ] 誤ったOTPを5回入力してロックされることを確認
- [ ] OTPの有効期限切れ（5分待つか、`expiresAt`を短くして手動確認）で拒否されることを確認
- [ ] 一度使ったOTPを再送信しても拒否されることを確認（単一使用）
- [ ] `/verify-otp`や`/success`への直接アクセス（未認証状態）がログイン画面にリダイレクトされることを確認
- [ ] `README.md` に起動方法（`npm install` → `.env`作成 → `npm start` → `http://localhost:3000/login`）を記載

**コミット例**: `test: 結合テストとエラーケース確認、README追加`

### Step 10（バッファ、17:30–18:00・時間が余れば）
- [ ] Jest + Supertestで自動テスト追加（`__tests__/auth.test.js`）
- [ ] レート制限ミドルウェア追加
- [ ] Docker化・Caddy化・GitHub Actions CI追加（第8節参照）

## 10. 時間が余った場合の追加候補（stretch goal）
- Jest + Supertestで自動テスト（正しいログイン→OTP発行、不正ログイン拒否、OTP期限切れ）
- レート制限ミドルウェア（IPごとの簡易throttle）
- Docker化・Caddy化・GitHub Actions CI（元のGrokガイドの内容をそのまま追加可能）
- oxlint/Prettier導入
