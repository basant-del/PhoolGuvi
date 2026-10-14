(function () {
  let isRunning = true;
  let targetSpeed = 16.0; // Max supported by Chrome
  let instantSeekMode = false;
  let interceptedAnswers = [];
  let currentOptionIndex = 0;

  // --- 1. Build Floating Control Panel (HUD) ---
  const hud = document.createElement("div");
  hud.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 999999;
    background: #111827; color: #f9fafb; padding: 14px; border-radius: 10px;
    font-family: system-ui, sans-serif; font-size: 13px; width: 270px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.4); border: 1px solid #374151;
  `;
  hud.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
      <strong style="color:#10b981; font-size:14px;">⚡ GUVI Auto-Helper</strong>
      <button id="guvi-toggle-btn" style="background:#10b981; color:#000; border:none; padding:4px 8px; border-radius:4px; font-weight:bold; cursor:pointer;">ON</button>
    </div>
    <div style="margin-bottom:8px; display:flex; gap:6px; align-items:center;">
      <label>Speed:</label>
      <select id="guvi-speed-select" style="background:#1f2937; color:#fff; border:1px solid #4b5563; border-radius:4px; padding:2px 6px;">
        <option value="4">4x</option>
        <option value="8">8x</option>
        <option value="16" selected>16x (Max)</option>
      </select>
      <label style="margin-left:auto; display:flex; align-items:center; gap:4px; cursor:pointer;">
        <input type="checkbox" id="guvi-seek-chk" /> Fast-Seek
      </label>
    </div>
    <div id="guvi-status" style="color:#9ca3af; font-size:12px; margin-bottom:4px;">Status: Monitoring video...</div>
    <div id="guvi-answer-box" style="background:#1f2937; padding:6px; border-radius:4px; font-size:11px; color:#fbbf24; max-height:70px; overflow-y:auto;">
      Network Answers: Waiting for payload...
    </div>
  `;
  document.body.appendChild(hud);

  const toggleBtn = document.getElementById("guvi-toggle-btn");
  const speedSelect = document.getElementById("guvi-speed-select");
  const seekChk = document.getElementById("guvi-seek-chk");
  const statusEl = document.getElementById("guvi-status");
  const answerBox = document.getElementById("guvi-answer-box");

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = `Status: ${msg}`;
  }

  toggleBtn.addEventListener("click", () => {
    isRunning = !isRunning;
    toggleBtn.textContent = isRunning ? "ON" : "OFF";
    toggleBtn.style.background = isRunning ? "#10b981" : "#ef4444";
    setStatus(isRunning ? "Resumed" : "Paused");
  });

  speedSelect.addEventListener("change", (e) => {
    targetSpeed = parseFloat(e.target.value);
  });

  seekChk.addEventListener("change", (e) => {
    instantSeekMode = e.target.checked;
  });

  // --- 2. Listen for Intercepted Network Answers ---
  window.addEventListener("message", (event) => {
    if (event.data && event.data.source === "GUVI_NETWORK_INTERCEPTOR") {
      const { findings } = event.data;
      interceptedAnswers = findings;
      const summary = findings
        .map((f) => `${f.key}: ${JSON.stringify(f.value)}`)
        .join(" | ");
      answerBox.textContent = `Intercepted: ${summary}`;
    }
  });

  // --- 3. Video Controller ---
  function handleVideo() {
    const video = document.querySelector("video");
    if (!video) return false;

    if (!video.ended) {
      // Mute is required by Chrome to autoplay and run at 16x smoothly
      video.muted = true;

      if (video.paused) {
        video.play().catch(() => {});
      }

      if (video.playbackRate !== targetSpeed) {
        try {
          video.playbackRate = targetSpeed;
        } catch (err) {
          video.playbackRate = 4.0;
        }
      }

      // Optional Fast-Seek: jump to 1.5 seconds before the end so the player fires normal completion events
      if (instantSeekMode && video.duration && video.currentTime < video.duration - 2) {
        video.currentTime = Math.max(0, video.duration - 1.5);
      }

      const progress = video.duration
        ? Math.round((video.currentTime / video.duration) * 100)
        : 0;
      setStatus(`Playing video at ${video.playbackRate}x (${progress}%)`);
      return true; // Still watching video
    }

    setStatus("Video finished! Checking quiz/next...");
    return false; // Video ended
  }

  // --- 4. Quiz Solver & Auto-Next ---
  function solveQuizAndAdvance() {
    // Look for common MCQ option inputs/labels on GUVI's course page
    const optionInputs = Array.from(
      document.querySelectorAll(
        'input[type="radio"], .quiz-option, .option-item, [class*="option"] input, .form-check-input'
      )
    ).filter((el) => el.offsetParent !== null);

    // Check if a "Next" or "Next Module/Video" button is already active/unlocked
    const nextButton = findButtonByText(["next", "continue", "next video", "proceed"]);

    // If options are visible on screen, attempt to answer
    if (optionInputs.length > 0) {
      let matchedInput = null;

      // Strategy A: Match against network-intercepted answer values
      if (interceptedAnswers.length > 0) {
        for (const item of interceptedAnswers) {
          const ansStr = String(item.value).trim().toLowerCase();
          for (const input of optionInputs) {
            const containerText = (
              input.closest("label, div, li")?.innerText ||
              input.value ||
              ""
            )
              .trim()
              .toLowerCase();
            if (containerText && (containerText === ansStr || containerText.includes(ansStr))) {
              matchedInput = input;
              break;
            }
          }
          if (matchedInput) break;
        }
      }

      // Strategy B: Fallback sequential option tester if backend hides the answer
      if (!matchedInput) {
        matchedInput = optionInputs[currentOptionIndex % optionInputs.length];
        currentOptionIndex++;
      }

      if (matchedInput) {
        setStatus(`Selecting quiz option (${currentOptionIndex})...`);
        matchedInput.click();
        const parentLabel = matchedInput.closest("label, .option-item, .form-check");
        if (parentLabel) parentLabel.click();

        setTimeout(() => {
          const submitBtn = findButtonByText(["submit", "check", "verify", "confirm"]);
          if (submitBtn && !submitBtn.disabled) {
            setStatus("Submitting quiz answer...");
            submitBtn.click();
          }
        }, 500);
      }
    }

    // Attempt to click Next or the next uncompleted sidebar video item
    setTimeout(() => {
      if (nextButton && !nextButton.disabled) {
        setStatus("Advancing to next video...");
        nextButton.click();
      } else {
        advanceViaSidebar();
      }
    }, 1200);
  }

  function findButtonByText(keywords) {
    const candidates = Array.from(
      document.querySelectorAll('button, a.btn, input[type="button"], input[type="submit"], [role="button"]')
    );
    return candidates.find((el) => {
      if (el.offsetParent === null) return false; // Skip hidden elements
      const text = (el.innerText || el.value || "").trim().toLowerCase();
      return keywords.some((kw) => text === kw || text.includes(kw));
    });
  }

  function advanceViaSidebar() {
    // Fallback: Look for active lesson in the course playlist sidebar and click the next item
    const activeItem = document.querySelector(
      '.active-lesson, .current-video, .list-group-item.active, [class*="active"][class*="course"], [class*="playing"]'
    );
    if (activeItem && activeItem.nextElementSibling) {
      setStatus("Clicking next item in playlist...");
      activeItem.nextElementSibling.click();
    }
  }

  // --- 5. Main Automation Loop ---
  setInterval(() => {
    if (!isRunning) return;
    const isPlayingVideo = handleVideo();
    if (!isPlayingVideo) {
      solveQuizAndAdvance();
    }
  }, 2000);
})();
