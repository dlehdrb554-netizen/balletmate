const appJson = require("./app.json");

module.exports = ({ config }) => ({
  ...config,
  ...appJson.expo,
  extra: {
    ...(appJson.expo.extra || {}),
    kakaoJavascriptKey: process.env.EXPO_PUBLIC_KAKAO_JAVASCRIPT_KEY || "",
  },
});
