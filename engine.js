(function () {
    "use strict";

    let isRunning = true;
    let instantVideoBypass = true;
    let targetSpeed = 16.0;
    let isBusy = false;
    let lastProcessedLessonId = null;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // --- 1. Build Floating Control Panel (HUD) ---
    function createHUD() {
        if (document.getElementById("guvi-v3-hud")) return;
        const hud = document.createElement("div");
        hud.id = "guvi-v3-hud";
        hud.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
      background: #0f172a; color: #f8fafc; padding: 14px; border-radius: 10px;
      font-family: system-ui, -apple-system, sans-serif; font-size: 13px; width: 300px;
      box-shadow: 0 12px 28px rgba(0,0,0,0.5); border: 1px solid #334155;
    `;
        hud.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <strong style="color:#10b981; font-size:14px;">🚀 GUVI Direct Engine v3.0</strong>
        <button id="guvi-v3-toggle" style="background:#10b981; color:#000; border:none; padding:4px 10px; border-radius:5px; font-weight:bold; cursor:pointer;">ON</button>
      </div>
      <div style="margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
        <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
          <input type="checkbox" id="guvi-v3-instant" checked /> Instant Video API Bypass
        </label>
        <select id="guvi-v3-speed" style="background:#1e293b; color:#fff; border:1px solid #475569; border-radius:4px; padding:2px 6px;">
          <option value="4">4x</option>
          <option value="8">8x</option>
          <option value="16" selected>16x</option>
        </select>
      </div>
      <div id="guvi-v3-lesson" style="color:#38bdf8; font-size:12px; margin-bottom:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Lesson: Detecting...</div>
      <div id="guvi-v3-status" style="color:#cbd5e1; font-size:12px; margin-bottom:6px;">Status: Ready</div>
      <div id="guvi-v3-log" style="background:#1e293b; padding:6px 8px; border-radius:6px; font-size:11px; color:#fde047; max-height:80px; overflow-y:auto; font-family:monospace;">
        Waiting for GUVI CourseContent...
      </div>
    `;
        document.body.appendChild(hud);

        const toggleBtn = document.getElementById("guvi-v3-toggle");
        const instantChk = document.getElementById("guvi-v3-instant");
        const speedSel = document.getElementById("guvi-v3-speed");

        toggleBtn.addEventListener("click", () => {
            isRunning = !isRunning;
            toggleBtn.textContent = isRunning ? "ON" : "OFF";
            toggleBtn.style.background = isRunning ? "#10b981" : "#ef4444";
            setStatus(isRunning ? "Resumed" : "Paused");
        });

        instantChk.addEventListener("change", (e) => {
            instantVideoBypass = e.target.checked;
        });

        speedSel.addEventListener("change", (e) => {
            targetSpeed = parseFloat(e.target.value);
        });
    }

    function setLessonText(txt) {
        const el = document.getElementById("guvi-v3-lesson");
        if (el) el.textContent = `Lesson: ${txt}`;
    }

    function setStatus(txt) {
        const el = document.getElementById("guvi-v3-status");
        if (el) el.textContent = `Status: ${txt}`;
    }

    function setLog(txt) {
        const el = document.getElementById("guvi-v3-log");
        if (el) el.textContent = txt;
        console.log("[GUVI Engine v3]", txt);
    }

    // --- 2. Promise Wrapper Around GUVI's Internal authorize.invisibleAjax / authorize.ajax ---
    function guviAjax(payload, endpoint = "courseContent", invisible = true) {
        return new Promise((resolve) => {
            try {
                const fn = invisible && window.authorize?.invisibleAjax
                    ? window.authorize.invisibleAjax.bind(window.authorize)
                    : window.authorize?.ajax?.bind(window.authorize);

                if (!fn) {
                    resolve(null);
                    return;
                }

                fn(payload, endpoint, (rawResponse) => {
                    if (!rawResponse || rawResponse === "ajax_timeout" || rawResponse === "access_denied") {
                        resolve(null);
                        return;
                    }
                    try {
                        const parsed = typeof rawResponse === "string" ? JSON.parse(rawResponse) : rawResponse;
                        resolve(parsed);
                    } catch (e) {
                        resolve(rawResponse);
                    }
                });
            } catch (err) {
                console.error("[GUVI Engine v3] Ajax error:", err);
                resolve(null);
            }
        });
    }

    // --- 3. Helper: Get Current Course & Active Sublesson ---
    function getCourseId() {
        const params = new URLSearchParams(window.location.search);
        return params.get("course");
    }

    function getSublessonInfo() {
        const $ = window.jQuery || window.$;
        if (!$) return null;

        const sublessonId = $("#video-activity-tab").data("sublessonId");
        const lessonContentData = $(".lesson-content").data() || {};
        const currentLessonData = lessonContentData.currentLessonData || lessonContentData;

        const liData = sublessonId ? $("#" + sublessonId).data(sublessonId) : null;
        const firstItem = Array.isArray(liData) && liData[0] ? liData[0] : currentLessonData;

        return {
            sublessonId: sublessonId || firstItem?.lessonId || null,
            level: firstItem?.level || lessonContentData?.level || "l1",
            type: firstItem?.type || lessonContentData?.type || "lesson",
            topic: firstItem?.topic || lessonContentData?.topic || sublessonId || "Unknown",
            disableActivity: Boolean(firstItem?.disableActivity || lessonContentData?.disableActivity)
        };
    }

    // --- 4. Close Any Blocking Modals (Points Modal, Activity Questions Modal, Lock Modal) ---
    function cleanupModals() {
        const $ = window.jQuery || window.$;
        if (!$) return;

        // If the +Geekoins points modal is open, click its Continue button or hide it
        const pointsModal = $("#preassessmentCompletionModal");
        if (pointsModal.hasClass("show") || pointsModal.css("display") === "block") {
            pointsModal.modal("hide");
        }

        const questionsModal = $("#videoActivityQuestionsModal");
        if (questionsModal.hasClass("show") || questionsModal.css("display") === "block") {
            questionsModal.modal("hide");
        }

        const lockModal = $("#activityLockInfo");
        if (lockModal.hasClass("show") || lockModal.css("display") === "block") {
            lockModal.modal("hide");
        }

        $(".modal-backdrop").remove();
        $("body").removeClass("modal-open").css("padding-right", "");
    }

    // --- 5. Step 1: Complete Video (Instant API Bypass OR 16x Speed) ---
    async function completeVideoStep(courseId, info) {
        const $ = window.jQuery || window.$;
        const quizLockHidden = $(".quiz-lock").hasClass("hide");

        if (instantVideoBypass) {
            setStatus("Sending video-activity completion API...");
            const res = await guviAjax(
                {
                    type: "video-activity",
                    courseId: courseId,
                    sublessonId: info.sublessonId,
                    level: info.level
                },
                "courseContent",
                true
            );

            // Unlock the Activity tab using GUVI's own CourseContent method
            if (window.CourseContent) {
                try {
                    const cc = new window.CourseContent();
                    cc.unlockActivityLock();
                } catch (e) { }
            }
            $("#video-activity-tab").removeClass("disabled").removeAttr("disabled");
            $(".quiz-lock").addClass("hide");

            // Pause the video so it doesn't waste bandwidth
            if (window.player && typeof window.player.pause === "function") {
                try { window.player.pause(); } catch (e) { }
            }
            const vid = document.querySelector("#course-video, video");
            if (vid && !vid.paused) {
                try { vid.pause(); } catch (e) { }
            }

            setLog(`Video marked watched via API (${info.sublessonId})`);
            return true;
        }

        // Fallback: 16x Playback Mode if user unchecked "Instant Video API Bypass"
        if (quizLockHidden) {
            return true; // Already unlocked!
        }

        const video = document.querySelector("#course-video, video");
        if (video) {
            video.muted = true;
            if (video.paused) {
                video.play().catch(() => { });
            }
            try {
                video.playbackRate = targetSpeed;
            } catch (e) {
                video.playbackRate = 4.0;
            }
            const pct = video.duration ? Math.round((video.currentTime / video.duration) * 100) : 0;
            setStatus(`Watching video at ${video.playbackRate}x (${pct}%)...`);
        }
        return false;
    }

    // --- 6. Step 2: Fetch & Auto-Solve the Activity Quiz via Direct API ---
    async function solveQuizDirectAPI(courseId, info) {
        const $ = window.jQuery || window.$;

        if (info.disableActivity) {
            setLog("Activity disabled for this lesson. Advancing...");
            return { validated: true, nextCourseData: null };
        }

        setStatus("Fetching quiz questions...");
        let quizQuestions = $("#" + info.sublessonId).data(info.sublessonId + "_quiz");

        if (!quizQuestions) {
            const quizRes = await guviAjax(
                {
                    type: "get-quiz",
                    courseId: courseId,
                    sublessonId: info.sublessonId
                },
                "courseContent",
                true
            );

            if (quizRes && quizRes[info.sublessonId]) {
                try {
                    quizQuestions = typeof quizRes[info.sublessonId] === "string"
                        ? JSON.parse(quizRes[info.sublessonId])
                        : quizRes[info.sublessonId];
                    $("#" + info.sublessonId).data(info.sublessonId + "_quiz", quizQuestions);
                } catch (e) { }
            }
        }

        // If this video has no quiz questions at all, advance immediately
        if (!Array.isArray(quizQuestions) || quizQuestions.length === 0) {
            setLog("No quiz questions for this video.");
            return { validated: true, nextCourseData: null };
        }

        // Render quiz in DOM so GUVI's state stays in sync
        if (window.CourseContent) {
            try {
                const cc = new window.CourseContent();
                cc.renderQuiz(quizQuestions);
            } catch (e) { }
        }

        const numQuestions = quizQuestions.length;
        // Start by guessing option "1" for every question: { "1": "1", "2": "1", ... }
        const currentGuess = {};
        for (let i = 1; i <= numQuestions; i++) {
            currentGuess[String(i)] = "1";
        }

        // At most 4 attempts are ever needed because GUVI returns data.result = ["1", "0", ...]
        // telling us exactly which questions were right ("1") and which were wrong ("0")!
        for (let attempt = 1; attempt <= 6; attempt++) {
            setStatus(`Solving ${numQuestions} quiz question(s) (Attempt ${attempt})...`);
            setLog(`Submitting quizData: ${JSON.stringify(currentGuess)}`);

            // Sync our guess into $(".quizstorage").data() and radio buttons just in case
            const quizStorage = $(".quizstorage");
            for (let i = 1; i <= numQuestions; i++) {
                const qKey = String(i);
                const optVal = currentGuess[qKey];
                quizStorage.data(qKey, optVal);

                const radio = $(`#q${i}VideoActivity input[name="ques${i}"][value="${optVal}"]`);
                if (radio.length) {
                    $(`#q${i}VideoActivity button.options`).removeClass("active");
                    radio.prop("checked", true);
                    radio.closest("button.options").addClass("active");
                }
            }

            const validateRes = await guviAjax(
                {
                    type: "validate-quiz",
                    courseId: courseId,
                    sublessonId: info.sublessonId,
                    quizData: currentGuess
                },
                "courseContent",
                true
            );

            if (!validateRes) {
                await sleep(500);
                continue;
            }

            // Case A: 100% Correct! GUVI returns an Array `data` where `data[0].validated` is true,
            // and `data` contains the updated course syllabus + the next unlocked lesson!
            if (Array.isArray(validateRes) && validateRes[0] && validateRes[0].validated) {
                setLog(`Quiz 100% Solved on Attempt ${attempt}!`);
                return { validated: true, nextCourseData: validateRes };
            }

            // Case B: Already validated previously!
            if (validateRes.validated === "already") {
                setLog(`Quiz was already completed!`);
                return { validated: true, nextCourseData: null };
            }

            // Case C: Partial/Wrong answer -> `validateRes.result` is an array like ["1", "0"]
            // Lock in every question where result[idx] === "1", and increment option for "0"
            if (Array.isArray(validateRes.result)) {
                const resArr = validateRes.result;
                const allOnes = resArr.every((r) => String(r) === "1");
                if (allOnes) {
                    setLog(`All answers verified correct!`);
                    return { validated: true, nextCourseData: null };
                }

                for (let idx = 0; idx < numQuestions; idx++) {
                    const qKey = String(idx + 1);
                    const maxOpts = quizQuestions[idx]?.options?.length || 4;
                    if (String(resArr[idx]) !== "1") {
                        const nextOpt = (parseInt(currentGuess[qKey], 10) % maxOpts) + 1;
                        currentGuess[qKey] = String(nextOpt);
                    }
                }
            } else {
                // Fallback increment if result array wasn't standard
                for (let idx = 0; idx < numQuestions; idx++) {
                    const qKey = String(idx + 1);
                    const maxOpts = quizQuestions[idx]?.options?.length || 4;
                    const nextOpt = (parseInt(currentGuess[qKey], 10) % maxOpts) + 1;
                    currentGuess[qKey] = String(nextOpt);
                }
            }

            await sleep(350);
        }

        return { validated: false, nextCourseData: null };
    }

    // --- 7. Step 3: Advance to Next Video Lesson ---
    async function moveToNextVideo(courseId, currentSublessonId, nextCourseData) {
        const $ = window.jQuery || window.$;
        cleanupModals();

        // If validate-quiz returned the next lesson & updated syllabus array (just like #submitbutton does in course_content.js:2092),
        // let CourseContent.renderCourse(nextCourseData) render and advance automatically!
        if (Array.isArray(nextCourseData) && nextCourseData[0] && window.CourseContent) {
            const nextId = nextCourseData[0].lessonId;
            if (nextId && nextId !== currentSublessonId) {
                setStatus(`Loading next lesson: ${nextCourseData[0].topic || nextId}...`);
                const cc = new window.CourseContent();
                if (nextCourseData[0].type === "lesson") {
                    cc.renderCourse(nextCourseData);
                    cc.renderBreadCrumb(nextCourseData);
                } else {
                    cc.renderingDeciderWithCourseList(nextCourseData);
                }
                cleanupModals();
                await sleep(1200);
                return;
            }
        }

        // Otherwise, use GUVI's exact sidebar progression selector from learnable.js / course_content.js:
        const currentLi = $(`#${currentSublessonId}`);
        currentLi.addClass("completed");

        let nextLi = currentLi.next("li");
        if (!nextLi.length) {
            const nextModuleCard = currentLi.parents("div.card").next("div.card");
            if (nextModuleCard.length) {
                const collapseBtn = nextModuleCard.find(".card-header .btn.btn-link.collapsed").eq(0);
                if (collapseBtn.length) collapseBtn.trigger("click");
                await sleep(300);
                nextLi = nextModuleCard.find(".list-unstyled.stepper li").eq(0);
            }
        }

        if (nextLi && nextLi.length) {
            // Ensure it has the 'sublesson' class and unlocked state so GUVI's $(document).on("click", ".sublesson") fires!
            nextLi.removeClass("stepperLock progressLock customTooltip lock").addClass("sublesson font-weight-bold");
            nextLi.children("a").addClass("black").attr("href", "#");

            const nextTopic = nextLi.text().trim() || nextLi.attr("id");
            setStatus(`Advancing to: ${nextTopic}...`);
            setLog(`Clicking next lesson: ${nextLi.attr("id")}`);

            nextLi.trigger("click");
            await sleep(1500);
        } else {
            setStatus("🎉 All video lessons in this course are completed!");
            isRunning = false;
            const toggleBtn = document.getElementById("guvi-v3-toggle");
            if (toggleBtn) {
                toggleBtn.textContent = "DONE";
                toggleBtn.style.background = "#3b82f6";
            }
        }
    }

    // --- 8. Main Automation Loop ---
    setInterval(async () => {
        createHUD();
        if (!isRunning || isBusy) return;

        const $ = window.jQuery || window.$;
        if (!$ || !window.authorize) return;

        isBusy = true;
        try {
            cleanupModals();

            const courseId = getCourseId();
            const info = getSublessonInfo();

            if (!courseId || !info || !info.sublessonId) {
                setStatus("Waiting for lesson data to load...");
                return;
            }

            setLessonText(`${info.topic} (${info.sublessonId})`);

            // If current item is a coding assignment (like Beginner Module - Assignments), skip to next video lesson if possible
            if (info.type !== "lesson" && info.type !== "quiz") {
                setStatus(`Reached ${info.type} (${info.topic}). Checking next lesson...`);
                await moveToNextVideo(courseId, info.sublessonId, null);
                return;
            }

            // 1. Complete or watch the video
            const videoReady = await completeVideoStep(courseId, info);
            if (!videoReady) {
                return; // Still playing at 16x
            }

            // 2. Solve the quiz via GUVI's direct API
            const { validated, nextCourseData } = await solveQuizDirectAPI(courseId, info);

            // 3. Move to the next lesson once validated
            if (validated) {
                lastProcessedLessonId = info.sublessonId;
                await moveToNextVideo(courseId, info.sublessonId, nextCourseData);
            }
        } catch (err) {
            console.error("[GUVI Engine v3 Loop Error]:", err);
        } finally {
            isBusy = false;
        }
    }, 1800);
})();
