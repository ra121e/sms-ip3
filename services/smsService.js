"use strict";

require("dotenv").config();

const TEAM_NAME = "team42";

const REQUEST_TIMEOUT_MS = 10_000;

const SMS_API_PATH = "/api/v1/short_messages";

class SmsApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "SmsApiError";
    this.status = options.status;
    this.response = options.response;
    this.cause = options.cause;
  }
}

function getApiSettings() {
  const baseUrl = process.env.SMS_API_BASE_URL;
  const accessToken = process.env.SMS_API_ACCESS_TOKEN;

  if (!baseUrl || baseUrl === "https://replace-with-your-sms-host.invalid") {
    throw new SmsApiError(
      "SMS_API_BASE_URLが設定されていません。.envを確認してください。"
    );
  }

  if (!accessToken || accessToken === "replace-with-your-access-token") {
    throw new SmsApiError(
      "SMS_API_ACCESS_TOKENが設定されていません。.envを確認してください。"
    );
  }

  let endpoint;
  try {
    endpoint = new URL(SMS_API_PATH, baseUrl);
  } catch (error) {
    throw new SmsApiError("SMS_API_BASE_URLの形式が正しくありません。", {
      cause: error,
    });
  }

  if (endpoint.protocol !== "https:") {
    throw new SmsApiError("SMS認証APIのエンドポイントにはHTTPSを指定してください。");
  }

  return { accessToken, endpoint };
}

async function readJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.toLowerCase().includes("application/json")) {
    throw new SmsApiError("SMS認証APIからJSON以外のレスポンスが返されました。", {
      status: response.status,
    });
  }

  try {
    return await response.json();
  } catch (error) {
    throw new SmsApiError("SMS認証APIのJSONレスポンスを解析できませんでした。", {
      status: response.status,
      cause: error,
    });
  }
}

/**
 * SMS認証APIへOTP送信を依頼します。
 * Node.js標準のfetchは、この構成ではHTTP/1.1でHTTPS通信を行います。
 */
async function sendOtp(phone, code, user_name) {
  const { accessToken, endpoint } = getApiSettings();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const requestBody = {
    to: phone,
    text: `ワンタイムパスワードは ${code} です。`,
    user_reference: TEAM_NAME+user_name,
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    const responseBody = await readJsonResponse(response);

    if (!response.ok) {
      throw new SmsApiError(`SMS認証APIへのアクセスに失敗しました (${response.status})。`, {
        status: response.status,
        response: responseBody,
      });
    }

    return responseBody;
  } catch (error) {
    if (error instanceof SmsApiError) {
      throw error;
    }

    if (error.name === "AbortError") {
      throw new SmsApiError("SMS認証APIへのアクセスがタイムアウトしました。", {
        cause: error,
      });
    }

    throw new SmsApiError("SMS認証APIへアクセスできませんでした。", {
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  SmsApiError,
  sendOtp,
};
