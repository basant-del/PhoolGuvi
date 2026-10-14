(function () {
  let isRunning = true;
  let targetSpeed = 16.0;
  let isBusy = false;
  let interceptedAnswers = [];

  // Tracks which option index (0..3) to try next for each question card ID (e.g. "q1VideoActivity")
  const questionAttemptIndex = {};
  // Tracks lessons where the video has already reached completion
  const completedVideoLessons = new Set();
  let lastActiveLessonId = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // --- 1. Floating Control Panel (HUD) ---
  const hud = document.createElement("div");
  hud.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 999999;
    background: #111827; color: #f9fafb; padding: 14px; border-radius: 10px;
    font-family: system-ui, sans-serif; font-size: 13px; width: 280px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.4); border: 1px solid #374151;
  `;
  hud.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
      <strong style="color:#10b981; font-size:14px;">⚡ GUVI Auto-Helper v2</strong>
      <button id="guvi-toggle-btn" style="background:#10b981; color:#000; border:none; padding:4px 10px; border-radius:4px; font-weight:bold; cursor:pointer;">ON</button>
    </div>
    <div style="margin-bottom:8px; display:flex; gap:8px; align-items:center;">
      <label>Video Speed:</label>
      <select id="guvi-speed-select" style="background:#1f2937; color:#fff; border:1px solid #4b5563; border-radius:4px; padding:2px 6px;">
        <option value="2">2x</option>
        <option value="4">4x</option>
        <option value="8">8x</option>
        <option value="16" selected>16x (Max)</option>
      </select>
    </div>
    <div id="guvi-status" style="color:#d1d5db; font-size:12px; margin-bottom:6px;">Status: Initializing...</div>
    <div id="guvi-answer-box" style="background:#1f2937; padding:6px; border-radius:4px; font-size:11px; color:#fbbf24; max-height:70px; overflow-y:auto;">
      Quiz Mode: Smart Lock-In + Network Inspector Ready
    </div>
  `;
  document.body.appendChild(hud);

  const toggleBtn = document.getElementById("guvi-toggle-btn");
  const speedSelect = document.getElementById("guvi-speed-select");
  const statusEl = document.getElementById("guvi-status");
  const answerBox = document.getElementById("guvi-answer-box");

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = `Status: ${msg}`;
  }

  function setQuizLog(msg) {
    if (answerBox) answerBox.textContent = msg;
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

  window.addEventListener("message", (event) => {
    if (event.data && event.data.source === "GUVI_NETWORK_INTERCEPTOR") {
      const { findings } = event.data;
      interceptedAnswers = findings;
      const summary = findings
        .map((f) => `${f.key}: ${JSON.stringify(f.value)}`)
        .join(" | ");
      setQuizLog(`Intercepted: ${summary}`);
    }
  });

  // --- 2. Helper Functions for GUVI's Exact DOM ---

  // Finds the currently active <li class="sublesson"> in #courseTocAccordion (marked by a.text-purple)
  function getCurrentLessonLi() {
    const activeLink = document.querySelector("#courseTocAccordion ul.stepper li a.text-purple");
    return activeLink ? activeLink.closest("li") : null;
  }

  // Checks if GUVI has unlocked the Activity tab for the current lesson
  function isActivityUnlocked() {
    const quizLock = document.querySelector("#video-activity-tab .quiz-lock, .quiz-lock");
    if (quizLock && quizLock.classList.contains("hide")) {
      return true;
    }
    const nudge = document.querySelector(".activity-nudge-container");
    if (nudge && nudge.style.display !== "none" && nudge.offsetParent !== null) {
      return true;
    }
    return false;
  }

  // Checks if a specific question card (e.g. "#q1VideoActivity") is already marked correct by GUVI
  function isQuestionCorrect(cardIdSelector) {
    const card = document.querySelector(cardIdSelector);
    if (!card) return false;

    // 1. Check the #quesring1 / #quesring2 badge on the card header
    const headerBadge = card.querySelector(".number-id");
    if (headerBadge && headerBadge.classList.contains("has-success")) {
      return true;
    }

    // 2. Check the #videoActivityQuestionsModal "All Questions" and "Correct Answers" tabs
    const modalBadge = document.querySelector(
      `#questions-all a.jumpQuestion[data-target="${cardIdSelector}"] .number-id`
    );
    if (modalBadge && modalBadge.classList.contains("has-success")) {
      return true;
    }

    const inCorrectTab = document.querySelector(
      `#questions-answered-correct a.jumpQuestion[data-target="${cardIdSelector}"]`
    );
    if (inCorrectTab) {
      return true;
    }

    return false;
  }

  // Dismisses blocking modals like #activityLockInfo or .activity-nudge-close
  function dismissPopups() {
    const nudgeClose = document.querySelector(".activity-nudge-close");
    if (nudgeClose && nudgeClose.offsetParent !== null) {
      nudgeClose.click();
    }
    const lockModalOk = document.querySelector("#activityLockInfo.show button[data-dismiss='modal']");
    if (lockModalOk) {
      lockModalOk.click();
    }
  }

  // --- 3. Video Controller (Plyr / #course-video) ---
  function handleVideoPlayback(currentLessonId) {
    const video = document.querySelector("#course-video, video");
    if (!video) return false;

    // Listen for 'ended' event once per video element
    if (!video._guviEndedHooked) {
      video._guviEndedHooked = true;
      video.addEventListener("ended", () => {
        const li = getCurrentLessonLi();
        if (li) completedVideoLessons.add(li.id);
      });
    }

    // IMPORTANT: When Plyr finishes a video on GUVI, it resets currentTime to 00:00 and pauses,
    // while unlocking .quiz-lock (adding class 'hide'). Do NOT replay the video if Activity is already unlocked!
    if (isActivityUnlocked() || completedVideoLessons.has(currentLessonId)) {
      if (!video.paused) {
        video.pause();
      }
      return false; // Video phase is complete -> move to Quiz Solver!
    }

    // Also check if Plyr seek slider shows 99%+ completion
    const seekInput = document.querySelector("input[data-plyr='seek']");
    if (seekInput) {
      const valNow = parseFloat(seekInput.getAttribute("aria-valuenow") || "0");
      const valMax = parseFloat(seekInput.getAttribute("aria-valuemax") || "0");
      if (valMax > 0 && valNow >= valMax - 1.5 && isActivityUnlocked()) {
        completedVideoLessons.add(currentLessonId);
        return false;
      }
    }

    // Play video muted at targetSpeed (without skipping so GUVI's 90% watch tracker unlocks Activity)
    video.muted = true;
    if (video.paused) {
      const plyrPlayBtn = document.querySelector("button.plyr__control--overlaid[data-plyr='play']");
      if (plyrPlayBtn && plyrPlayBtn.offsetParent !== null) {
        plyrPlayBtn.click();
      }
      video.play().catch(() => {});
    }

    if (video.playbackRate !== targetSpeed) {
      try {
        video.playbackRate = targetSpeed;
      } catch (e) {
        video.playbackRate = 4.0;
      }
    }

    const pct = video.duration ? Math.round((video.currentTime / video.duration) * 100) : 0;
    setStatus(`Watching video at ${video.playbackRate}x (${pct}%)...`);
    return true; // Still watching video
  }

  // --- 4. Multi-Question Activity Solver (#q1VideoActivity, #q2VideoActivity, ...) ---
  async function solveActivityQuiz() {
    // Ensure the Activity tab is open
    const activityTab = document.getElementById("video-activity-tab");
    if (activityTab && !activityTab.classList.contains("active")) {
      activityTab.click();
      await sleep(300);
    }

    const cards = Array.from(document.querySelectorAll("#video-activity .card.video-activity-card"));
    if (cards.length === 0) {
      setStatus("No quiz questions found. Advancing...");
      await advanceToNextLesson();
      return;
    }

    // Check if all questions are already marked correct (has-success)
    const allSolved = cards.every((card) => isQuestionCorrect(`#${card.id}`));
    if (allSolved) {
      setStatus("All quiz questions solved! Advancing to next video...");
      setQuizLog(`Quiz Completed (${cards.length}/${cards.length} Correct)`);
      await advanceToNextLesson();
      return;
    }

    // Close the "View All Questions" modal if it popped up from a previous submission
    const modalCloseBtn = document.querySelector("#videoActivityQuestionsModal.show button.close");
    if (modalCloseBtn) {
      modalCloseBtn.click();
      await sleep(350);
    }

    // Step 1: Navigate back to the first question card (#q1VideoActivity)
    const firstCardSelector = `#${cards[0].id}`;
    const jumpFirst = document.querySelector(
      `#questions-all a.jumpQuestion[data-target="${firstCardSelector}"]`
    );
    if (jumpFirst) {
      window.postMessage(
        { source: "GUVI_CONTENT_COMMAND", action: "CLICK_ELEMENT", selector: `#questions-all a.jumpQuestion[data-target="${firstCardSelector}"]` },
        "*"
      );
      await sleep(300);
    }

    // Also click 'Previous' button if a later card is still visible
    for (let safety = 0; safety < cards.length; safety++) {
      const visibleCard = cards.find((c) => c.style.display !== "none" && c.offsetParent !== null);
      if (!visibleCard || visibleCard.id === cards[0].id) break;
      const prevBtn = visibleCard.querySelector(".previousbutton, .video-quiz-previousBtn");
      if (prevBtn) {
        prevBtn.click();
        await sleep(300);
      } else {
        break;
      }
    }

    // Step 2: Walk through each question card in order, selecting options for unsolved cards
    const statusParts = [];
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const cardSelector = `#${card.id}`;
      const optionBtns = Array.from(card.querySelectorAll(".option-buttons button.options, button.options"));

      if (isQuestionCorrect(cardSelector)) {
        statusParts.push(`Q${i + 1}: ✓`);
      } else if (optionBtns.length > 0) {
        let chosenIdx = null;

        // Strategy A: Check if network interceptor found a matching option text or 1-based value
        if (interceptedAnswers.length > 0) {
          for (const item of interceptedAnswers) {
            const ansStr = String(item.value).trim().toLowerCase();
            const foundIdx = optionBtns.findIndex((btn) => {
              const txt = (btn.innerText || "").trim().toLowerCase();
              const val = (btn.querySelector("input")?.value || "").trim().toLowerCase();
              return txt === ansStr || val === ansStr || (ansStr.length > 2 && txt.includes(ansStr));
            });
            if (foundIdx !== -1) {
              chosenIdx = foundIdx;
              break;
            }
          }
        }

        // Strategy B: Cycle through options (0, 1, 2, 3) and lock in as soon as GUVI marks has-success
        if (chosenIdx === null) {
          const currentTry = questionAttemptIndex[card.id] || 0;
          chosenIdx = currentTry % optionBtns.length;
          questionAttemptIndex[card.id] = currentTry + 1;
        }

        const targetBtn = optionBtns[chosenIdx];
        const optionLabel = (targetBtn.innerText || `Option ${chosenIdx + 1}`).trim();
        statusParts.push(`Q${i + 1}: trying "${optionLabel}"`);
        setStatus(`Selecting Q${i + 1} -> ${optionLabel}`);

        // Select option in BOTH Isolated and MAIN (jQuery) worlds so GUVI registers it 100%
        optionBtns.forEach((b) => {
          b.classList.remove("active");
          const inp = b.querySelector('input[type="radio"]');
          if (inp) {
            inp.checked = false;
            inp.removeAttribute("checked");
          }
        });

        targetBtn.classList.add("active");
        const radio = targetBtn.querySelector('input[type="radio"]');
        if (radio) {
          radio.checked = true;
          radio.setAttribute("checked", "checked");
          radio.dispatchEvent(new Event("input", { bubbles: true }));
          radio.dispatchEvent(new Event("change", { bubbles: true }));
        }

        window.postMessage(
          {
            source: "GUVI_CONTENT_COMMAND",
            action: "SELECT_OPTION",
            cardSelector,
            optionIndex: chosenIdx
          },
          "*"
        );

        await sleep(350);
      }

      // If this card has a "Next" button (.nextbutton), click it to reveal the next question card
      const nextQuestionBtn = card.querySelector(".nextbutton, button[data-next]");
      if (nextQuestionBtn && i < cards.length - 1) {
        nextQuestionBtn.click();
        window.postMessage(
          {
            source: "GUVI_CONTENT_COMMAND",
            action: "CLICK_ELEMENT",
            selector: `${cardSelector} .nextbutton`
          },
          "*"
        );
        await sleep(400);
      }
    }

    setQuizLog(statusParts.join(" | "));

    // Step 3: Click the Submit button (#submitbutton) on the final question card
    const lastCard = cards[cards.length - 1];
    const submitBtn =
      lastCard.querySelector("#submitbutton, button[id*='submit']") ||
      document.getElementById("submitbutton");

    if (submitBtn) {
      setStatus("Submitting quiz answers...");
      submitBtn.click();
      window.postMessage(
        {
          source: "GUVI_CONTENT_COMMAND",
          action: "CLICK_ELEMENT",
          selector: "#submitbutton"
        },
        "*"
      );
      await sleep(1800);
    }

    // Step 4: If "Mark as Complete" button appears inside the modal footer, click it
    const markCompleteBtn = document.querySelector("#markAsComplete button");
    if (markCompleteBtn && markCompleteBtn.offsetParent !== null) {
      markCompleteBtn.click();
      await sleep(800);
    }

    // Close modal if it opened after submit
    const modalCloseAfter = document.querySelector("#videoActivityQuestionsModal.show button.close");
    if (modalCloseAfter) {
      modalCloseAfter.click();
      await sleep(300);
    }

    // Check if all questions are now solved after this submission
    const nowAllSolved = cards.every((card) => isQuestionCorrect(`#${card.id}`));
    if (nowAllSolved) {
      setStatus("Quiz 100% solved! Advancing to next video...");
      setQuizLog(`Quiz Completed (${cards.length}/${cards.length} Correct)`);
      await advanceToNextLesson();
    } else {
      const correctCount = cards.filter((card) => isQuestionCorrect(`#${card.id}`)).length;
      setStatus(`Verified ${correctCount}/${cards.length} correct. Retrying remaining...`);
    }
  }

  // --- 5. Sidebar Playlist Auto-Advancer (#courseTocAccordion) ---
  async function advanceToNextLesson() {
    const allLessons = Array.from(document.querySelectorAll("#courseTocAccordion ul.stepper li"));
    if (allLessons.length === 0) return;

    const currentLi = getCurrentLessonLi();
    const currentIndex = currentLi ? allLessons.indexOf(currentLi) : -1;

    // Find the next lesson in the Table of Contents
    let nextLi = null;
    for (let i = currentIndex + 1; i < allLessons.length; i++) {
      const candidate = allLessons[i];
      // Skip final coding assignment items if they aren't video lessons, or stop if locked
      if (candidate.id && (candidate.id.startsWith("finalassig_") || candidate.id.startsWith("advancedmo_") || candidate.id.startsWith("expertmodu_"))) {
        continue;
      }
      nextLi = candidate;
      break;
    }

    if (!nextLi) {
      setStatus("🎉 Course video lessons completed!");
      return;
    }

    // If the next lesson is inside a collapsed module accordion (e.g. #modulel2), expand it first
    const parentCollapse = nextLi.closest(".collapse");
    if (parentCollapse && !parentCollapse.classList.contains("show")) {
      const headerBtn = document.querySelector(`button[data-target="#${parentCollapse.id}"]`);
      if (headerBtn) {
        headerBtn.click();
        await sleep(500);
      }
    }

    const lessonName = (nextLi.innerText || nextLi.id).trim();
    setStatus(`Opening next video: ${lessonName}...`);

    // Click both the <a> link and the <li> element in Isolated + MAIN world
    const link = nextLi.querySelector("a");
    if (link) link.click();
    nextLi.click();

    window.postMessage(
      {
        source: "GUVI_CONTENT_COMMAND",
        action: "CLICK_NEXT_LESSON",
        lessonId: nextLi.id
      },
      "*"
    );

    // Wait for the new video and quiz DOM to load
    await sleep(2500);
  }

  // --- 6. Main Orchestration Loop ---
  setInterval(async () => {
    if (!isRunning || isBusy) return;
    isBusy = true;

    try {
      dismissPopups();

      const currentLi = getCurrentLessonLi();
      const currentLessonId = currentLi ? currentLi.id : "unknown";

      if (currentLessonId !== lastActiveLessonId) {
        lastActiveLessonId = currentLessonId;
      }

      const stillWatching = handleVideoPlayback(currentLessonId);
      if (!stillWatching) {
        await solveActivityQuiz();
      }
    } catch (err) {
      console.error("[GUVI Auto-Helper Error]:", err);
    } finally {
      isBusy = false;
    }
  }, 1500);
})();
