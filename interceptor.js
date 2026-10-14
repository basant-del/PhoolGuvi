(function () {
  const ANSWER_KEYS = [
    "answer",
    "correct_answer",
    "correctAnswer",
    "correct_option",
    "correctOption",
    "solution",
    "ans",
    "right_answer"
  ];

  function scanForAnswers(obj, path = "root", results = [], seen = new WeakSet()) {
    if (!obj || typeof obj !== "object") return results;
    if (seen.has(obj)) return results;
    seen.add(obj);

    for (const [key, value] of Object.entries(obj)) {
      const currentPath = `${path}.${key}`;
      if (ANSWER_KEYS.includes(key) && value !== null && value !== undefined && value !== "") {
        results.push({
          key,
          value,
          question: obj.question || obj.title || obj.q || null,
          path: currentPath
        });
      }
      if (typeof value === "object") {
        scanForAnswers(value, currentPath, results, seen);
      }
    }
    return results;
  }

  function tryParseAndBroadcast(url, rawText) {
    if (!rawText || typeof rawText !== "string") return;
    const trimmed = rawText.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return;
    try {
      const data = JSON.parse(trimmed);
      const findings = scanForAnswers(data);
      if (findings.length > 0) {
        window.postMessage(
          {
            source: "GUVI_NETWORK_INTERCEPTOR",
            url,
            findings
          },
          "*"
        );
      }
    } catch (e) {}
  }

  // 1. Intercept window.fetch (even if PHP returns text/html content-type)
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const clone = response.clone();
      const reqUrl = typeof args[0] === "string" ? args[0] : args[0]?.url || "fetch";
      clone.text().then((text) => tryParseAndBroadcast(reqUrl, text)).catch(() => {});
    } catch (e) {}
    return response;
  };

  // 2. Intercept XMLHttpRequest (used by jQuery $.ajax in course_content.js)
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._guviUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      try {
        if (this.responseText) {
          tryParseAndBroadcast(this._guviUrl || "xhr", this.responseText);
        }
      } catch (e) {}
    });
    return originalSend.apply(this, args);
  };

  // 3. Bridge for MAIN-world jQuery actions requested by content.js
  window.addEventListener("message", (event) => {
    if (!event.data || event.data.source !== "GUVI_CONTENT_COMMAND") return;
    const { action, cardSelector, optionIndex, lessonId } = event.data;
    const $ = window.jQuery || window.$;

    if (action === "SELECT_OPTION") {
      const card = document.querySelector(cardSelector);
      if (!card) return;
      const btns = card.querySelectorAll(".option-buttons button.options, button.options");
      const targetBtn = btns[optionIndex];
      if (!targetBtn) return;

      // Clear previous state on siblings
      btns.forEach((b) => {
        b.classList.remove("active");
        const inp = b.querySelector('input[type="radio"]');
        if (inp) {
          inp.checked = false;
          inp.removeAttribute("checked");
        }
      });

      const radio = targetBtn.querySelector('input[type="radio"]');

      // Trigger via jQuery if available so GUVI's delegated handlers fire
      if ($) {
        $(targetBtn).trigger("click");
        $(targetBtn).addClass("active");
        if (radio) {
          $(radio).prop("checked", true).attr("checked", "checked").trigger("click").trigger("change");
        }
      } else {
        targetBtn.click();
        targetBtn.classList.add("active");
        if (radio) {
          radio.checked = true;
          radio.setAttribute("checked", "checked");
          radio.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    }

    if (action === "CLICK_ELEMENT") {
      const el = document.querySelector(event.data.selector);
      if (!el) return;
      if ($) {
        $(el).trigger("click");
      } else {
        el.click();
      }
    }

    if (action === "CLICK_NEXT_LESSON" && lessonId) {
      const li = document.getElementById(lessonId);
      if (!li) return;
      const link = li.querySelector("a");
      if ($) {
        if (link) $(link).trigger("click");
        $(li).trigger("click");
      } else {
        if (link) link.click();
        li.click();
      }
    }
  });
})();
