const fs = require("fs");
const path = require("path");

const modulePath = path.join(
  process.cwd(),
  "node_modules",
  "@zhanziyang",
  "expo-text-extractor",
  "android",
  "src",
  "main",
  "java",
  "expo",
  "modules",
  "textextractor",
  "ExpoTextExtractorModule.kt"
);

if (!fs.existsSync(modulePath)) {
  console.log("[ocr-compat] Android OCR module not present; skipping.");
  process.exit(0);
}

let source = fs.readFileSync(modulePath, "utf8");
if (source.includes("OnDestroy {") && source.includes("private fun closeRecognizers()")) {
  console.log("[ocr-compat] Expo lifecycle patch already applied.");
  process.exit(0);
}

const oldTail = `    AsyncFunction("getSupportedLanguages") { _: String?, promise: Promise ->
      promise.resolve(availableScripts)
    }
  }

  /**
   * Clean up recognizers when the module is destroyed.
   */
  override fun onDestroy() {
`;
const newTail = `    AsyncFunction("getSupportedLanguages") { _: String?, promise: Promise ->
      promise.resolve(availableScripts)
    }

    OnDestroy {
      closeRecognizers()
    }
  }

  /**
   * Clean up recognizers when the module is destroyed.
   */
  private fun closeRecognizers() {
`;

if (!source.includes(oldTail)) {
  throw new Error("[ocr-compat] Expected OCR module lifecycle block was not found; refusing to modify unknown source.");
}

source = source.replace(oldTail, newTail);
source = source.replace(/\n\s*super\.onDestroy\(\)\n/, "\n");
fs.writeFileSync(modulePath, source, "utf8");
console.log("[ocr-compat] Patched OCR cleanup to Expo Modules API OnDestroy.");
