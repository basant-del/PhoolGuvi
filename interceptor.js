(function () {
  const ANSWER_KEYS = [
    "answer",
    "correct_answer",
    "correctAnswer",
    "correct_option",
    "correctOption",
    "solution",
    "is_correct",
    "isCorrect"
  ];

  function scanForAnswers(obj, path = "root", results = []) {
    if (!obj || typeof obj !== "object") return results;

    for (const [key, value] of Object.entries(obj)) {
      const currentPath = `${path}.${key}`;
      if (ANSWER_KEYS.includes(key) && value !== null && value !== undefined) {
        results.push({ key, value, path: currentPath, context: obj });
      }
      if (typeof value === "object") {
        scanForAnswers(value, currentPath, results);
      }
    }
    return results;
  }

  function broadcastFindings(url, data) {
    const findings = scanForAnswers(data);
    if (findings.length > 0) {
      console.log("[GUVI Helper] Found potential answer data in:", url, findings);
      window.postMessage(
        {
          source: "GUVI_NETWORK_INTERCEPTOR",
          url,
          findings
        },
        "*"
      );
    }
  }

  // 1. Intercept window.fetch
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const clone = response.clone();
      const contentType = clone.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        clone.json().then((data) => {
          const reqUrl = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
          broadcastFindings(reqUrl, data);
        }).catch(() => {});
      }
    } catch (e) {}
    return response;
  };

  // 2. Intercept XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._guviUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      try {
        const contentType = this.getResponseHeader("content-type") || "";
        if (contentType.includes("application/json") && this.responseText) {
          const data = JSON.parse(this.responseText);
          broadcastFindings(this._guviUrl || "xhr", data);
        }
      } catch (e) {}
    });
    return originalSend.apply(this, args);
  };
})();
